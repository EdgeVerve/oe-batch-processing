/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
/**
 * This sample usage file uses the batch-processing module and runs standalone with 
 * `node sample-usage.js`  command.
 * 
 * Make sure the oe-Cloud app is running at `options.appBaseURL` before running this script.
 * 
 * When run, it takes the data in `filePath` variable and inserts it into the model
 * whose API is in `options.modelAPI`. 
 * 
 * For authentication to the oeCloud app, `options.ctx` can either contain `username`, 
 * `password` and `tenantId` or it can contain just a valid `access_token`.

 * @file sample-usage.js
 * @author Ajith Vasudevan
 */


var filePath = "test/1k.txt";
var options = { 
        //ctx: {access_token: "P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx"},
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
        appBaseURL: 'http://localhost:3000',
        modelAPI: '/api/Literals',
        method: 'POST',
        headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}          
    };

var jobService = {

    onStart: function onStart (cb) { 
                cb({});
            },
    onEnd: function onEnd (cb) {
                cb();
    },
    onEachRecord: function onEachRecord (recData, cb) {
        var json = {"key": recData.rec.split(' ')[0], "value": recData.rec.split(' ')[1]};
        var payload = {
            json: json,
            //modelAPI: "/api/Literals",
            //method: "POST",
            //headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'} 
        };
        cb(payload, payload ? null : "Couldn't get payload for recId " + (recData && recData.recId));
    },
    onEachResult: function onEachResult (result) {
        console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
    }
};

var batchProcessing = require(".");



batchProcessing.processFile(filePath, options, jobService, function() {
    console.log("file "+ filePath +" processed successfully");
});
