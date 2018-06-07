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
var should = chai.should();
var log = require('oe-logger')('batch-processing-tests');
var start, end, a;
describe("batch-processing-tests", function () {
    this.timeout(3600000);
    before('tests', function (done) {
        log.debug("before all tests");
        
        done();
    });

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

    var onEachRecord = jobService.onEachRecord;

    a = require("..");


    it('should call processFile with invalid filePath and it should fail with expected error message', function (done) {

        filePath = 'test/batch-1001.txt';   // Providing an invalid filename

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e.message);
            if(e && e.message && e.message.indexOf('no such file or directory') > -1) done();
            else done(e);
        });
    });

    it('should call processFile without credentials and it should fail with expected error message', function (done) {

        filePath = 'test/batch-100.txt'; 
        options.ctx = undefined;   // Not supplying credentials

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e.message);
            if(e && e.message && e.message.indexOf('Check access_token/credentials. Expired/Wrong/Missing?.') > -1) done();
            else done(e);
        });
    });

    it('should call processFile with wrong credentials and it should fail with expected error message', function (done) {

        filePath = 'test/batch-100.txt'; 
        options.ctx = {username: 'ajith', password: 'some_wrong_pwd', tenantId: 'demoTenant'};   // supplying wrong credentials

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e.message);
            if(e && e.message && e.message.indexOf('Check access_token/credentials. Expired/Wrong/Missing?.') > -1) done();
            else done(e);
        });
    });

    it('should call processFile without modelAPI and it should fail with expected error message', function (done) {

        options.ctx = {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'};
        options.modelAPI = undefined;  // Not supplying modelAPI
        
        a.processFile(filePath, options, jobService, function(e) {
            console.log(e);
            if(e && e.message && e.message.indexOf('modelAPI is neither specified in environment variable') > -1) done();
            else done(e);
        });
    });

    it('should call processFile with undefined jobService object and it should fail with expected error message', function (done) {

        options.modelAPI = '/api/Literals';  
        jobService = undefined;

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e);
            if(e && e.message && e.message.indexOf('jobService is not specified.') > -1) done();
            else done(new Error('Did not fail with expected message'));
        });
    });

    it('should call processFile with empty jobService object and it should fail with expected error message', function (done) {

        jobService = {};

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e);
            if(e && e.message && e.message.indexOf('jobService.onEachRecord() is not defined') > -1) done();
            else done(new Error('Did not fail with expected message'));
        });
    });

    it('should call processFile with jobService containing only onEachRecord function and it should not fail', function (done) {

        jobService = {onEachRecord: onEachRecord};

        a.processFile(filePath, options, jobService, function(e) {
            console.log(e);
            done(e);
        });
    });

    xit('should call processFile with built-in CSV Parser', function (done) {
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


    xit('should call processFile with FW Parser and empty parserOpts, and it should fail with expected error message', function (done) {
        log.debug("Starting processFile test with built-in FW Parser");
        var filePath = "test/batch-100.csv";
        var options = { 
                ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
                appBaseURL: 'http://localhost:3000',
                modelAPI: '/api/Literals',
                method: 'POST'         
            };
        
        var parsers = require('../parsers');
        
        var parserOpts = {
        }    
        
        var fwParser = parsers.fwParser(parserOpts);
        
        var jobService = {
        
            onStart: function onStart (cb) {         // Optional
                        cb({});
                    },
            onEnd: function onEnd (cb) {             // Optional
                        cb();
            },
            onEachRecord: fwParser.onEachRecord,    // using built-in CSV parser
            
            onEachResult: function onEachResult (result) {   // Optional
                log.debug("Inside jobService.onEachResult: " + JSON.stringify(result));
            }
        };
        
        a = require("..");                           // requiring the batch-processing module

        a.processFile(filePath, options, jobService, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e.message);
            if(e && e.message==='Error: parseFW: FW Headers are missing in fwParser options (options.fwHeaders - should be an array of objects)') {
                done();
            }
            else done(new Error("Didn't fail with expected error message"));
            console.log("Done Processing"); 
        });   
    });


    after('tests', function (done) {
        log.debug("after all tests");
        done();
        setInterval(function() {process.exit(0);}, 1000);
    });
});
