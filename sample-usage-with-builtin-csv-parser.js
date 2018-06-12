/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This sample usage file uses the batch-processing module and runs standalone with 
 * `node sample-usage-with-builtin-csv-parser.js`  command.
 * 
 * The "Comma Separated Values" (CSV built-in parser from the included parsers module is used 
 * to parse CSV data-file.
 * 
 * Make sure the oe-Cloud app is running at `options.appBaseURL` before running this script.
 * 
 * When run, it takes the data in `filePath` variable and inserts it into the model
 * whose API is in `options.modelAPI`. 
 * 
 * For authentication to the oeCloud app, `options.ctx` can either contain `username`, 
 * `password` and `tenantId` or it can contain just a valid `access_token`.

 * @file sample-usage-with-builtin-csv-parser.js
 * @author Ajith Vasudevan
 */

var parsers = require('./parsers'); 

//var filePath = "test/1k.txt";
var filePath = "test/batch-100.csv";                           // The file to be processed
var options = {                                                // Create a batch-processing options object
        //ctx: {access_token: "P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx"},
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
        appBaseURL: 'http://localhost:3000',
        modelAPI: '/api/Literals',
        method: 'POST',
        headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}          
    };

var parserOptions = {                        // Create a parserOptions Object
//    delimiter: ' ',                        // Optional. Default is ',' (comma)
    csvHeaders: ' key, value ',              // Mandatory. No. of csvHeaders (#csvHeaders) must be >= #data-fields. If #csvHeaders !== #data-fields, defaults to error. Whitespace is okay.
//    csvHeaderDataTypes: 'string, number',  // Optional. Default is 'string,string,string,...' (all fields are considered as type string). #csvHeaderDataTypes must be >= #data-fields. If #csvHeaderDataTypes !== #data-fields, defaults to error. Whitespace is okay.
    ignoreExtraHeaders: true,                // Optional. Default is false. If true, prevents error when #csvHeaders > #data-fields 
    ignoreExtraHeaderDataTypes: true         // Optional. Default is false. If true, prevents error when #csvHeaderDataTypes > #data-fields 
}    

var csvParser = parsers.csvParser(parserOptions);             // Create a csvParser object by passing parserOpts

var jobService = {                                         // Create a jobService object

    onStart: function onStart (cb) {                       // Optional
                cb({});
            },
    onEnd: function onEnd (cb) {                           // Optional
                cb();
    },
    onEachRecord: csvParser.onEachRecord,                  // Using built-in CSV parser
    
    onEachResult: function onEachResult (result) {         // Optional
        //console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
    }
};

var batchProcessing = require(".");                        // Requiring the batch-processing module


batchProcessing.processFile(filePath, options, jobService, function(e) {   // Calling the processFile(..) function to start processing the file
    if(!e) console.log("file "+ filePath +" processed successfully");
    else console.error(e);
});
