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


function processFile(filePath, options, jobService, cb) {
    log.debug("Starting Batch Processing");
    log.debug("filePath = " + filePath);
    log.debug("options = " + JSON.stringify(options));
    log.debug("jobservice : " + jobService);

    jobService.options = options;
    var appBaseURL = process.env["APP_BASE_URL"] || (options && options.appBaseURL);

    limiter.on('error', function (error) {
        log.error("An error occurred: ");
        log.error(error.message);
    });

    limiter.on('debug', function (message, data) {
        //log.debug(JSON.stringify(limiter.counts()));
    });

    limiter.on('idle', function () {
        log.debug("LIMITER is IDLE. calling jobService.onEnd()");
        jobService.onEnd(function() {
            log.debug("jobService.onEnd finished, calling processFile cb");
            cb();
        });
    });

    jobService.onStart(function(params) {
        var lineNr = 0;
        var s = fs.createReadStream(filePath).pipe(es.split()).pipe(es.mapSync(function(rec) {
                s.pause();
                lineNr += 1;
                log.debug("submitting job for : " + rec);
                var recData = {fileName: filePath, rec: rec, recId: lineNr};
                limiter.submit({expiration: 20000, id: lineNr}, runJob, jobService, recData, function(result, params) {
                    if(result.status === "FAILED") log.error("ERROR: Error while posting record: " + JSON.stringify(result));
                    else log.debug(JSON.stringify(result));
                    var access_token = params.access_token;

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
                            if(response.statusCode !== 200) {
                                log.error("ERROR: Error while posting status: ERROR: " + JSON.stringify(error) + " STATUS: " + JSON.stringify(result) + " RESPONSE: " + JSON.stringify(response));
                            } else log.debug("Posted status successfully for " + JSON.stringify(result.payload));
                        });
                    } catch(e) {
                        log.error("ERROR: Could not post status: ERROR: " + JSON.stringify(e) + " STATUS: " + JSON.stringify(result));
                    }

                });            
                s.resume();
            })
            .on('error', function(err){
                log.error('Error while reading file.' + JSON.stringify(err));
            })
            .on('end', function(){
                log.debug('Read entire file: ' + filePath)
            })
        );
       
    });
}


function runJob(jobService, recData, cb3) {
    log.debug("runJob started for : " + JSON.stringify(recData));
    jobService.onEachRecord(recData, function cb2(payload, err) {
        var appBaseURL = process.env["APP_BASE_URL"] || (jobService.options && jobService.options.appBaseURL);
        if(!appBaseURL) {
            log.error("appBaseURL is not specified as options.appBaseURL. Aborting job.");
            process.exit(1);
        }
        var access_token = payload && payload.ctx && payload.ctx.access_token; 
        access_token =  access_token || (jobService.options && jobService.options.ctx && jobService.options.ctx.access_token);
        payload.fileName = recData.fileName;
        payload.recId = recData.recId;
        if(!(config.excludeFileRecordFromStatus === true)) payload.rec = recData.rec;
        if(err === null) {
            var api = (payload.modelAPI ? payload.modelAPI : jobService.options.modelAPI);
            if(!api) {
                log.error("API is neither specified as options.modelAPI nor passed in payload. Aborting job.");
                process.exit(1);
            }
            var url = appBaseURL + (api.startsWith("/") ? "" : "/") + api + "?access_token=" + access_token;
            var method = payload.method || jobService.options.method;
            if(!method) {
                log.error("method is neither specified as options.method nor passed in payload. Aborting job.");
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
                    if(BATCH_RESULT_LOG_ITEMS.indexOf("error.details") === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                    if(BATCH_RESULT_LOG_ITEMS.indexOf("error.stack") === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                    var retStatus = {};
                    retStatus.payload = payload;
                    retStatus.response = response && response.body;
                    retStatus.status = status;
                    retStatus.statusCode = response && response.statusCode;
                    retStatus.error = error ? (error.message ? error.message : error)  : status === "FAILED" ? response && response.body : undefined;
                    return cb3(retStatus, {access_token: access_token});
                });
            } catch(e) {
                var retStatus = {payload: payload, response: null, status: "FAILED", error: e };
                return cb3(retStatus, {access_token: access_token});
            }
        }
        else {
            log.error("There was an error processing file record to JSON: " + err);
            var retStatus = {payload: payload, response: null, status: "FAILED", error: err };
            return cb3(retStatus, {access_token: access_token});
        }
    });
}


exports.processFile = processFile;