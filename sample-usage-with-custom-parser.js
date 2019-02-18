/*
©2015-2016 EdgeVerve Systems Limited (a fully owned Infosys subsidiary), Bangalore, India. All Rights Reserved.
The EdgeVerve proprietary software program ("Program"), is protected by copyrights laws, international treaties and other pending or existing intellectual property rights in India, the United States and other countries.
The Program may contain/reference third party or open source components, the rights to which continue to remain with the applicable third party licensors or the open source community as the case may be and nothing here transfers the rights to the third party and open source components, except as expressly permitted.
Any unauthorized reproduction, storage, transmission in any form or by any means (including without limitation to electronic, mechanical, printing, photocopying, recording or  otherwise), or any distribution of this Program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
*/
/**
 * This sample usage file uses the batch-processing module and runs standalone with
 * `node sample-usage-with-custom.js`  command.
 *
 * A custom (user-defined) function is used to parse the data-file.
 *
 * Make sure the oe-Cloud app is running at `options.appBaseURL` before running this script.
 *
 * When run, it takes the data in `filePath` variable and inserts it into the model
 * whose API is in `options.modelAPI`.
 *
 * For authentication to the oeCloud app, `options.ctx` can either contain `username`,
 * `password` and `tenantId` or it can contain just a valid `access_token`.

 * @file sample-usage-with-custom-parser.js
 * @author Ajith Vasudevan
 */


var filePath = 'test/batch-100.txt';         // The file to be processed
var options = {                              // Create a batch-processing options object

  // ctx: {access_token: "P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx"},
  ctx: {username: 'judith', password: 'Edge@2017$', tenantId: '/default'},
  appBaseURL: 'http://localhost:3000',
  modelAPI: '/api/Literals',
  method: 'POST',
  headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}
};

var jobService = {                        // Create a jobService object

  onStart: function onStart(cb) {      // Optional
    cb({});
  },

  onEnd: function onEnd(cb) {         // Optional
    cb();
  },

  onEachRecord: function onEachRecord(recData, cb) {                                      // Using custom parser
    var json = {'key': recData.rec.split(' ')[0], 'value': recData.rec.split(' ')[1]};
    var payload = {
      json: json
      // modelAPI: "/api/Literals",       // Optional
      // method: "POST",                  // Optional
      // headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}   // Optional
    };
    var errMsg = payload ? null : "Couldn't get payload for recId " + (recData && recData.recId);
    cb(payload, errMsg);    // If a valid payload could be created, set second param to null
    // If a valid payload could not be created, set second param to the error message
    // If this record needs to be ignored, set both params to null;
  },

  onEachResult: function onEachResult(result) {                                     // Optional
    // console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
  }
};

var batchProcessing = require('.');                                                    // Requiring the batch-processing module

batchProcessing.processFile(filePath, options, jobService, function (e) {                // Calling the processFile(..) function to start processing the file
  if (!e) console.log('file ' + filePath + ' processed successfully');
  else console.log(e);
});
