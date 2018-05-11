/**
 * 
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 * 
 */
/* jshint -W024 */
/* jshint expr:true */
//to avoid jshint errors for expect

var chai = require('chai');
var expect = chai.expect;
var log = require('oe-logger')('batch-processing-tests');

describe("batch-processing-tests", function () {
    this.timeout(60000);

    before('tests', function (done) {
        log.info("before all tests");
        done();
    });

    it('should call processFile', function (done) {
        log.info("calling processFile");

        var filePath = "test/testdata.txt";
        var options = {};
        var jobService = {
            onStart: function onStart (cb) {
                        log.info("calling jobService.onStart");
                        cb();
                    },
            onEnd: function onEnd () {
                        log.info("calling jobService.onEnd");
            },
            onEachRecord: function onEachRecord (rec, cb) {
                log.info("calling jobService.onEachRecord for record: " + rec);
                var payload = {rec: rec, url : "http://localhost:3000/api/Literals"};
                
                setTimeout(function() { cb(payload, payload ? null : "Couldn't get payload for record " + rec);}, 10000);
            }
        };

        a = require("..");
        a.processFile(filePath, options, jobService);
        setTimeout(function() { done(); }, 31000);
    });

    it('should do test2', function (done) {
        log.info("doing test2");
        done();
    });

    after('tests', function (done) {
        log.info("after all tests");
        done();
    });

});
