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
    console.log("file processed successfully");
});
