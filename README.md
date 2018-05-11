# Batch Processing

This is a nodejs module for batch processing, with the following features:

It exports a `processFile ( filePath, options, jobService )` function - to be called by anyone (batch client, could be batch scheduler, Node-RED, etc.,) who wishes to start a batch job, where -

* filePath - the filesystem path of the file to be batch processed.
* options - loopback options
* jobService - a nodejs module which exports 3 functions: 

- onStart ( )    - called before starting the processing of the file. May be used for verifying checksum, etc., It can fetch batchJob details  such as concurrency and store in the context.
- onEachRecord ( rec )   -  called for each record in the file to be processed. rec is the current record from the file. The function should return (1) a JSON representation of rec, suitable for processing by loopback/oe-cloud, and (2), the URL to be called for processing this record.
- onEnd ( )    -  called after all file records have been processed may be used to notify the client about the end status of the batch job.

The processFile ( ... ) function should do the following -

1. First, call jobService . onStart ( ) 
2. Next, call jobService . onEachRecord ( rec ) for each record in the file in such a manner as to maintain the specified concurrency.
3. Each time onEachRecord ( rec )  returns, call the URL returned by onEachRecord ( rec ) with the returned JSON as payload  
4. Log the status of execution of each URL to a separate Batch Status model.
5. After all records are processed, call jobService . onEnd ( )
