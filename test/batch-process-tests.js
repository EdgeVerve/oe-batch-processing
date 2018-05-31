/**
 * 
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 * 
 */

if(!process.env["LOGGER_CONFIG"] && process.env["BATCH_LOGGER_CONFIG"]) {
    process.env["LOGGER_CONFIG"] = JSON.stringify({"levels":{"default":process.env["BATCH_LOGGER_CONFIG"].trim().toLocaleLowerCase()}});
}
var chai = require('chai');
var expect = chai.expect;
var log = require('oe-logger')('batch-processing-tests');
var start, end;
describe("batch-processing-tests", function () {
    this.timeout(3600000);
    before('tests', function (done) {
        log.debug("before all tests");
        
        done();
    });

    it('should call processFile with custom (user-defined) parser', function (done) {
        log.debug("Starting processFile test with user-defined Parser");

        var filePath = 'test/batch-100.txt';
//        var filePath = "D:/20k.txt";
//        var filePath = "D:/10mil.txt";
//        var filePath = "D:/100mil.txt";
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
                        log.debug("calling jobService.onStart");
                        cb({});
                    },
            onEnd: function onEnd (cb) {
                        log.debug("In jobService.onEnd");
                        cb();
            },
            onEachRecord: function onEachRecord (recData, cb) {
                log.debug("Inside jobService.onEachRecord: recID: " + recData.recId);
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
                log.debug("Inside jobService.onEachResult: " + JSON.stringify(result));
            }
        };

        a = require("..");
        a.processFile(filePath, options, jobService, done);
    });

    it('should call processFile with built-in CSV Parser', function (done) {
        log.debug("Starting processFile test with built-in CSV Parser");
        var filePath = "test/batch-100.csv";
        var options = { 
                //ctx: {access_token: "P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx"},
                ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
                appBaseURL: 'http://localhost:3000',
                modelAPI: '/api/Literals',
                method: 'POST',
                headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}          
            };

        var parsers = require('../parsers');

        var parserOpts = {
        //    delimiter: ' ',                        // Optional. Default is ',' (comma)
            csvHeaders: ' key, value ',              // Mandatory. No. of csvHeaders (#csvHeaders) must be >= #data-fields. If #csvHeaders !== #data-fields, defaults to error. Whitespace is okay.
        //    csvHeaderDataTypes: ' string ',        // Optional. Default is 'string,string,string,...' (all fields are considered as type string). #csvHeaderDataTypes must be >= #data-fields. If #csvHeaderDataTypes !== #data-fields, defaults to error. Whitespace is okay.
            ignoreExtraHeaders: true,                // Optional. Default is false. If true, prevents error when #csvHeaders > #data-fields 
            ignoreExtraHeaderDataTypes: true         // Optional. Default is false. If true, prevents error when #csvHeaderDataTypes > #data-fields 
        }    
        
        var csvParser = parsers.csvParser(parserOpts);
        
        var jobService = {
        
            onStart: function onStart (cb) {         // Optional
                        cb({});
                    },
            onEnd: function onEnd (cb) {             // Optional
                        cb();
            },
            onEachRecord: csvParser.onEachRecord,    // using built-in CSV parser
            
            onEachResult: function onEachResult (result) {   // Optional
                log.debug("Inside jobService.onEachResult: " + JSON.stringify(result));
            }
        };
        
        a = require("..");                           // requiring the batch-processing module

        a.processFile(filePath, options, jobService, done);   // Calling the processFile(..) function to start processing the file

    });

    after('tests', function (done) {
        log.debug("after all tests");
        done();
    });
});
