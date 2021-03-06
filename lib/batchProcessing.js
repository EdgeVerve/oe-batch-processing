/*
©2015-2016 EdgeVerve Systems Limited (a fully owned Infosys subsidiary), Bangalore, India. All Rights Reserved.
The EdgeVerve proprietary software program ("Program"), is protected by copyrights laws, international treaties and other pending or existing intellectual property rights in India, the United States and other countries.
The Program may contain/reference third party or open source components, the rights to which continue to remain with the applicable third party licensors or the open source community as the case may be and nothing here transfers the rights to the third party and open source components, except as expressly permitted.
Any unauthorized reproduction, storage, transmission in any form or by any means (including without limitation to electronic, mechanical, printing, photocopying, recording or  otherwise), or any distribution of this Program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
*/
/**
 * There is a requirement in many applications to load data into the application database from flat (text) files.
 * Such a data load should honor all application validations and rules supported by the application for the specific
 * type of data being loaded. The data files may contain a large number of records, one record per line.
 * A line is assumed to be terminated by a newline (\n) character.
 *
 * Since file reading and processing is very processor intensive, the batch-processing module is kept separate
 * from the oe-cloud application, and it is run in a separate NodeJS VM. This also means that the batch-processing
 * module can be scaled separately. The module uses http REST API of the oe-cloud application to load the data into
 * the application database.
 *
 * This ensures that -
 *
 * 1. all business validations and rules are applied for each record during the insert/update
 * 2. the application processing is load-balanced automatically, taking advantage of the application's infrastructure.
 *
 * Considering the above, this oe-cloud batch-processing solution is built as a separate nodejs
 * module (not included in the oe-cloud framework).
 * This module can be "required" and its main function called by anyone (for e.g., by a batch client,
 * or a batch scheduler or Node-RED, etc.,) who wishes to start a batch job for processing a file containing
 * text data, one record per line.

 * @module batch-processing
 * @author Ajith Vasudevan
 */

var log, uuidv4, LineByLineReader, Bottleneck, request;
if (!process.env.LOGGER_CONFIG && process.env.BATCH_LOGGER_CONFIG) {
  process.env.LOGGER_CONFIG = JSON.stringify({'levels': {'default': process.env.BATCH_LOGGER_CONFIG.trim().toLocaleLowerCase()}});
}
try {
// 1 // Libraries required by this module
  log = require('oe-logger')('batch-processing');
  // Used to create id for the BatchRun record that we will be creating
  // for each run of the processFile(..) function
  uuidv4 = require('uuid/v4');
  // Module that reads files line by line with ability to pause and resume file reading
  LineByLineReader = require('line-by-line');
  request = require('request');
  // Module that manages the rate-limiting or throttling of the file processing
  Bottleneck = require('bottleneck');
} catch (e) {console.log('\n\n'); console.log(e && e.message ? e.message : e); console.log('\nHave you run `npm install`?\n\n'); process.exit(1);}


var batchRunInserted = false;
var onEndCalled = false;
var errMsg;


// 2 // Set log level programmatically using our own env var BATCH_LOGGER_CONFIG
// if it is set, but not LOGGER_CONFIG
// e.g., set BATCH_LOGGER_CONFIG=debug  for setting log level to debug
if (!process.env.LOGGER_CONFIG && process.env.BATCH_LOGGER_CONFIG) {
  process.env.LOGGER_CONFIG = JSON.stringify({'levels': {'default': process.env.BATCH_LOGGER_CONFIG.trim().toLocaleLowerCase()}});
}

// 3 // Read the batch processing config file
/*
Example config:
{
    "maxConcurrent": 80,      // Maximum number of records processed in parallel
    "minTime": 20,            // Minimum time delay between start times of two records being processed, in ms
    "batchResultLogItems": "",  // Comma separated list of items that can be included in the default response that
                                // is logged to DB. Possible values: error.details, error.stack, response.headers
    "appBaseURL": "http://localhost:3000"
}
*/
var config, progressInterval, startTime, endTime, pCount = 0;
try {
  if (typeof global.it !== 'function') {
    config = require(process.cwd() + '/batch-config.json');
  } else {
    config = require('../test/batch-config.json');
  }
  log.info('Config: ' + JSON.stringify(config));
} catch (e) {
  log.warn('No config file found. Using default values for batch processing configuration');
}


var bottleNeckConfig = { maxConcurrent: process.env.MAX_CONCURRENT ? Number(process.env.MAX_CONCURRENT) :
  (config && config.maxConcurrent) ? config.maxConcurrent : 80,
minTime: process.env.MIN_TIME ? Number(process.env.MIN_TIME) :
  (config && config.minTime) ? config.minTime : 20 };
if (require.main !== module) log.info('BottleNeck Config: ' + JSON.stringify(bottleNeckConfig));

// the module-object used to queue jobs and execute them with rate-limiting/throttling
var limiter;

// list of items to log in addition to default items
var BATCH_RESULT_LOG_ITEMS = process.env.BATCH_RESULT_LOG_ITEMS || (config && config.batchResultLogItems) || '';
if (require.main !== module) log.info('BATCH_RESULT_LOG_ITEMS = ' + BATCH_RESULT_LOG_ITEMS);

// Maximum number of jobs that can be queued before pausing the file reading
var MAX_QUEUE_SIZE = process.env.MAX_QUEUE_SIZE ? Number(process.env.MAX_QUEUE_SIZE) : (config && config.maxQueueSize) || 50000;
if (require.main !== module) log.info('MAX_QUEUE_SIZE = ' + MAX_QUEUE_SIZE);

var appBaseURL, access_token, batchRunId, batchRunVersion, totalRecordCount = 0, successCount = 0, failureCount = 0;
var eof = false;  // Flag that changes state when the file is completely read
var lr;           // Line by line reader

// 5
/**
 * This function is exported from this batch-processing module, and is the one that needs to be
 * called by clients who wish to batch-process files
 *
 * parameters to be passed are as follows:
 *
 * @param {string} filePath - fully qualified fileName (with path) of the data-file to be processed
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
 *              * @property {function} onEachResult - a function taking a single parameter - result (object). The result structure is as folows: {fileRecordData: recData, payload: payload, statusText: "FAILED", error: err };
 * @param {function} cb - callback function - gets called when all processing is finished. If an error occurs, cb is called with a non-null error object.
 * @returns {none} Returns nothing
 */
function processFile(filePath, options, jobService, cb) {
  var start = new Date().getTime();       // For logging
  console.log('\n** Starting Batch Processing **');
  console.log('\n** Log Level can be set by env var BATCH_LOGGER_CONFIG **');
  console.log('** Possible values are: info, debug, warn, error, fatal **\n');
  log.debug('filePath = ' + filePath);
  log.debug('options = ' + JSON.stringify(options));
  log.debug('jobservice : ' + jobService);
  batchRunInserted = false;
  onEndCalled = false;
  totalRecordCount = 0;
  successCount = 0;
  failureCount = 0;
  access_token = null;
  appBaseURL = null;
  access_token = null;
  batchRunId = null;
  batchRunVersion = null;
  eof = false;
  limiter = new Bottleneck(bottleNeckConfig);
  pCount = 0;

  // 6 // Some sanity checks
  if (!filePath || filePath.trim().length === 0) {
    errMsg = 'filePath is not specified. Aborting processing.';
    log.fatal(errMsg);
    clearInterval(progressInterval);
    return cb(new Error(errMsg));
  }
  if (!jobService) {
    errMsg = 'jobService is not specified. Aborting processing.';
    log.fatal(errMsg);
    clearInterval(progressInterval);
    return cb(new Error(errMsg));
  }
  if (!(jobService.onEachRecord && typeof jobService.onEachRecord === 'function')) {
    errMsg = 'jobService.onEachRecord() is not defined. Aborting processing.';
    log.fatal(errMsg);
    clearInterval(progressInterval);
    return cb(new Error(errMsg));
  }

  // We provide our own empty onStart(..) if one is not supplied
  if (!(jobService.onStart && typeof jobService.onStart === 'function')) {
    jobService.onStart = function (cb4) {
      log.debug('calling jobService.onStart');
      cb4({});
    };
  }

  // We provide our own empty onEnd(..) if one is not supplied
  if (!(jobService.onEnd && typeof jobService.onEnd === 'function')) {
    jobService.onEnd = function (cb5) {
      log.debug('calling jobService.onEnd');
      cb5();
    };
  }

  // We provide our own empty onEachResult(..) if one is not supplied
  if (!(jobService.onEachResult && typeof jobService.onEachResult === 'function')) {
    jobService.onEachResult = function (r) {
      log.debug('calling jobService.onEachResult');
    };
  }
  var limiterError = false;
  // Subscribing to ERROR state of limiter
  limiter.on('error', function (error) {
    if (!limiterError) {
      limiterError = true;
      errMsg = error && (error.message ? error.message : JSON.stringify(error));
      console.log(error);
      log.fatal(errMsg);

      // Upon a limiter error, Updating the previously inserted BatchRun record with stats and exiting thereafter
      // updateBatchRun(errMsg, function() {
      // });
      clearInterval(progressInterval);
      return cb(error);
    }
  });

  onEndCalled = false;
  // 7 // Subscribing to IDLE state of limiter
  limiter.on('idle', function () {
    if (!onEndCalled) {
      onEndCalled = true;
      log.debug('LIMITER is IDLE. calling jobService.onEnd()');
      if (!eof) { lr.resume(); return; }  // Start queuing records for processing once the current queue is processed and the limiter is idle
      // When eof and limiter is IDLE, Calling onEnd(..) after all records are processed, i.e.,
      jobService.onEnd(function () {
        log.debug('jobService.onEnd finished, calling processFile cb');
        // After onEnd(..) returns (at the end of the run), Updating the previously inserted BatchRun record with stats
        updateBatchRun(undefined, function () {
          cb();
        });
        process.stdout.write('- PROCESSED ' + totalRecordCount + ' Records, ' + successCount + ' SUCCEEDED, ' + failureCount + ' FAILED in ' + (endTime - startTime) / 1000 + ' sec. Limiter Stats: ' + JSON.stringify(limiter.counts()) + '  ');
        var mem = process.memoryUsage();
        for (let key in mem) {
          process.stdout.write(`${key}:${Math.round(mem[key] / 1024 / 1024 * 100) / 100} MB `);
        }
        console.log('');
        clearInterval(progressInterval);

        var end = new Date().getTime();
        console.log('\nBatch took ' + ((end - start) / 1000) + ' sec\n');
      });
    } else cb();
  });

  // 8 // This is where it all begins: Calling onStart(..)
  jobService.onStart(function (startOpts) {
    // 9     // First, get the access_token, without which we cannot proceed
    // if successfully obtained, access_token will be set as options.ctx.access_token2
    getAccessToken(options, function () {
      access_token = options && options.ctx && options.ctx.access_token2;          // store into global variable
      appBaseURL = process.env.APP_BASE_URL || (options && options.appBaseURL); // store into global variable

      // 10        // Insert a new batchRun record that captures the parameters passed to processFile(..)
      // and also the statistics at the end of the process run

      // generate id for new BatchRun
      batchRunId = uuidv4();
      startTime = new Date();  // for batchRun record
      var batchRunDetails = {id: batchRunId, startTimeMillis: startTime.getTime(), startTime: startTime, filePath: filePath, options: options};
      var opts = {
        url: appBaseURL + '/api/BatchRuns' + (access_token ? '?access_token=' + access_token : ''),
        method: 'POST',
        body: batchRunDetails,
        json: true,
        timeout: 10000,
        jar: true,
        headers: {
          'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
        }
      };
      log.debug('POSTing batchRun ' + JSON.stringify(batchRunDetails) + ' to ' + opts.url);
      try {
        request(opts, function (error, response, body) {
          if (error || (response && response.statusCode) !== 200) {
            log.error('Error while posting batchRun: ERROR: ' + JSON.stringify(error) + ' STATUS: ' + (response && response.statusCode) + ' RESPONSE: ' + JSON.stringify(response));

            if (response && response.statusCode === 401) {
              errMsg = 'Check access_token/credentials. Expired/Wrong/Missing?. Aborting processing.';
              console.log('\n' + errMsg + '\n');
            }
            /* istanbul ignore if */
            if (error && error.code === 'ECONNREFUSED') {
              errMsg = "Is the oe-Cloud Application running? Check that it is running at the URL specified ( '" + appBaseURL + "' )";
              console.log('\n' + errMsg + '\n');
            }
            /* istanbul ignore if */
            if (response && response.statusCode === 404) {
              errMsg = 'Check if oe-Cloud app has the necessary models required for batch-processing: `BatchStatus` and `BatchRun`. Aborting processing.';
              console.log('\n' + errMsg + '\n');
            }
            clearInterval(progressInterval);
            cb(new Error(errMsg));
          } else {
            batchRunVersion = body && body._version;
            /* istanbul ignore if */
            if (!batchRunVersion) {
              errMsg = 'could not get batchRun version';
              log.error(errMsg);
              throw new Error(errMsg);
            }
            log.debug('Posted batchRun successfully with Id: ' + batchRunId);
            batchRunInserted = true;
            jobService.options = options;
            var lineNr = 0;
            var PROGRESS_INTERVAL = (process.env.PROGRESS_INTERVAL ? Number(process.env.PROGRESS_INTERVAL) : (config && config.progressInterval || 10000));
            /* istanbul ignore else */
            if (PROGRESS_INTERVAL !== 0) {
              // Show progress at regular intervals
              progressInterval = setInterval(
                /* istanbul ignore next */
                function () {
                  process.stdout.write('- PROCESSED ' + totalRecordCount + ' Records, ' + successCount + ' SUCCEEDED, ' + failureCount + ' FAILED in ' + (++pCount) * PROGRESS_INTERVAL / 1000 + ' sec. Limiter Stats: ' + JSON.stringify(limiter.counts()) + '  ');
                  var mem = process.memoryUsage();
                  for (let key in mem) process.stdout.write(`${key}:${Math.round(mem[key] / 1024 / 1024 * 100) / 100} MB `);
                  console.log('');
                }, PROGRESS_INTERVAL);
            }

            // Read the specified file, ...
            lr = new LineByLineReader(filePath);
            // 11                    // ... and process it line by line
            lr.on('line', function (rec) {
              lr.pause();     // pause reading more lines (i.e., stop this 'line' event) until the current line is queued for processing
              lineNr += 1;
              log.debug('submitting job for rec#: ' + lineNr);
              var recData = {fileName: filePath, rec: rec, recId: lineNr};   // create the record data object for submission

              // 12                        // Here, we're queuing (submitting) the jobs to the "limiter", one job for each line in the file
              // The "limiter" executes the jobs at a rate based of rate limit parameters in config.
              // Parameters to submit(..) are as follows:
              //  *  expiration - timeout for job
              //     id - an id for the job
              //  *  runJob           - a function which is treated as the "job" by the Limiter
              //  *  jobService,      - parameter to runJob
              //  *  recData,         - parameter to runJob
              //  *  function(result) - parameter to runJob
              // Limiter executes runJob with the above 3 parameters.
              limiter.submit({expiration: 25000, id: lineNr}, runJob, jobService, recData, function (result) {
                // 13                            // Here, we're in the job's callback. We reach this point once a job (i.e., processing a single record) finishes
                // 'result' holds the result of execution of the job

                if (result === null || result === undefined) return;  // Null result means we did not get a payload, so ignoring and not proceeding

                if (result.statusText === 'FAILED') log.debug('Error while posting record: ' + JSON.stringify(result));
                else if (result.statusText === 'SUCCESS') log.debug('Successfully processed record: ' + JSON.stringify(result));
                else {
                  lr.pause();
                  limiter.updateSettings({reservoir: 0});
                  console.log(result);
                  clearInterval(progressInterval);
                  throw new Error(result.error);
                }


                // 14                                // Now we're going to save the result of execution of the job to the BatchStatus model of the oe-cloud app

                if (typeof result.error === 'string') result.error = {errorMessage: result.error};
                var opts = {
                  url: appBaseURL + '/api/BatchStatus' + (access_token ? '?access_token=' + access_token : ''),
                  method: 'POST',
                  body: result,
                  json: true,
                  timeout: 10000,
                  jar: true,
                  headers: {
                    'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
                  }
                };
                log.debug('POSTing result ' + JSON.stringify(result) + ' to ' + opts.url);
                try {
                  request(opts, function (error, response, body) {
                    // Remove some large objects from the response for better-looking logs
                    /* istanbul ignore if */
                    if (BATCH_RESULT_LOG_ITEMS.indexOf('error.details') === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
                    /* istanbul ignore if */
                    if (BATCH_RESULT_LOG_ITEMS.indexOf('error.stack') === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
                    if (BATCH_RESULT_LOG_ITEMS.indexOf('response.headers') === -1 && response && response.headers) response.headers = undefined;

                    /* istanbul ignore if */
                    if (response && response.statusCode !== 200) {
                      log.error('Error while posting status: ERROR: ' + JSON.stringify(error) + ' STATUS: ' + JSON.stringify(result) + ' RESPONSE: ' + JSON.stringify(response));
                      if (response && response.statusCode === 401) log.error('Check access_token/credentials. Expired/wrong?');
                    } else {
                      log.debug('Posted status successfully for ' + JSON.stringify(result.payload));
                    }
                  });
                }
                /* istanbul ignore next */
                catch (e) {
                  failureCount++;
                  log.error('Could not post status: ERROR: ' + JSON.stringify(e) + ' STATUS: ' + JSON.stringify(result));
                }
              });

              /* istanbul ignore else */
              if (limiter.counts().RECEIVED < MAX_QUEUE_SIZE) lr.resume();
            });

            lr.on('error', function (err) {   // handle errors while reading file stream
              errMsg = 'Error while reading file.' + JSON.stringify(err);
              log.fatal(errMsg);
              console.log(errMsg);
              updateBatchRun(errMsg, function () {
              });
              clearInterval(progressInterval);
              lr.close();
              cb(err);
            });
            lr.on('end', function () {  // handle end of file
              eof = true;
              log.debug('Read entire file: ' + filePath);
            });

            // limiter.on('depleted', function () {
            //     s.resume();
            // });
          }
        });
      }
      /* istanbul ignore next */
      catch (e) {
        log.error('Could not post status: ERROR: ' + JSON.stringify(e));
      }
    });
  });
}

// 15
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
 * @returns {none} returns nothing
 */
function getAccessToken(options, cb) {
  log.debug('Trying to get access_token');

  // First, try to get access token from environment variable
  var access_token = process.env.ACCESS_TOKEN;
  /* istanbul ignore if */
  if (access_token) {
    log.debug('access_token taken from env variable ACCESS_TOKEN');
    options.ctx.access_token2 = access_token;
    return cb();
  }
  // then see if username is specified in options. If so, try login
  else if (options && options.ctx && options.ctx.username) {
    log.debug('Found username in options.ctx. Will try login for obtaining access_token');
    /* istanbul ignore if */
    if (!options.ctx.password) log.warn('password is not specified in options.ctx');
    /* istanbul ignore if */
    if (!options.ctx.tenantId) log.warn('tenantId is not specified in options.ctx');
    var appBaseURL = process.env.APP_BASE_URL || (options && options.appBaseURL);
    if (!appBaseURL) {
      errMsg = "appBaseURL is not specified in env variable (APP_BASE_URL) or options. Can't defer this to payload when username is specified. Aborting job.";
      log.fatal(errMsg);
      throw new Error(errMsg);
    }

    var loginAPI = '/api/users/login';
    /* istanbul ignore if */
    if (typeof global.it !== 'function') {
      loginAPI = process.env.BATCH_PROCESSING_LOGIN_URL || '/api/AppUsers/login';
    }

    var opts = {
      url: appBaseURL + loginAPI,
      method: 'POST',
      body: {username: options.ctx.username, password: options.ctx.password},
      json: true,
      timeout: 30000,
      headers: {
        'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
      }
    };

    /* istanbul ignore else */
    if (options.ctx.tenantId) opts.headers['tenant-id'] = options.ctx.tenantId;

    log.debug('POSTing user credentials for obtaining access_token to ' + opts.url);
    try {
      request(opts, function (error, response, body) {
        if (response && response.statusCode !== 200) {
          errMsg = 'Error received after posting user credentials: ERROR: ' + JSON.stringify(error) + ' RESPONSE: ' + JSON.stringify(response);
          log.fatal(errMsg);
          cb(new Error(errMsg));
        } else {
          var access_token = body && body.id;
          /* istanbul ignore else */
          if (access_token) {
            log.debug('Obtained access_token successfully for provided user credentials');
            options.ctx.access_token2 = access_token;
            return cb();
          }
          errMsg = 'Could not get access_token by login: ERROR: ' + JSON.stringify(error) + ' RESPONSE: ' + JSON.stringify(response);
          log.fatal(errMsg);
          /* istanbul ignore if */
          if (error && error.code === 'ECONNREFUSED') {
            errMsg = "Is the oe-Cloud Application running? Check that it is running at the URL specified ( '" + appBaseURL + "' )";
            console.log('\n' + errMsg + '\n');
          }
          throw new Error(errMsg);
        }
      });
    }
    /* istanbul ignore next */
    catch (e) {
      errMsg = 'Could not post user credentials: ERROR: ' + JSON.stringify(e);
      log.fatal(errMsg);
      throw new Error(errMsg);
    }
  }
  // finally, try to get access token directly from options
  else {
    log.debug("username is not specified in options.ctx. Won't try to login");
    access_token =  (options && options.ctx && options.ctx.access_token);
    /* istanbul ignore if */
    if (access_token) {
      log.debug('access_token taken from options.ctx');
      options.ctx.access_token2 = access_token;
    } else log.warn('access_token neither in env var (ACCESS_TOKEN) / options.ctx nor available through login (user creds not available in options.ctx)');
    return cb();
  }
}

// 16
/**
 * This function updates an existing BatchRun record with the current statistics (totalRecordCount,
 * successCount and failureCount), and also any error that might have occurred before staring
 * the file processing
 * @param {object} error - an object giving details of any error that might have occurred before starting file processing
 * @param {function} cb6 - a callback function that is called upon completion of the BatchRun update.
 */
function updateBatchRun(error, cb6) {
  if (typeof error === 'string') {
    var tmpErrorObj;
    try {
      tmpErrorObj = JSON.parse(error);
      error = tmpErrorObj;
    } catch (e) {
      error = {errorMessage: error };
    }
  }

  if (!batchRunInserted) return cb6();
  endTime = new Date();
  var batchRunStats = {_version: batchRunVersion, endTimeMillis: endTime.getTime(), endTime: endTime, durationMillis: (endTime.getTime() - startTime.getTime()), totalRecordCount: totalRecordCount, successCount: successCount, failureCount: failureCount, error: error};
  var opts = {
    url: appBaseURL + '/api/BatchRuns/' + batchRunId + (access_token ? '?access_token=' + access_token : ''),
    method: 'PUT',
    body: batchRunStats,
    json: true,
    timeout: 10000,
    jar: true,
    headers: {
      'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json'
    }
  };
  log.debug('Updating batchRun Stats ' + JSON.stringify(batchRunStats) + ' to ' + opts.url);
  try {
    request(opts, function (error, response, body) {
      /* istanbul ignore if */
      if (response && response.statusCode !== 200) {
        errMsg = 'Error while PUTing batchRun Stats: ERROR: ' + JSON.stringify(error) + ' STATUS: ' + response.statusCode + ' RESPONSE: ' + JSON.stringify(response) + ' STATS: ' + JSON.stringify(batchRunStats);
        log.error(errMsg);
        if (response && response.statusCode === 401) {
          errMsg = 'Check access_token/credentials. Expired/wrong?. Aborting processing.';
          log.error(errMsg);
        }
        throw new Error(errMsg);
      } else {
        batchRunVersion = body && body._version;
        log.debug('Successfully updated batchRun Stats: ' + JSON.stringify(body));
      }
      cb6();
    });
  }
  /* istanbul ignore next */
  catch (e) {
    errMsg = 'Error while trying to update batchRun Stats: ERROR: ' + JSON.stringify(e) + 'STATS: ' + JSON.stringify(batchRunStats);
    log.error(errMsg);
    throw new Error(errMsg);
  }
}

// 17
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
  log.debug('runJob started for : ' + JSON.stringify(recData));

  // 18// Calling the jobService.onEachRecord(..) function to get the next record via callback, as a JSON (payload) for processing
  // 'payload' would contain a property called 'json', which is a json representation of the current record
  // The value of 'json' should be formatted as a valid payload for passing to the oe-cloud API specified by 'modelAPI'
  try {
    jobService.onEachRecord(recData, function cb2(payload, err) {
      // Get base URL of oe-cloud app
      var appBaseURL = process.env.APP_BASE_URL || payload && payload.appBaseURL || (jobService.options && jobService.options.appBaseURL);

      // Get access token
      var access_token = jobService.options && jobService.options.ctx && jobService.options.ctx.access_token2;
      /* istanbul ignore if */
      if (!access_token) {
        log.warn('Neither access_token is provided in env var (ACCESS_TOKEN) / options.ctx / payload.ctx nor user-credentials are provided in options.ctx');
      }

      // Check for error from onEachRecord
      if (err) {  // Do not proceed with POSTing in there was an error
        log.error('There was an error processing file record to JSON: ' + JSON.stringify(err));
        var retStatus = {fileRecordData: recData, payload: payload, statusText: 'FAILED', error: err };
        totalRecordCount++; failureCount++;
        try { jobService.onEachResult(retStatus); } catch (e) { console.log(1); log.error('Error after calling jobService.onEachResult(..): ' + ((e && e.message) ? e.message : JSON.stringify(e))); }
        return cb3(retStatus);
      } else if (!payload) {  // If there was no error, but also there's no payload, we'll ignore this record
        log.debug('No payload passed. This record will be ignored. No action will be taken and nothing will be posted to BatchStatus / BatchRun');
        return cb3(null);
      }

      // Get the oe-cloud API to be called
      var api = process.env.MODEL_API ? process.env.MODEL_API : (payload.modelAPI ? payload.modelAPI : (jobService.options && jobService.options.modelAPI));
      if (!api) {
        errMsg = 'modelAPI is neither specified in environment variable (MODEL_API) nor processFile options nor passed in payload. Aborting job.';
        log.fatal(errMsg);
        updateBatchRun(errMsg, function () {
        });
        lr.pause();
        limiter.updateSettings({reservoir: 0});
        retStatus = {fileRecordData: recData, payload: null, requestOpts: null, response: null, statusText: 'FATAL', error: new Error(errMsg) };
        try { jobService.onEachResult(retStatus); } catch (e) { console.log(e); log.error('Error after calling jobService.onEachResult(..): ' + ((e && e.message) ? e.message : JSON.stringify(e))); }
        return cb3(retStatus);
      }

      // Form the URL and get the method and headers
      var url = appBaseURL + (api.startsWith('/') ? '' : '/') + api + (access_token ? '?access_token=' + access_token : '');
      var method = payload.method || (jobService.options && jobService.options.method);
      /* istanbul ignore if */
      if (!method) {
        errMsg = 'method is neither specified in processFile options nor passed in payload. Aborting job.';
        log.fatal(errMsg);
        updateBatchRun(errMsg, function () {
        });
        throw new Error(errMsg);
      }
      var headers = { 'Cookie': 'Content-Type=application/json; charset=encoding; Accept=application/json' };
      var additionalHeaders = (payload.headers ? payload.headers : (jobService.options && jobService.options.headers));
      /* istanbul ignore if */
      if (additionalHeaders) {
        Object.keys(additionalHeaders).forEach(function (headerName) {
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
      log.debug(opts.method + 'ing ' + JSON.stringify(opts.body) + ' to ' + opts.url);
      try {
        // 19        // Make the request to oe-cloud API and return the result via callback cb3
        request(opts, function (error, response, body) {
          var status =  (error || (response && response.statusCode) !== 200) ? 'FAILED' : 'SUCCESS';
          if (response && response.statusCode === 401) log.error('Check access_token/credentials. Expired/wrong?');
          /* istanbul ignore if */
          if (BATCH_RESULT_LOG_ITEMS.indexOf('error.details') === -1 && response && response.body && response.body.error && response.body.error.details) response.body.error.details = undefined;
          /* istanbul ignore if */
          if (BATCH_RESULT_LOG_ITEMS.indexOf('error.stack') === -1 && response && response.body && response.body.error && response.body.error.stack) response.body.error.stack = undefined;
          /* istanbul ignore else */
          if (BATCH_RESULT_LOG_ITEMS.indexOf('response.headers') === -1 && response && response.headers) response.headers = undefined;

          var retStatus = {};
          retStatus.fileRecordData = recData;
          retStatus.payload = payload;            // recording whatever is sent by jobService
          retStatus.requestOpts = opts;           // the options used to send the request
          retStatus.response = response && response.body;
          retStatus.statusText = status;
          retStatus.statusCode = response && response.statusCode;
          retStatus.error = error ? (error.message ? error.message : error)  : status === 'FAILED' ? response && response.body : undefined;
          totalRecordCount++;
          if (response && response.statusCode === 200) successCount++; else failureCount++;
          try { jobService.onEachResult(retStatus); } catch (e) { console.log(2); log.error('2Error after calling jobService.onEachResult(..): ' + ((e && e.message) ? e.message : JSON.stringify(e))); }
          return cb3(retStatus);
        });
      }
      /* istanbul ignore next */
      catch (e) {
        totalRecordCount++; failureCount++;
        retStatus = {fileRecordData: recData, payload: payload, requestOpts: opts, response: null, statusText: 'FAILED', error: e };
        try { jobService.onEachResult(retStatus); } catch (e) { console.log(3); log.error('Error after calling jobService.onEachResult(..): ' + ((e && e.message) ? e.message : JSON.stringify(e))); }
        return cb3(retStatus);
      }
    });
  } catch (e) {
    lr.pause();
    limiter.updateSettings({reservoir: 0});
    var retStatus = {fileRecordData: recData, payload: null, requestOpts: null, response: null, statusText: 'FATAL', error: e };
    try { jobService.onEachResult(retStatus); } catch (e) { console.log(e); log.error('Error after calling jobService.onEachResult(..): ' + ((e && e.message) ? e.message : JSON.stringify(e))); }
    return cb3(retStatus);
  }
}

/* istanbul ignore if */
if (require.main === module) {
  console.log('\n\n ============================= Batch Processing =============================\n');
  console.log('This is a standalone NodeJS module that can be used to insert/update records');
  console.log('from a flat (text) file containing lines, one line per record. ');
  console.log('Transformation logic needs to be provided by the client in the form of ');
  console.log('a `onEachRecord(..)` function. This function needs to be a member of a');
  console.log('`JobService` object.\n');
  console.log('See README.md or https://github.com/EdgeVerve/batch-processing for more info.\n');
  console.log('Also see the `sample-usage.js` in the `batch-processing` project ');
  console.log('root for an example usage. Run it with \n');
  console.log('    $ node sample-usage.js\n');
  console.log(' ============================================================================\n\n');
}

// 20 // export the processFile(..) function and make it available to clients
exports.processFile = processFile;

