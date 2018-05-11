var log = require('oe-logger')('batch-processing');
var fs = require('fs')
var es = require('event-stream');
const Bottleneck = require("bottleneck");
const limiter = new Bottleneck({ maxConcurrent: 3, minTime: 2000 });

function processFile(filePath, options, jobService) {
    log.info("Starting Batch Processing");
    log.info("filePath = " + filePath);
    log.info("options = " + JSON.stringify(options));
    log.info("jobservice : " + jobService);

    limiter.on('error', function (error) {
        log.error("An error occurred: ");
        log.error(error.message);
    });

    limiter.on('debug', function (message, data) {
        log.info(JSON.stringify(limiter.counts()));
    });

    limiter.on('idle', function () {
        jobService.onEnd();
    });

    jobService.onStart(function cb() {
        var lineNr = 0;
        var s = fs.createReadStream(filePath).pipe(es.split()).pipe(es.mapSync(function(rec) {
                s.pause();
                lineNr += 1;
                log.info("submitting job for : " + rec);
                limiter.submit({expiration: 20000, id: lineNr}, runJob, jobService, rec, function(result, err) {
                    log.info("job status : " + result || err);
                });            
                
                //logMemoryUsage(lineNr);
                s.resume();
            })
            .on('error', function(err){
                console.log('Error while reading file.', err);
            })
            .on('end', function(){
                console.log('Read entire file.')
            })
        );
       
    });
}


function runJob(jobService, rec, cb3) {
    log.info("runJob started for : " + rec);
    jobService.onEachRecord(rec, function cb2(payload, err) {
        if(err === null) {
            log.info("payload : " + JSON.stringify(payload));
            log.info("Posting " + JSON.stringify(payload.rec) + " to " + payload.url);
            cb3("Processed " + rec, null);
        }
        else {
            log.error("There was an error processing file record to JSON: " + err);
            cb3(null, err);
        }
    });
}

exports.processFile = processFile;