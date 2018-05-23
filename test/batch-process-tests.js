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

    it('should call processFile', function (done) {
        log.debug("calling processFile");

        var filePath = 'test/1k.txt';
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

    after('tests', function (done) {
        log.debug("after all tests");
        done();
    });
});
