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
            if(e) console.log(e);
            done(e);
        });
    });

    it('should call processFile with built-in CSV Parser and no csvHeaders in parseOpts, should fail with expected message', function (done) {
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

        // var parserOpts = {
        // //    delimiter: ' ',                        // Optional. Default is ',' (comma)
        //     csvHeaders: ' key, value ',              // Mandatory. No. of csvHeaders (#csvHeaders) must be >= #data-fields. If #csvHeaders !== #data-fields, defaults to error. Whitespace is okay.
        // //    csvHeaderDataTypes: ' string ',        // Optional. Default is 'string,string,string,...' (all fields are considered as type string). #csvHeaderDataTypes must be >= #data-fields. If #csvHeaderDataTypes !== #data-fields, defaults to error. Whitespace is okay.
        //     ignoreExtraHeaders: true,                // Optional. Default is false. If true, prevents error when #csvHeaders > #data-fields 
        //     ignoreExtraHeaderDataTypes: true         // Optional. Default is false. If true, prevents error when #csvHeaderDataTypes > #data-fields 
        // }    

        var parserOpts = {
//                csvHeaders: ' key, value ',              // Mandatory. No. of csvHeaders (#csvHeaders) must be >= #data-fields. If #csvHeaders !== #data-fields, defaults to error. Whitespace is okay.
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

        a.processFile(filePath, options, jobService, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e);
            if(e && e.message && e.message.indexOf('CSV Headers are missing in csvParser options') > -1) done();
            else done(new Error('Did not fail with expected message'));
        });   

    });


    filePath = "test/fwbatch-100.fwv";
    options = { 
            ctx: {username: 'judith', password: 'Edge@2017$', tenantId: 'demoTenant'},
            appBaseURL: 'http://localhost:3000',
            modelAPI: '/api/Literals',
            method: 'POST'         
        };
    
    parsers = require('../parsers');
    
    parserOpts = {   // Empty parserOpts
    }    
    
    fwParser = parsers.fwParser(parserOpts);
    
    jobServiceFW = {
    
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


    it('should call processFile with FW Parser and empty parserOpts, and it should fail with expected error message', function (done) {

        parserOpts = {    // empty parserOpts object
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e);
            if(e && e.message==='Error: parseFW: FW Headers are missing in fwParser options (options.fwHeaders - should be an array of objects)') done();
            else done(new Error("Didn't fail with expected error message"));
        });   
    });


    it('should call processFile with FW Parser and empty parserOpts.fwHeaders object, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: {}    // empty parserOpts.fwHeaders object
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e);
            if(e && e.message && e.message.indexOf('parseFW: FW Headers specified as object. Should be array of objects.') > -1) done();
            else done(new Error("Didn't fail with expected error message"));
        });   
    });

    it('should call processFile with FW Parser and parserOpts.fwHeaders as string, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: 'key,value'    // empty parserOpts.fwHeaders object
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e);
            if(e && e.message && e.message.indexOf('parseFW: options.fwHeaders supplied are not of type array (of objects)') > -1) done();
            else done(new Error("Didn't fail with expected error message"));
        });   
    });


    it('should call processFile with FW Parser and parserOpts.fwHeaders as empty array, and it should fail with expected message', function (done) {

        parserOpts = {
            fwHeaders: []
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            console.log(e);
            if(e && e.message && e.message.indexOf('parseFW: FW Headers specified as empty array. Should be array of objects.') > -1) done();
            else done(new Error("Didn't fail with expected error message"));
        });   
    });

    it('should call processFile with FW Parser and CORRECT parserOpts, and it should NOT fail', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
                { fieldName: 'value', type: 'boolean', length: 8, startPosition: 6, endPosition: 13 }
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e) done(e);
            else done();
        });   
    });


    it('should call processFile with FW Parser and record length < max-header-position, and it should not fail', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
                { fieldName: 'value', type: 'string', length: 8, startPosition: 6, endPosition: 15 }   // record-length (13) < max-endPosition (15) 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e) done(e);
            else done();
        });   
    });

    it('should call processFile with FW Parser and record length > max-header-position, and it should not fail', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
                { fieldName: 'value', type: 'string', length: 8, startPosition: 6, endPosition: 11 }   // record-length (13) > max-endPosition (11) 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e) done(e);
            else done();
        });   
    });

    it('should call processFile with FW Parser and wrong data-type, and it should not fail', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
                { fieldName: 'value', type: 'number', length: 8, startPosition: 6, endPosition: 13 }   // wrong type: number 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e) done(e);
            else done();
        });   
    });

    it('should call processFile with FW Parser and without fieldName, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },   
                { type: 'string', length: 8, startPosition: 6, endPosition: 13 }                       // missing fieldName 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e && e.message && e.message.indexOf('parseFW: Header fieldName is missing') > -1) done();
            else done("Didn't fail with expected error message");
        });   
    });


    it('should call processFile with FW Parser and without type, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },   
                { fieldName: 'value', length: 8, startPosition: 6, endPosition: 13 }                    // missing type 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e && e.message && e.message.indexOf('parseFW: Header type is missing') > -1) done();
            else done("Didn't fail with expected error message");
        });   
    });


    it('should call processFile with FW Parser and without startPosition, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
                { fieldName: 'value', type: 'string', length: 8, endPosition: 13 }          // missing startPosition 
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e && e.message && e.message.indexOf('parseFW: Header startPosition is missing') > -1) done();
            else done("Didn't fail with expected error message");
        });   
    });    

    it('should call processFile with FW Parser and without endPosition, and it should fail with expected error message', function (done) {

        parserOpts = {
            fwHeaders: [
                { fieldName: 'key', type: 'string', length: 5, startPosition: 1 },             // missing endPosition 
                { fieldName: 'value', type: 'string', length: 8, startPosition: 6, endPosition: 13 }   
            ]
        };

        fwParser = parsers.fwParser(parserOpts);

        jobServiceFW.onEachRecord = fwParser.onEachRecord;

        a.processFile(filePath, options, jobServiceFW, function(e) {  // Calling the processFile(..) function to start processing the file
            if(e && e.message && e.message.indexOf('parseFW: Header endPosition is missing') > -1) done();
            else done("Didn't fail with expected error message");
        });   
    });

    after('tests', function (done) {
        log.debug("after all tests");
        done();
        //setInterval(function() {process.exit(0);}, 1000);
    });
});
