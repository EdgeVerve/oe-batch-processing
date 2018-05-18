//1 // Catch uncaught exceptions of nodejs, especially
// fileNotFound, which cannot be trapped by try..catch
process.on('uncaughtException', function (err) {
    updateBatchRun(err, function() {    // Update BatchRun with current status and exception
        log.error("There was an uncaught exception:");
        log.error(JSON.stringify(err));
        console.log(err);
        process.exit(1);
    });
});

//2 // Set log level programmatically using our own env var BATCH_LOGGER_CONFIG
// if it is set, but not LOGGER_CONFIG
// e.g., set BATCH_LOGGER_CONFIG=debug  for setting log level to debug
if(!process.env["LOGGER_CONFIG"] && process.env["BATCH_LOGGER_CONFIG"]) {
    process.env["LOGGER_CONFIG"] = JSON.stringify({"levels":{"default":process.env["BATCH_LOGGER_CONFIG"].trim().toLocaleLowerCase()}});
}
var log = require('oe-logger')('batch-processing');

//3 // Read the batch processing config file
/*
Example config:
{
    "maxConcurrent": 80,      // Maximum number of records processed in parallel 
    "minTime": 20,            // Minimum time delay between start times of two records being processed, in ms
    "batchResultLogItems": "",  // Comma separated list of items that can be included in the default response that
                                // is logged to DB. Possible values: error.details, error.stack, response.headers
    "appBaseURL": "http://localhost:3000",
    "excludeFileRecordFromStatus": false
}
*/
var config;
try {
    config = require('./config.json');
} catch(e) { log.warn("No config file found. Using default values for batch processing configuration"); 
}


//4 // Libraries required by this module

// Used to create id for the BatchRun record that we will be creating
// for each run of the processFile(..) function
var uuidv4 = require('uuid/v4');

var fs = require('fs')
var es = require('event-stream');
var request = require('request');
// Module that manages the rate-limiting or throttling of the file processing
const Bottleneck = require("bottleneck");
var bottleNeckConfig = { maxConcurrent: process.env["MAX_CONCURRENT"] || 
                        (config && config.maxConcurrent) || 80, 
                        minTime: process.env["MIN_TIME"] || 
                        (config && config.minTime) || 20 };
log.debug("BottleNeck Config: " + JSON.stringify(bottleNeckConfig));

// the module-object used to queue jobs and execute them with rate-limiting/throttling 
const limiter = new Bottleneck(bottleNeckConfig);

var BATCH_RESULT_LOG_ITEMS = process.env["BATCH_RESULT_LOG_ITEMS"] || (config && config.batchResultLogItems) || "";
var appBaseURL, access_token, batchRunId, batchRunVersion, totalRecordCount = 0, successCount = 0, failureCount = 0;
var running = false;


//5
/**
 * This function is exported from this batch-processing module, and is the one that needs to be
 * called by clients who wish to batch-process files
 * 
 * parameters to be passed are as follows:
 * 
 * filePath - fully qualified fileName (with path) of the data-file to be processed
 * @param {object} options - Object containing the following properties:
 *              * ctx - Object containing username, password, tenantId, access_token (ignored if username is present)
 *              * appBaseURL - URL of oe-cloud app where data will be posted, e.g., 'http://localhost:3000'
 *              * modelAPI - API of Model where file data will be posted, e.g., '/api/Literals' (optional, can also be specified via payload)
 *              * method - HTTP method to be used for the processing - 'POST' / 'PUT' / 'GET' or 'DELETE'
 *              * headers - additional headers, if any, that need to be passed while making the request (optional)
 * @param {object} jobService - object containing the following properties:
 *              * @property {function} onStart - a function taking a single callback function as a parameter. (optional) 
 *              * @property {function} onEnd   - a function taking a single callback function as a parameter. (optional)
 *              * @property {function} onEachRecord - a function taking two parameters - recData (object), cb (callback function). This is mandatory.
 * @param {function} cb - callback function - gets called when all processing is finished                     
 */ 
function processFile(filePath, options, jobService, cb) {
    running = true;
    var start = new Date().getTime();       // For logging
    console.log("\n** Starting Batch Processing **");
    console.log("\n** Log Level can be set by env var BATCH_LOGGER_CONFIG **");
    console.log("** Possible values are: info, debug, warn, error, fatal **\n");
    log.debug("filePath = " + filePath);
    log.debug("options = " + JSON.stringify(options));
    log.debug("jobservice : " + jobService);

//6 // Some sanity checks
    if(!filePath || filePath.trim().length === 0) {
        log.fatal("filePath is not specified. Aborting processing.");
        process.exit(1);
    }
    if(!jobService) {
        log.fatal("jobService is not specified. Aborting processing.");
        process.exit(1);
    }
    if(!(jobService.onEachRecord && typeof jobService.onEachRecord === 'function')) {
        log.fatal("jobService.onEachRecord() is not defined. Aborting processing.");
        process.exit(1);
    }

    // We provide our own empty onStart(..) if one is not supplied
    if(!(jobService.onStart && typeof jobService.onStart === 'function')) {
        jobService.onStart = function(cb4) {
            log.debug("calling jobService.onStart");
            cb4({});
        };
    }

    // We provide our own empty onEnd(..) if one is not supplied
    if(!(jobService.onEnd && typeof jobService.onEnd === 'function')) {
        jobService.onEnd = function(cb5) {
            log.debug("calling jobService.onEnd");
            cb5();
        };
    }

    // Subscribing to ERROR state of limiter
    limiter.on('error', function (error) {
        log.fatal("An error occurred: ");
        log.fatal(error.message);

        // Upon a limiter error, Updating the previously inserted BatchRun record with stats and exiting thereafter
        updateBatchRun(error, function() { process.exit(1); });
    });


//7 // Subscribing to IDLE state of limiter
    limiter.on('idle', function () {
        log.debug("LIMITER is IDLE. calling jobService.onEnd()");

        // When limiter is IDLE, Calling onEnd(..) after all records are processed, i.e., 
        jobService.onEnd(function() {
            log.debug("jobService.onEnd finished, calling processFile cb");

            // After onEnd(..) returns (at the end of the run), Updating the previously inserted BatchRun record with stats 
            updateBatchRun(undefined, function() { cb(); });
            running = false;
        });
    });

//8 // This is where it all begins: Calling onStart(..)
    jobService.onStart(function(startOpts) {

//9     // First, get the access_token, without which we cannot proceed
        // if successfully obtained, access_token will be set as options.ctx.access_token2
        getAccessToken(options, function() {
            access_token = options && options.ctx && options.ctx.access_token2;          // store into global variable
            appBaseURL = process.env["APP_BASE_URL"] || (options && options.appBaseURL); // store into global variable
            if(!appBaseURL) {
                log.fatal("appBaseURL is neither specified in env var (APP_BASE_URL) nor in processFile options. Aborting job.");
                process.exit(1);
            }

//10        // Insert a new batchRun record that captures the parameters passed to processFile(..) 
            // and also the statistics at the end of the process run

            // generate id for new BatchRun
            batchRunId = uuidv4();
            var startTime = new Date();  // for batchRun record
            var batchRunDetails = {id: batchRunId, startTimeMillis: startTime.getTime(), startTime: startTime, filePath: filePath, options: options};
            var opts = {
                url: appBaseURL + "/api/BatchRuns" + (access_token ? "?access_token=" + access_token : ""),
                method: "POST",
                body: batchRunDetails,
                json: true,
                timeout: 10000,
                jar: true,
                headers: {
                    'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
                }
            };
            log.debug("POSTing batchRun " + JSON.stringify(batchRunDetails) + " to " + opts.url);
            try {
                request(opts, function(error, response, body) {
                    var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
                    if(response && response.statusCode !== 200) {
                        log.error("Error while posting batchRun: ERROR: " + JSON.stringify(error) + " STATUS: " + response.statusCode + " RESPONSE: " + JSON.stringify(response));
                        if(response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?. Aborting processing.");
                        process.exit(1);
                    } else {
                        batchRunVersion = body && body._version;
                        if(!batchRunVersion) {
                            log.error("could not get batchRun version");
                            process.exit(1);
                        }
                        log.debug("Posted batchRun successfully with Id: " + batchRunId);

                        jobService.options = options;
                        var lineNr = 0;

//11                    // Read the specified file as a stream, and process it line by line
                        var s = fs.createReadStream(filePath).pipe(es.split()).pipe(es.mapSync(function(rec) {
                                s.pause();
                                lineNr += 1;
                                log.debug("submitting job for rec#: " + lineNr);
                                var recData = {fileName: filePath, rec: rec, recId: lineNr};

//12                            // Here, we're queuing (submitting) the jobs to the "limiter", one job for each line in the file
                                // The "limiter" executes the jobs at a rate based of rate limit parameters in config. Parameters to
                                // submit are as follows:
                                // expiration - timeout for job
                                // id - an id for the job
                                // runJob - a function which is treated as the "job"
                                // jobService, recData, function(result) - parameters to runJob
                                // Limiter executes runJob with the above 3 parameters.
                                limiter.submit({expiration: 20000, id: lineNr}, runJob, jobService, recData, function(result) {

//13                                // Here, we're in the callback. We reach this point once a job (i.e., processing a single record) finishes
                                    // 'result' holds the result of execution of the job
                                    if(result.status === "FAILED") log.debug("Error while posting record: " + JSON.stringify(result));
                                    else log.debug("Successfully processed record: " + JSON.stringify(result));


//14                                // Now we're going to save the result of execution of the job to the BatchStatus model of the oe-cloud app
                                    var opts = {
                                        url: appBaseURL + "/api/BatchStatus" + (access_token ? "?access_token=" + access_token : ""),
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

                                            // Remove some large objects from the response for better-looking logs
                                            if(BATCH_RESULT_LOG_ITEMS.indexOf("error.details") === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                                            if(BATCH_RESULT_LOG_ITEMS.indexOf("error.stack") === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                                            if(BATCH_RESULT_LOG_ITEMS.indexOf("response.headers") === -1 && response && response.headers) response.headers = undefined;
                                            
                                            var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
                                            if(response && response.statusCode !== 200) {
                                                log.error("Error while posting status: ERROR: " + JSON.stringify(error) + " STATUS: " + JSON.stringify(result) + " RESPONSE: " + JSON.stringify(response));
                                                if(response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?");
                                            } else {
                                                log.debug("Posted status successfully for " + JSON.stringify(result.payload));
                                            }
                                            if(!running) {
                                                var end = new Date().getTime();
                                                console.log("Batch took " + ((end - start)/1000) + " sec");
                                                running = true; // reset running status so as to not enter this "if" multiple times 
                                            }
                                        });
                                    } catch(e) {
                                        failureCount++;
                                        log.error("Could not post status: ERROR: " + JSON.stringify(e) + " STATUS: " + JSON.stringify(result));
                                    }
                
                                });            
                                s.resume();
                            })
                            .on('error', function(err){   // handle errors while reading file stream
                                log.fatal('Error while reading file.' + JSON.stringify(err));
                                updateBatchRun(err, function() { process.exit(1); });
                            })
                            .on('end', function(){  // handle end of file
                                log.debug('Read entire file: ' + filePath)
                            })
                        );
                    }
                });
            } catch(e) {
                log.error("Could not post status: ERROR: " + JSON.stringify(e) + " STATUS: " + JSON.stringify(result));
            }
   
        });
       
    });
}

//15
/**
 * This function tries to obtain the access_token from on of the following, in the following order - 
 *     - environment variable ACCESS_TOKEN
 *     - login using options.ctx.username, options.ctx.password and options.ctx.tenantId
 *     - options.ctx.access_token
 * 
 * If found from one of the above, this function sets the access_token as options.ctx.access_token2
 * "access_token2" is used as "access_token" is reserved for user-specified access token.
 * 
 * @param {object} options 
 * @param {function} cb 
 */
function getAccessToken(options, cb) {
    log.debug("Trying to get access_token");

    // First, try to get access token from environment variable
    var access_token = process.env["ACCESS_TOKEN"];
    if(access_token) { 
        log.debug("access_token taken from env variable ACCESS_TOKEN");
        options.ctx.access_token2 = access_token;
        return cb();
    }
    // then see if username is specified in options. If so, try login
    else if(options && options.ctx && options.ctx.username)
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
                if(response && response.statusCode !== 200) {
                    log.fatal("Error received after posting user credentials: ERROR: " + JSON.stringify(error) + " RESPONSE: " + JSON.stringify(response));
                    process.exit(1);
                } else {
                    var access_token = body && body.access_token;
                    if(access_token) {
                        log.debug("Obtained access_token successfully for provided user credentials");
                        options.ctx.access_token2 = access_token;
                        return cb();
                    } else {
                        log.fatal("Could not get access_token by login: ERROR: " + JSON.stringify(error) + " RESPONSE: " + JSON.stringify(response));
                        process.exit(1);
                    }
                }
                
            });
        } catch(e) {
            log.warn("Could not post user credentials: ERROR: " + JSON.stringify(e));
            process.exit(1);
        }
    } 
    // finally, try to get access token directly from options
    else {
        log.debug("username is not specified in options.ctx. Won't try to login");
        access_token =  (options && options.ctx && options.ctx.access_token);
        if(access_token) {
            log.debug("access_token taken from options.ctx");
            options.ctx.access_token2 = access_token;
        }
        else log.warn("access_token neither in env var (ACCESS_TOKEN) / options.ctx nor available through login (user creds not available in options.ctx)");
        return cb();
    }
}

//16
/**
 * This function updates an existing BatchRun record with the current statistics (totalRecordCount,
 * successCount and failureCount), and also any error that might have occurred before staring
 * the file processing
 * @param {object} error - an object giving details of any error that might have occurred before starting file processing
 * @param {function} cb6 - a callback function that is called upon completion of the BatchRun update.
 */
function updateBatchRun(error, cb6) {
    var endTime = new Date();
    var batchRunStats = {_version: batchRunVersion, endTimeMillis: endTime.getTime(), endTime: endTime, totalRecordCount: totalRecordCount, successCount: successCount, failureCount: failureCount, error: error};
    var opts = {
        url: appBaseURL + "/api/BatchRuns/" + batchRunId + (access_token ? "?access_token=" + access_token : ""),
        method: "PUT",
        body: batchRunStats,
        json: true,
        timeout: 10000,
        jar: true,
        headers: {
            'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
        }
    };
    log.debug("Updating batchRun Stats " + JSON.stringify(batchRunStats) + " to " + opts.url);
    try {
        request(opts, function(error, response, body) {
            var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
            if(response && response.statusCode !== 200) {
                log.error("Error while PUTing batchRun Stats: ERROR: " + JSON.stringify(error) + " STATUS: " + response.statusCode + " RESPONSE: " + JSON.stringify(response) + " STATS: " + JSON.stringify(batchRunStats));
                if(response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?. Aborting processing.");
                process.exit(1);
            } else {
                log.debug("Successfully updated batchRun Stats: " + JSON.stringify(body));
            }
            cb6();
        });
    } catch(e) {
        log.error("Error while trying to update batchRun Stats: ERROR: " + JSON.stringify(e) + "STATS: " + JSON.stringify(batchRunStats));
        process.exit(1);
    }
}

//17
/**
 * This function is the "job" submitted to the Limiter for throttled execution. The Limiter executes
 * this function with the parameters supplied to it, which are as follows:
 * @param {object} jobService - An object passed to processFile(..) function - see processFile(..) above
 * @param {object} recData - An object containing the details of the current record for processing.
 *                           It has the following properties:
 *                           @property {string} fileName - Name of the file being processed
 *                           @property {string} rec - The current line from the file, for processing
 *                           @property {number} recId - The line number (in the file) of the current line 
 * @param {function} cb3 - A callback function that is called after processing the current line. It takes a
 *                         @param {object} result - object containing results of execution
 * 
 */
function runJob(jobService, recData, cb3) {
    log.debug("runJob started for : " + JSON.stringify(recData));

//18// Calling the jobService.onEachRecord(..) function to get the next record via callback, as a JSON (payload) for processing
    // 'payload' would contain a property called 'json', which is a json representation of the current record
    // The value of 'json' should be formatted as a valid payload for passing to the oe-cloud API specified by 'modelAPI' 
    jobService.onEachRecord(recData, function cb2(payload, err) {
        
        // Get base URL of oe-cloud app
        var appBaseURL = process.env["APP_BASE_URL"] || payload && payload.appBaseURL || (jobService.options && jobService.options.appBaseURL);
        if(!appBaseURL) {
            var msg = "appBaseURL is neither specified in processFile options nor passed in payload. Aborting job.";
            log.fatal(msg);
            updateBatchRun(msg, function() { process.exit(1); });
        }

        // Get access token
        var access_token = jobService.options && jobService.options.ctx && jobService.options.ctx.access_token2;
        if(!access_token) log.warn("Neither access_token is provided in env var (ACCESS_TOKEN) / options.ctx / payload.ctx nor user-credentials are provided in options.ctx");
        if(!payload || err) {
            log.error("There was an error processing file record to JSON: " + JSON.stringify(err));
            var retStatus = {fileRecordData: recData, payload: payload, status: "FAILED", error: err };
            totalRecordCount++; failureCount++;
            return cb3(retStatus);
        }

        // Get the oe-cloud API to be called
        var api = (payload.modelAPI ? payload.modelAPI : (jobService.options && jobService.options.modelAPI));
        if(!api) {
            var msg = "modelAPI is neither specified in processFile options nor passed in payload. Aborting job."
            log.fatal(msg);
            updateBatchRun(msg, function() { process.exit(1); });
        }

        // Form the URL and get the method and headers
        var url = appBaseURL + (api.startsWith("/") ? "" : "/") + api + (access_token ? "?access_token=" + access_token : "");
        var method = payload.method || (jobService.options && jobService.options.method);
        if(!method) {
            var msg = "method is neither specified in processFile options nor passed in payload. Aborting job.";
            log.fatal(msg);
            updateBatchRun(msg, function() { process.exit(1); });
        }
        var headers = { 'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json' };
        var additionalHeaders = (payload.headers ? payload.headers : (jobService.options && jobService.options.headers));
        if(additionalHeaders) {
            Object.keys(additionalHeaders).forEach(function(headerName) {
                headers[headerName] = additionalHeaders[headerName];
            });
        }

        // Request options
        var opts = {
            url: url,
            method: method,
            body: payload.json,
            json: true,
            timeout: 10000,
            jar: true,
            headers: headers
        };
        log.debug(opts.method + "ing " + JSON.stringify(opts.body) + " to " + opts.url);
        try {

//19        // Make the request to oe-cloud API and return the result via callback cb3
            request(opts, function(error, response, body) {
                var status =  (error || (response && response.statusCode) !== 200) ? "FAILED" : "SUCCESS";
                if(response && response.statusCode === 401) log.error("Check access_token/credentials. Expired/wrong?");
                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.details") === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                if(BATCH_RESULT_LOG_ITEMS.indexOf("error.stack") === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                if(BATCH_RESULT_LOG_ITEMS.indexOf("response.headers") === -1 && response && response.headers) response.headers = undefined;

                var retStatus = {};
                retStatus.fileRecordData = recData;
                retStatus.payload = payload;            // recording whatever is sent by jobService
                retStatus.requestOpts = opts;           // the options used to send the request
                retStatus.response = response && response.body;
                retStatus.statusText = status;
                retStatus.statusCode = response && response.statusCode;
                retStatus.error = error ? (error.message ? error.message : error)  : status === "FAILED" ? response && response.body : undefined;
                totalRecordCount++;
                if(response.statusCode === 200) successCount++; else failureCount++;
                return cb3(retStatus);
            });
        } catch(e) {
            totalRecordCount++; failureCount++;
            var retStatus = {fileRecordData: recData, payload: payload, requestOpts: opts, response: null, statusText: "FAILED", error: e };
            return cb3(retStatus);
        }

    });
}

//20 // export the processFile(..) function and make it available to clients
exports.processFile = processFile;