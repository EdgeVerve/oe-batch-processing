/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This sample usage file uses the batch-processing module and runs standalone with 
 * `node sample-usage-with-builtin-fw-parser.js`  command.
 * 
 * The "Fixed Width" (FW) built-in parser from the included parsers module is used to parse 
 * Fixed Width Vaule (FWV) data-file.
 * 
 * Make sure the oe-Cloud app is running at `options.appBaseURL` before running this script.
 * 
 * When run, it takes the data in `filePath` variable and inserts it into the model
 * whose API is in `options.modelAPI`. 
 * 
 * For authentication to the oeCloud app, `options.ctx` can either contain `username`, 
 * `password` and `tenantId` or it can contain just a valid `access_token`.

 * @file sample-usage-with-builtin-fw-parser.js
 * @author Ajith Vasudevan
 */

var parsers = require('./parsers'); 

var filePath = "test/fwbatch-100.fwv";                          // The file to be processed
var options = {                                                // Create a batch-processing options object
        //ctx: {access_token: "P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx"},
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
        appBaseURL: 'http://localhost:3000',
        modelAPI: '/api/Literals',
        method: 'POST'
    };

var parserOpts = {
    fwHeaders: [
        { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5, justification: 'Left' },
        { fieldName: 'value', type: 'boolean', length: 8, startPosition: 6, endPosition: 13, justification: 'Left' }
    ]
};    

var fwParser = parsers.fwParser(parserOpts);             // Create a fwParser object by passing parserOpts

var jobService = {                                         // Create a jobService object

    onStart: function onStart (cb) {                       // Optional
                cb({});
            },
    onEnd: function onEnd (cb) {                           // Optional
                cb();
    },
    onEachRecord: fwParser.onEachRecord,                  // Using built-in FW parser
    
    onEachResult: function onEachResult (result) {         // Optional
        //console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
    }
};

var batchProcessing = require(".");                        // Requiring the batch-processing module


batchProcessing.processFile(filePath, options, jobService, function(e) {   // Calling the processFile(..) function to start processing the file
    if(!e) console.log("file "+ filePath +" processed successfully");
    else console.error(e);
});
