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

        var filePath = "test/testdata.txt";
//        var filePath = "D:/1k.txt";
//        var filePath = "D:/20k.txt";
//        var filePath = "D:/100mil.txt";
        var options = { 
                ctx: {access_token: "DLeeHyh49HNyqm08hd4Ac2AjrLNYdJ1ANeGIMJin9OUkt9iXgxWCnKLO3bRUNKzf"},
                appBaseURL: "http://localhost:3000",
                modelAPI: "/api/Literals",
                method: "POST"
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
                log.debug("calling jobService.onEachRecord for record: " + recData.rec + " with recId=" + recData.recId);
                var json = {"key": recData.rec.split(' ')[0], "value": recData.rec.split(' ')[1]};
                var payload = {
                    json: json
                    // appBaseURL: "http://localhost:3000"  
                    //ctx: {access_token: "DLeeHyh49HNyqm08hd4Ac2AjrLNYdJ1ANeGIMJin9OUkt9iXgxWCnKLO3bRUNKzf"},
                    //modelAPI: "/api/Literals",
                    //method: "POST" 
                };
                cb(payload, payload ? null : "Couldn't get payload for record " + rec);
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
