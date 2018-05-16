if(!process.env["LOGGER_CONFIG"] && process.env["BATCH_LOGGER_CONFIG"]) {
    process.env["LOGGER_CONFIG"] = JSON.stringify({"levels":{"default":process.env["BATCH_LOGGER_CONFIG"].trim().toLocaleLowerCase()}});
}
var log = require('oe-logger')('batch-processing');
var config;
try {
    config = require('./config.json');
} catch(e) { log.debug("No config file fould. Using default values for batch processing configuration"); 
}
var fs = require('fs')
var es = require('event-stream');
var request = require('request');
const Bottleneck = require("bottleneck");
var bottleNeckConfig = { maxConcurrent: process.env["MAX_CONCURRENT"] || 
                        (config && config.maxConcurrent) || 80, 
                        minTime: process.env["MIN_TIME"] || 
                        (config && config.minTime) || 20 };
log.debug("BottleNeck Config: " + JSON.stringify(bottleNeckConfig));                        
const limiter = new Bottleneck(bottleNeckConfig);
var BATCH_RESULT_LOG_ITEMS = process.env["BATCH_RESULT_LOG_ITEMS"] || (config && config.batchResultLogItems) || "";
var running = false;

function processFile(filePath, options, jobService, cb) {
    running = true;
    var start = new Date().getTime();
    console.log("** Starting Batch Processing **");
    log.debug("filePath = " + filePath);
    log.debug("options = " + JSON.stringify(options));
    log.debug("jobservice : " + jobService);

    if(!filePath || filePath.trim().length === 0) {
        log.fatal("filePath is not specified. Aborting processing.");
        process.exit(1);
    }
    if(!jobService) {
        log.fatal("jobService is not specified. Aborting processing.");
        process.exit(1);
    }
    if(!jobService.onEachRecord) {
        log.fatal("jobService.onEachRecord() is not defined. Aborting processing.");
        process.exit(1);
    }
    if(!jobService.onStart) {
        jobService.onStart = function(cb4) {
            log.debug("calling jobService.onStart");
            cb4({});
        };
    }
    if(!jobService.onEnd) {
        jobService.onEnd = function(cb5) {
            log.debug("calling jobService.onEnd");
            cb5();
        };
    }

    limiter.on('error', function (error) {
        log.fatal("An error occurred: ");
        log.fatal(error.message);
        process.exit(1);
    });

    limiter.on('idle', function () {
        log.debug("LIMITER is IDLE. calling jobService.onEnd()");
        jobService.onEnd(function() {
            log.debug("jobService.onEnd finished, calling processFile cb");
            cb();
            running = false;
        });
    });

    jobService.onStart(function(startOpts) {
        getAccessToken(options, function() {
            jobService.options = options;
            var lineNr = 0;
            var s = fs.createReadStream(filePath).pipe(es.split()).pipe(es.mapSync(function(rec) {
                    s.pause();
                    lineNr += 1;
                    log.debug("submitting job for rec#: " + lineNr);
                    var recData = {fileName: filePath, rec: rec, recId: lineNr};
                    limiter.submit({expiration: 20000, id: lineNr}, runJob, jobService, recData, function(result, params) {
                        if(result.status === "FAILED") log.debug("Error while posting record: " + JSON.stringify(result));
                        else log.debug(JSON.stringify(result));
                        var access_token = params.access_token;
                        var appBaseURL = params.appBaseURL;
                        var opts = {
                            url: appBaseURL + "/api/BatchStatus?access_token=" + access_token,
                            method: "POST",
                            body: result,
                            json: true,
                            timeout: 10000,
                            jar: true,
                            headers: {
                                'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
                            }
                        };
                        log.debug("POSTing result " + JSON.stringify(result) + " to " + opts.url);
                        try {
                            request(opts, function(error, response, body) {
                                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.details") === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.stack") === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                                if(BATCH_RESULT_LOG_ITEMS.indexOf("response.headers") === -1 && response && response.headers) response.headers = undefined;
                                var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
                                if(response && response.statusCode !== 200) {
                                    log.error("Error while posting status: ERROR: " + JSON.stringify(error) + " STATUS: " + JSON.stringify(result) + " RESPONSE: " + JSON.stringify(response));
                                    if(response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?");
                                } else log.debug("Posted status successfully for " + JSON.stringify(result.payload));
                                if(!running) {
                                    var end = new Date().getTime();
                                    console.log("Batch took " + ((end - start)/1000) + " sec");
                                    running = true;
                                }
                            });
                        } catch(e) {
                            log.error("Could not post status: ERROR: " + JSON.stringify(e) + " STATUS: " + JSON.stringify(result));
                        }
    
                    });            
                    s.resume();
                })
                .on('error', function(err){
                    log.fatal('Error while reading file.' + JSON.stringify(err));
                    process.exit(1);
                })
                .on('end', function(){
                    log.debug('Read entire file: ' + filePath)
                })
            );
    
        });
       
    });
}


function getAccessToken(options, cb) {
    log.debug("Trying to get access_token");
    if(options && options.ctx && options.ctx.username)
    {
        log.debug("Found username in options.ctx. Will try login for obtaining access_token");
        if(!options.ctx.password) log.warn("password is not specified in options.ctx");
        if(!options.ctx.tenantId) log.warn("tenantId is not specified in options.ctx");
        var appBaseURL = process.env["APP_BASE_URL"] || (options && options.appBaseURL);
        if(!appBaseURL) {
            log.fatal("appBaseURL is not specified in env variable (APP_BASE_URL) or options. Can't defer this to payload when username is specified. Aborting job.");
            process.exit(1);
        }
        var opts = {
            url: options.appBaseURL + "/auth/local",
            method: "POST",
            body: {username: options.ctx.username, password: options.ctx.password},
            json: true,
            timeout: 10000,
            headers: {
                'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json',
                'tenant-id': options.ctx.tenantId
            }
        };
        log.debug("POSTing user credentials for obtaining access_token");
        try {
            request(opts, function(error, response, body) {
                if(response.statusCode !== 200) {
                    log.fatal("Error received after posting user credentials: ERROR: " + JSON.stringify(error) + " RESPONSE: " + JSON.stringify(response));
                    process.exit(1);
                } else {
                    var access_token = body && body.access_token;
                    if(access_token) {
                        log.debug("Obtained access_token successfully for provided user credentials");
                        options.ctx.access_token2 = access_token;
                    } else {
                        log.fatal("Could not get access_token by login: RESPONSE: " + JSON.stringify(response));
                        process.exit(1);
                    }
                }
                return cb();
            });
        } catch(e) {
            log.warn("Could not post user credentials: ERROR: " + JSON.stringify(e));
            process.exit(1);
        }
    } else {
        log.debug("username is not specified in options.ctx. Won't try to login");
        return cb();
    }
}


function runJob(jobService, recData, cb3) {
    log.debug("runJob started for : " + JSON.stringify(recData));
    jobService.onEachRecord(recData, function cb2(payload, err) {
        var appBaseURL = process.env["APP_BASE_URL"] || payload && payload.appBaseURL || (jobService.options && jobService.options.appBaseURL);
        if(!appBaseURL) {
            log.fatal("appBaseURL is neither specified in processFile options nor passed in payload. Aborting job.");
            process.exit(1);
        }

        var access_token = process.env["ACCESS_TOKEN"];
        //if(access_token) log.debug("access_token taken from env variable ACCESS_TOKEN");
        access_token =  access_token || payload && payload.ctx && payload.ctx.access_token; 
        //if(access_token) log.debug("access_token taken from payload.ctx");
        access_token =  access_token || jobService.options && jobService.options.ctx && jobService.options.ctx.access_token2;
        //if(access_token) log.debug("access_token obtained from login using provided credentials");
        access_token =  access_token || (jobService.options && jobService.options.ctx && jobService.options.ctx.access_token);
        //if(access_token) log.debug("access_token taken from options.ctx");
        if(!access_token) log.warn("access_token is not provided in env var (ACCESS_TOKEN), or options.ctx or payload.ctx");
        if(!payload || err) {
            log.error("There was an error processing file record to JSON: " + JSON.stringify(err));
            var retStatus = {recData: recData, payload: payload, response: null, status: "FAILED", error: err };
            return cb3(retStatus, {access_token: access_token, appBaseURL: appBaseURL});
        }

        var api = (payload.modelAPI ? payload.modelAPI : (jobService.options && jobService.options.modelAPI));
        if(!api) {
            log.fatal("modelAPI is neither specified in processFile options nor passed in payload. Aborting job.");
            process.exit(1);
        }
        var url = appBaseURL + (api.startsWith("/") ? "" : "/") + api + "?access_token=" + access_token;
        var method = payload.method || (jobService.options && jobService.options.method);
        if(!method) {
            log.fatal("method is neither specified in processFile options nor passed in payload. Aborting job.");
            process.exit(1);
        }

        var opts = {
            url: url,
            method: method,
            body: payload.json,
            json: true,
            timeout: 10000,
            jar: true,
            headers: {
                'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
            }
        };
        log.debug(opts.method + "ing " + JSON.stringify(opts.body) + " to " + opts.url);
        try {
            request(opts, function(error, response, body) {
                var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
                if(response && response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?");
                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.details") === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.stack") === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                var retStatus = {};
                retStatus.recData = recData;
                retStatus.payload = payload;
                retStatus.response = response && response.body;
                retStatus.status = status;
                retStatus.statusCode = response && response.statusCode;
                retStatus.error = error ? (error.message ? error.message : error)  : status === "FAILED" ? response && response.body : undefined;
                return cb3(retStatus, {access_token: access_token, appBaseURL: appBaseURL});
            });
        } catch(e) {
            var retStatus = {recData: recData, payload: payload, response: null, status: "FAILED", error: e };
            return cb3(retStatus, {access_token: access_token, appBaseURL: appBaseURL});
        }

    });
}


exports.processFile = processFile;