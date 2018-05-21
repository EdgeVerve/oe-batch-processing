# Batch Processing

## Need
There is a requirement in many applications to load data into the application database from flat (text) files. Such a data load should honor all application validations and rules supported by the application for the specific type of data being loaded. The data files may contain a large number of records, one record per line. A line is assumed to be terminated by a newline (\n) character.

## Solution

Since file reading and processing is very processor intensive, the batch processing module is kept separate from the oe-cloud app, and it is run in a separate NodeJS VM. 
This also means that the batch-processing module can be scaled separately.
The module uses http REST API of the oe-cloud application to load the data into the application database. 

This ensures that -


1. all business validations and rules are applied for each record during the insert/update
2. the application processing is load-balanced automatically, taking advantage of the application's infrastructure.

Considering the above, the oe-cloud batch-processing solution is built as a nodejs module (not included in oe-cloud framework). 
It can be "required" and its main function called by anyone (for e.g., by a batch client,or a batch scheduler, Node-RED, etc.,) 
who wishes to start a batch job for processing a file containing text data, one record per line.

## Implementation

The oe-cloud batch-processing module is available at http://evgit/oecloud.io/batch-processing. 

This module exports a `processFile ( filePath, options, jobService, cb )` function - to be called by a batch client who wishes to start a batch job.

The `processFile(..)` function takes the following arguments, which need to be provided by the client -

* **filePath** - fully qualified fileName (with path) of the data-file to be processed


* **options** - Object containing the following properties:

    * *ctx* - Object containing `username`, `password`, `tenantId`, `access_token` (access_token is ignored if username is present)
   
    * *appBaseURL* - URL of oe-cloud app where data will be posted, e.g., 'http://localhost:3000'
   
    * *modelAPI* - API of Model where file data will be posted, e.g., '/api/Literals' (optional, can also be specified via payload)
   
    * *method* - HTTP method to be used for the processing - 'POST' / 'PUT' / 'GET' or 'DELETE'
   
    * *headers* - additional headers, if any, that need to be passed while making the request (optional)


* **jobService** - object containing the following properties:
 
    * **onStart** - a (optional) function taking a single callback function as a parameter. This function is called before starting the processing of the file. May be used for verifying checksum, etc., It can fetch batchJob details  such as concurrency and store in the context. 
    * **onEnd**   - a  (optional) function taking a single callback function as a parameter. This function is called after all file records have been processed may be used to notify the client about the end status of the batch job.
    * **onEachRecord** - a (mandatory) function which is called for each record in the file to be processed. 
    This function is implemented by the client, and it should have the logic to convert the record data (from file) sent to it via `recData.rec`
    to a valid JSON for posting to the *oe-cloud* application.
    This function takes two parameters - *recData*, *cb* -

        * *recData* (object) - contains the details of the current record for processing. It has the following properties - *fileName*, *rec*, *recId* :
            * *fileName* (string) - Name of the file being processed
            * *rec* (string) - The current line from the file, for processing
            * *recId* (number) - The line number (in the file) of the current line 
        * *cb* (function) - this callback function takes two arguments - *payload* and *error*. 

            * *Payload* (object) consists of the folowing properties:
            
                * *json* (object)     - A JSON representation of the file record (recData.rec) suitable for POSTing to the oe-cloud application.
                * *modelAPI* (string) - The oe-cloud REST API to which the data needs to be POSTed, e.g., '/api/Literals'
                * *method* (string)   - The http verb to be used for calling the modelAPI, e.g., 'POST' / 'PUT' 
                * *headers* (object)  - optional request headers to be added while calling modelAPI
                
            * *error* (object / string) - Error object or message. This should normally be null when there is a valid payload. 
                        This is assumed to be non-null when a *payload* could not be sent due to some error, and this fact/error needs to be logged. 
                        If both *payload* and *error* are `null`, then the current record will be ignored and no processing will be attempted, 
                        and this won't be logged.  


The processFile ( ... ) function does the following in sequence -

1. First, it calls jobService.onStart() 
2. Gets access token
3. Creates a record in BatchRun for the current run with the data passed to processFile(..) 
4. Reads the file, and queue the runJob(..) function with parameters jobService and recData, once for each record in the file
5. Now, the queue is processed by executing the runJob(..) function with its arguments in a parallel, but rate-limited/throttled manner. 
6. Inside the runJob(..) function, jobService.onEachRecord(..) is called to obtain the JSON representation of recData.rec and api details 
7. The oe-cloud API is called and the result is logged to the BatchStatus model via a separate API call.
8. Steps 6-7 is repeated till the queue is completely processed. 
9. After all records are processed, the jobService.onEnd()
10. Updates BatchRun with statistics of the run


## Configuration

The *oe-cloud batch-processing* module can be configured usind a config.json file at the root of the module. This config file has the following structure:

```json
{
    "maxConcurrent": 80, 
    "minTime": 20,
    "batchResultLogItems": "",
    "appBaseURL": "http://localhost:3000"
}
```

This config file is optional, and default values are provided for some of the config parameters. The file config parameters can be overridden by environment variables.
The details of these config parameters is given below:


|Property|Description|Default Value| Overriding Environment Variable|
|--------|-----------|-------------|--------------------------------|
|maxConcurrent|determines the maximum number of jobs that are run in parallel.|80|MAX_CONCURRENT|
|minTime |determines how long to wait in milliseconds after launching a job before launching another one.|20|MIN_TIME|
|batchResultLogItems|a comma separated list of items that can be included in the default response that is logged to DB. Possible values in this list are: *error.details*, *error.stack*, *response.headers*| "" | BATCH_RESULT_LOG_ITEMS |
|appBaseURL|URL of oe-cloud app where data will be posted. This would be used if `appBaseURL` is not present in `options` passed to `processFile(..)` by the batch client. e.g., 'http://localhost:3000'. | undefined | APP_BASE_URL|





