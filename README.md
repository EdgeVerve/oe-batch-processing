## Table of Contents
- [Need](#Need)
- [Implementation](#Implementation)
- [Setup](#Setup)
- [Features](#Features)
- [Configuration](#Configuration)
- [Parsers and Usage](#Parsers)
    - [Custom Parsers](#CustomParsers)
    - [Builtin Parsers](#BuiltinParsers)
        - [CSV Parser](#CSVParser)
        - [FW Parser](#FWParser)

<a name="Need"></a>
## Need
There is a requirement in many applications to load data into the application database from flat (text) files. Such a data load should honor all application validations and rules supported by the application for the specific type of data being loaded. The data files may contain a large number of records, one record per line. A line is assumed to be terminated by a newline (\n) character.


<a name="Implementation"></a>
## Implementation
The **oe-batch-processing** module provides the infrastructure for catering to the above need. It is implemented as an **app-list**
module for **oe-Cloud** based applications.

Since file reading and processing is very processor intensive, the *batch-processing* module runtime is kept separate from the *oe-Cloud* application,
and it is run in a separate *NodeJS* VM.
This also means that the *batch-processing* module can be scaled separately.
The module uses http REST API of the *oe-Cloud* application to load the data into the application database.

This ensures that -


1. all business validations and rules are applied for each record during the insert/update
2. the application processing is load-balanced automatically, taking advantage of the application's infrastructure.

This module exports a `processFile ( filePath, options, jobService, cb )` function - to be called by a batch client who wishes to start a batch job.
The function processes each record in the file, calls the configured API to post the data to the app DB, and saves the result (status) of each
record insert/update into a model called `BatchStatus`.
At the end of the file processing, it saves the summary of the batch processing into another model called `BatchRun`. These models are provided by the
**oe-batch-processing** module.

The `processFile(..)` function takes the following arguments, which need to be provided by the client -

* **filePath** - fully qualified fileName (with path) of the data-file to be processed


* **options** - Object containing the following properties:

    * *ctx* - Object containing `username`, `password`, `tenantId`, `access_token`. User credentials (`username`, `password`, `tenantId`) supercede `access_token`.
    i.e., `access_token` is ignored if `username` is present. Both `access_token` (in options.ctx) and user credentials (`username`, `password`, `tenantId`) are overridden by the environment variable `ACCESS_TOKEN`.

    * *appBaseURL* - URL of *oe-Cloud* application where data will be posted, e.g., 'http://localhost:3000' This is overridden if *appBaseURL* is specified in `payload` (see below)

    * *modelAPI* - API of Model where file data will be posted, e.g., '/api/Literals' (optional, can also be specified via payload). This is overridden if *modelAPI* is specified in `payload` (see below)

    * *method* - HTTP method to be used for the processing - 'POST' / 'PUT' / 'GET' or 'DELETE'. This is overridden if *method* is specified in `payload` (see below)

    * *headers* - additional headers, if any, that need to be passed while making the request (optional). This is overridden if *headers* is specified in `payload` (see below)


* **jobService** - object containing the following properties:

    * **onStart** - a (optional) function taking a single callback function as a parameter. This function is called before starting the processing of the file. May be used for verifying checksum, etc., It can fetch batchJob details  such as concurrency and store in the context.
    * **onEnd**   - a  (optional) function taking a single callback function as a parameter. This function is called after all file records have been processed may be used to notify the client about the end status of the batch job.
    * **onEachRecord** - a (mandatory) function which is called for each record in the file to be processed.
    This function is implemented by the client, and it should have the logic to convert the record data (from file) sent to it via `recData.rec`
    to a valid JSON for posting to the *oe-Cloud* application.
    This function takes two parameters - *recData*, *cb* -

        * *recData* (object) - contains the details of the current record for processing. It has the following properties - *fileName*, *rec*, *recId* :
            * *fileName* (string) - Name of the file being processed
            * *rec* (string) - The current line from the file, for processing
            * *recId* (number) - The line number (in the file) of the current line
        * *cb* (function) - this callback function takes two arguments - *payload* and *error*.

            * *Payload* (object) consists of the folowing properties:

                * *json* (object)     - A JSON representation of the file record (recData.rec) suitable for POSTing to the *oe-Cloud* application.
                * *modelAPI* (string) - The *oe-Cloud* REST API to which the data needs to be POSTed, e.g., '/api/Literals'. This overrides *modelAPI* if specified in options (see above)
                * *method* (string)   - The http verb to be used for calling the modelAPI, e.g., 'POST' / 'PUT'. This overrides *method* if specified in options (see above)
                * *headers* (object)  - optional request headers to be added while calling modelAPI. This overrides *headers* if specified in options (see above)

            * *error* (object / string) - Error object or message. This should normally be null when there is a valid payload.
                        This is assumed to be non-null when a *payload* could not be sent due to some error, and this fact/error needs to be logged.
                        If both *payload* and *error* are `null`, then the current record will be ignored and no processing will be attempted,
                        and this won't be logged.

    * **onEachResult** - a  (optional) function taking a single object as argument. This function is called after processing each record, passing the result of processing
    the current record. This function is used to notify the client about the result of processing each record.
    This function takes a single parameter - *result* -

        * *result* (object) - contains the details and status of the current record that was processing. It has the following properties - *fileName*, *rec*, *recId* :
            * *fileRecordData* (string) - Same as *recData* above
            * *payload* (string) - Same as *Payload* above
            * *statusText* (string) - A text message indicating the status of processing. Can be SUCCESS or FAILED
            * *error* (object/string) - Non-null is there was an error processing this record


* **cb** - A callback function with a single parameter, *e*. This function is normally called at the end of the file processing, if there are no *fatal* errors.
If there is a fatal error and file processing cannot proceed, then this callback is called with an error object as parameter.
The client can examine this error object to know what went wrong.
**Note:** Record level errors such as field-header count mismatch, validation errors, etc., are not considered as *fatal* errors and such errors would not be
returned in this callback. These errors would be logged to the oeCloud application database (`BatchStatus`) and processing would proceed till all records are processed.


The `processFile(..)` function does the following in sequence -

1. First, it calls `jobService.onStart() `
2. Gets `access_token`
3. Creates a record in `BatchRun` model for the current run with the data passed to `processFile(..) `
4. Reads the file, and queue the `runJob(..)` function with parameters `jobService` and `recData`, once for each record in the file
5. Now, the queue is processed by executing the `runJob(..)` function with its arguments in a parallel, but rate-limited/throttled manner.
6. Inside the `runJob(..)` function, `jobService.onEachRecord(..)` is called to obtain the JSON representation of `recData.rec` and api details
7. The *oe-Cloud* API is called and the result is logged to the `BatchStatus` model via a separate API call.
8. The  `jobService.onEachResult(..)` functtion is called with the result of record processing as argument
9. Steps 6-8 is repeated till the queue is completely processed.
10. After all records are processed, the `jobService.onEnd()` function is called
11. Updates `BatchRun` model with statistics of the run


<a name="Setup"></a>
## Setup
To get the *Batch Processing* feature, the following changes need to be done in the *oe-Cloud* based application:

1. The [**oe-batch-processing**](https://github.com/EdgeVerve/oe-batch-processing) node module needs to be added as a ``package.json`` dependency.
2. This module needs to be added to the `server/app-list.json` file in the app.
3. Run ``npm install --no-optional``

The code snippets below show how steps 1 and 2 can be done:

**package.json**  (only part of the file is shown here, with relevant section in **bold**):

<pre>
...
   ...
   "dependencies": {
       ...
       ...
       ...
       <B>"oe-batch-processing": "git+https://github.com/EdgeVerve/oe-batch-processing.git#2.0.0",</B>
       ...
       ...
</pre>

**server/app-list.json**   (Relevant section in **bold**):

<pre>
[
    {
        "path": "oe-cloud",
        "enabled": true
    },
    . . .
    . . .
    . . .
    <b>{
        "path": "oe-batch-processing",
        "enabled": true
    },</b>
    . . .
    . . .
    . . .
	{
        "path": "./",
        "enabled": true
    }
]
</pre>


<a name="Features"></a>
## Features
The **oe-batch-processing** module has the following features:
1. Can process text files of arbitrary length
2. Can be setup to throttle the rate at which records are processed
3. Can process CSV and Fixed-Width Value files OTB, using builtin parsers
4. Can use custom parsers for any other data formats
5. Can be scaled independently (i.e., can be different from application scaling)
6. Logs all success and failure conditions to DB for audit / recovery / analysis purposes.
7. Provides hooks (functions) that trigger before and at the end of file processing

<a name="Configuration"></a>
## Configuration

The *oe-batch-processing* module can be configured usind a `config.json` file at the root of the module. This config file has the following structure:

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


|Config Property|Description|Default Value| Overriding Environment Variable|
|--------|-----------|-------------|--------------------------------|
|maxConcurrent|determines the maximum number of jobs that are run in parallel.|80|MAX_CONCURRENT|
|minTime |determines how long to wait in milliseconds after launching a job before launching another one.|20|MIN_TIME|
|batchResultLogItems|a comma separated list of items that can be included in the default response that is logged to DB. Possible values in this list are: *error.details*, *error.stack*, *response.headers*| "" | BATCH_RESULT_LOG_ITEMS |
|appBaseURL|URL of *oe-Cloud* app where data will be posted. This would be used if `appBaseURL` is not present in `options` passed to `processFile(..)` by the batch client.| undefined | APP_BASE_URL|
|modelAPI|The *oe-Cloud* REST API to which the data needs to be POSTed, e.g., '/api/Literals'.|undefined|MODEL_API|
|progressInterval|Interval in milliseconds at which to print the progress of file processing in the console. Set this to 0 to disable printing progress to console.|10000|PROGRESS_INTERVAL|


A few other configurations are as follows:

|Config Property|Description|
|--------|-----------|
|environment variable `BATCH_LOGGER_CONFIG`|Sets log level to one of *trace*, *debug*, *warn*, *error*, or *info*, if oe-Cloud's LOGGER_CONFIG is not set|
|environment variable `ACCESS_TOKEN`|Overrides `access_token` that may be set in `options.ctx`. `ACCESS_TOKEN` in environment variable also supercedes any user credentials supplied in `options.ctx`.|

<a name="Parsers"></a>
## Parsers and Usage

The **oe-batch-processing** module includes two builtin parsers - CSV (Comma Separated Value) and FWV (Fixed Width Value)
The user can also write custom parsers for other data formats.

<a name="CustomParsers"></a>
### Custom Parsers
A sample usage of the *oe-batch-processing* module with *custom parser* is shown below:

```javascript

var batchProcessing = require('oe-batch-processing');   // require the batch-processing module

var filePath = 'test/testdata.txt';   // File to process

var options = {                       // options object
        //ctx: {access_token: 'P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx'},      // ignored if user credentials are passed
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: '/default'},                      // supercedes access_token
        appBaseURL: 'http://localhost:3000',                                                            // ignored if appBaseURL is present in payload
        modelAPI: '/api/Literals',                                                                      // ignored if modelAPI is present in payload
        method: 'POST',                                                                                 // ignored if method is present in payload
        headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}  // ignored if headers is present in payload
    };

// User-defined jobService object which encapsulates the custom parser
var jobService = {

    onStart: function (cb) { cb({}); },            // onStart is optional

    onEnd: function (cb) { cb(); },                // onEnd is optional

    onEachRecord: function (recData, cb) {         // onEachRecord is mandatory - this does the parsing

        var json = {'key': recData.rec.split(' ')[0], 'value': recData.rec.split(' ')[1]};  // logic to convert file record (string) to *oe-Cloud* processable object

        var payload = {
                json: json,
                //modelAPI: '/api/Literals',                   // if specified here, supercedes modelAPI in options
                //method: "POST",                              // if specified here, supercedes method in options
                //headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}   // if specified here, supercedes headers in options
            };

        cb(payload, payload ? null : "Couldn't get payload for recId " + (recData && recData.recId));  // Send payload via callback function
    },
    onEachResult: function onEachResult (result) { console.log("Inside jobService.onEachResult: " + JSON.stringify(result)); }

};

batchProcessing.processFile(filePath, options, jobService, function(e) {   // Calling the processFile(..) function to start processing the file
    if(!e) console.log("file "+ filePath +" processed successfully");
    else console.error(e);
});

```


#### Sample BatchStatus record
The above code (`processFile()` function) inserts one record for every file-record processed into the `BatchStatus` model.
Shown below is a sample record from the `BatchStatus` model.

(Audit fields removed for clarity)
```javascript
{
        "_id" : ObjectId("5b04e87a09e96cfc3263f744"),

        "fileRecordData" : {
                "fileName" : "test/1k.txt",
                "rec" : "100000000000000000000000000000000000000 100000000000000000000000000000000000000",
                "recId" : 1
        },
        "payload" : {
                "json" : {
                        "key" : "100000000000000000000000000000000000000",
                        "value" : "100000000000000000000000000000000000000"
                }
        },
        "requestOpts" : {
                "url" : "http://localhost:3000/api/Literals?access_token=5rnPFnR5OejYI2OQffxnGpgjr3OVgYQQfe5uDEnxqBEhz2MmkN00b6rGSqnCGgUo",
                "method" : "POST",
                "body" : {
                        "key" : "100000000000000000000000000000000000000",
                        "value" : "100000000000000000000000000000000000000"
                },
                "json" : true,
                "timeout" : 10000,
                "jar" : true,
                "headers" : {
                        "Cookie" : "Content-Type=application/json; charset=encoding; Accept=application/json",
                        "custom-header1" : "custom-header-value1",
                        "custom-header2" : "custom-header-value2"
                }
        },
        "response" : {
                "error" : {
                        "name" : "ValidationError",
                        "status" : 422,
                        "message" : "The `Literal` instance is not valid. Details: `key` duplicate value exist - data already exists (value: \"1000000000000000000000000...000\").",
                        "statusCode" : 422
                }
        },
        "statusText" : "FAILED",
        "statusCode" : 422,
        "error" : {
                "error" : {
                        "name" : "ValidationError",
                        "status" : 422,
                        "message" : "The `Literal` instance is not valid. Details: `key` duplicate value exist - data already exists (value: \"1000000000000000000000000...000\").",
                        "statusCode" : 422
                }
        }
}

```



#### Sample BatchRun record
A run of the `processFile()` function also inserts a summary record (one record for the complete run, which is for one data-file) into the `BatchRun` model.
Shown below is a sample record from the `BatchRun` model.

(Audit fields removed for clarity)
```javascript
{
        "_id" : "1b709e40-8357-4557-80ee-7e0039f722fc",

        "startTimeMillis" : 1527047662856,
        "startTime" : "2018-05-23T03:54:22.856Z",
        "filePath" : "test/1k.txt",
        "options" : {
                "ctx" : {
                        "username" : "judith",
                        "password" : "Edge@2017$",
                        "tenantId" : "/default",
                        "access_token2" : "6wz8nE9BqO32VGDqGcvt14fPwjuJJMBDjXW07d5nxmqtBNR5OjGJj1TsuEXVdogC"  // 'access_token2' is obtained by the batch-processing module by login using user credentials
                },                                                                                            // A client-provided access token would be under 'access_token'
                "appBaseURL" : "http://localhost:3000",
                "modelAPI" : "/api/Literals",
                "method" : "POST",
                "headers" : {
                        "custom-header1" : "custom-header-value1",
                        "custom-header2" : "custom-header-value2"
                }
        },
        "endTimeMillis" : 1527047688774,
        "endTime" : "2018-05-23T03:54:48.774Z",
        "durationMillis" : 25918,
        "totalRecordCount" : 1000,
        "successCount" : 550,
        "failureCount" : 450
}
```

<a name="BuiltinParsers"></a>
### Builtin Parsers
The *oe-Cloud batch-processing* module includes the following parsers which can be used OTB with minimal configuration:
* CSV Parser
* FW (Fixed Width) Parser

These Parsers provide the ``onEachRecord`` function that needs to be part of the ``jobService`` object, which in turn is passed to the ``processFile`` function.
(See sample usage above to understand how these objects and functions are used)

<a name="CSVParser"></a>
#### CSV Parser
- The **CSV Parser** can be used to parse CSV (Comma Separated Value) data files, and also other delimited files by appropriately configuring the parser.
- While parsing CSV, the comma (,) is allowed within data fields, provided such data fields are enclosed within double-quotes.
- The delimiter cannot be part of the data in case of non-CSV delimited files.

##### CSV Parser Options
The *CSV Parser* is configured by passing a `parserOptions` object to it with the following properties

|Config Property|Description|Default Value|Example|
|--------|-----------|--------|--------|
|delimiter|Optional. The delimiter used in the data file. Default is comma (,)|, (comma)|~|
|csvHeaders|Mandatory. A string of comma-separated values or a JSON array of strings containing the list of headers of the columns in the data-file. These will be used as field names while posting the data to the oe-Cloud application. The number of csvHeaders must be >= the number of data-fields. If the number of csvHeaders !== the number of data-fields, an error is thrown for this record. Leading and/or trailing whitespace for header-names is okay.| No default headers are provided.|accountNo,name,age,gender|
|csvHeaderDataTypes|Optional. A string of comma-separated values or a JSON array of strings containing the list of header-data-types of the columns in the data-file. These will be used to determine whether the posted data is to be enclosed in quotes or not. The possible data-type values are: string, number and boolean.|string,string,string,... (i.e., all fields are assumed to be of type 'string')|string,number,string,string,boolean|
|ignoreExtraHeaders|Optional. A boolean flag, if set to true, ignores the case where there are more headers specified than the number of fields in the data file|false|false|
|ignoreExtraHeaderDataTypes|Optional. A boolean flag, if set to true, ignores the case where there are more header-data-types specified than the number of fields in the data file|false|false|


##### CSV Parser usage
A sample usage of the *oe-batch-processing* module with *csv parser* is shown below:

```javascript

var batchProcessing = require('oe-batch-processing');   // require the batch-processing module

var parsers = require('./parsers');

var filePath = 'test/testdata.txt';   // File to process

var options = {                       // options object
        //ctx: {access_token: 'P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx'},      // ignored if user credentials are passed
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: '/default'},                      // supercedes access_token
        appBaseURL: 'http://localhost:3000',                                                            // ignored if appBaseURL is present in payload
        modelAPI: '/api/Literals',                                                                      // ignored if modelAPI is present in payload
        method: 'POST',                                                                                 // ignored if method is present in payload
        headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}  // ignored if headers is present in payload
    };

var parserOptions = {   // Create the parserOptions object
//    delimiter: ' ',                        // Optional. Default is ',' (comma)
    csvHeaders: ' key, value ',              // Mandatory. No. of csvHeaders (#csvHeaders) must be >= #data-fields. If #csvHeaders !== #data-fields, defaults to error. Whitespace is okay.
//    csvHeaderDataTypes: 'string, number',  // Optional. Default is 'string,string,string,...' (all fields are considered as type string). #csvHeaderDataTypes must be >= #data-fields. If #csvHeaderDataTypes !== #data-fields, defaults to error. Whitespace is okay.
    ignoreExtraHeaders: true,                // Optional. Default is false. If true, prevents error when #csvHeaders > #data-fields
    ignoreExtraHeaderDataTypes: true         // Optional. Default is false. If true, prevents error when #csvHeaderDataTypes > #data-fields
}

var csvParser = parsers.csvParser(parserOptions);          // Create a csvParser object by passing parserOptions

var jobService = {                                         // Create a jobService object

    onStart: function onStart (cb) {                       // Optional
                cb({});
            },
    onEnd: function onEnd (cb) {                           // Optional
                cb();
    },
    onEachRecord: csvParser.onEachRecord,                  // Using built-in CSV parser

    onEachResult: function onEachResult (result) {         // Optional
        //console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
    }
};

batchProcessing.processFile(filePath, options, jobService, function(e) {   // Calling the processFile(..) function to start processing the file
    if(!e) console.log("file "+ filePath +" processed successfully");
    else console.error(e);
});

```

<a name="FWParser"></a>
#### FW Parser
- The **FW Parser** can be used to parse FW (Fixed Width) data files by appropriately configuring the parser.


##### FW Parser Options
The *FW Parser* is configured by passing a `parserOptions` object to it with the following properties

|Config Property|Description|Default Value|Example|
|--------|-----------|--------|--------|
|fwHeaders|- Mandatory. An array of objects, each object containing the metadata of a single field. The array should have as many elements as there are fields to parse in the data-file. Each object should have the following mandatory properties: `fieldName`, `type`, `startPosition`,`endPosition`| No default headers are provided.|```[{ fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 }, { fieldName: 'value', type: 'boolean', length: 8, startPosition: 6, endPosition: 13 }]```|



##### FW Parser usage
A sample usage of the *oe-Cloud batch-processing* module with *fw parser* is shown below:

```javascript

var batchProcessing = require('oe-batch-processing');   // require the batch-processing module

var parsers = require('./parsers');

var filePath = 'test/testdata.txt';   // File to process

var options = {                       // options object
        //ctx: {access_token: 'P6dTLbKf0lnpugUxQalYmeJktp29YXsMZ0dWTnq5v4pf7w86PE1kblKMzqu1drnx'},      // ignored if user credentials are passed
        ctx: {username: 'judith', password: 'Edge@2017$', tenantId: '/default'},                      // supercedes access_token
        appBaseURL: 'http://localhost:3000',                                                            // ignored if appBaseURL is present in payload
        modelAPI: '/api/Literals',                                                                      // ignored if modelAPI is present in payload
        method: 'POST',                                                                                 // ignored if method is present in payload
        headers: { 'custom-header1': 'custom-header-value1', 'custom-header2': 'custom-header-value2'}  // ignored if headers is present in payload
    };

var parserOptions = {
    fwHeaders: [
        { fieldName: 'key', type: 'string', length: 5, startPosition: 1, endPosition: 5 },
        { fieldName: 'value', type: 'boolean', length: 8, startPosition: 6, endPosition: 13 }
    ]
};

var fwParser = parsers.fwParser(parserOptions);            // Create a fwParser object by passing parserOptions

var jobService = {                                         // Create a jobService object

    onStart: function onStart (cb) {                       // Optional
                cb({});
            },
    onEnd: function onEnd (cb) {                           // Optional
                cb();
    },
    onEachRecord: fwParser.onEachRecord,                   // Using built-in FW parser

    onEachResult: function onEachResult (result) {         // Optional
        //console.log("Inside jobService.onEachResult: " + JSON.stringify(result));
    }
};

batchProcessing.processFile(filePath, options, jobService, function(e) {   // Calling the processFile(..) function to start processing the file
    if(!e) console.log("file "+ filePath +" processed successfully");
    else console.error(e);
});

```
