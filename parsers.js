if(!process.env["LOGGER_CONFIG"] && process.env["BATCH_LOGGER_CONFIG"]) {
    process.env["LOGGER_CONFIG"] = JSON.stringify({"levels":{"default":process.env["BATCH_LOGGER_CONFIG"].trim().toLocaleLowerCase()}});
}
var log = require('oe-logger')('parsers');
var errmsg;

function csvParser(options) {
    var csvHeaders, csvHeaderDataTypes, allHeadersString = false;
    this.onEachRecord = function onEachRecord (recData, cb) {
        var payload, json = {};
        if(!csvHeaders) {
            if(options.csvHeaders) {  // if csvHeaders were supplied in some form
                csvOptHeaders = options.csvHeaders;
                if(typeof csvOptHeaders === 'object') { // if csvOptHeaders were supplied as an object or array (but not string)
                    if(csvOptHeaders.length) { // csvOptHeaders were supplied as an array
                        csvHeaders = csvOptHeaders;
                    } else {   // csvHeaders were supplied as an object
                        csvHeaders = Object.keys(csvOptHeaders);
                        csvHeaderDataTypes = Object.keys(csvOptHeaders).map(function(k) { return csvOptHeaders[k];});
                    }
    
                } else if(typeof csvOptHeaders === 'string') {
                    if(csvOptHeaders.trim().length !==0) {
                        csvHeaders = csvOptHeaders.split(options.headerSeparator ? options.headerSeparator : ',');
                    } else {
                        var errmsg = "parseCSV: CSV Headers specified as string is either empty or whitespace: '" + csvOptHeaders + "'. (options.csvHeaders - can be comma-separated string, string-array or object)";
                        log.error(errmsg);
                        throw new Error(errmsg);
                    }
                } else {
                    var errmsg = "parseCSV: options.csvHeaders supplied are not of type string array or coma-separated string or object";
                    log.error(errmsg);
                    throw new Error(errmsg);
                }
            } else {
                var errmsg = "parseCSV: CSV Headers are missing in csvParser options (options.csvHeaders - can be comma-separated string, string-array or object)";
                log.error(errmsg);
                throw new Error(errmsg);
            }
        } 

        
        if(!csvHeaderDataTypes && !allHeadersString) {
            if(options.csvHeaderDataTypes) {  // if csvHeaderDataTypes were supplied in some form
                csvOptHeaderDataTypes = options.csvHeaderDataTypes
                if(typeof csvOptHeaderDataTypes === 'object') { // if csvOptHeaderDataTypes were supplied as an object or array (but not string)
                    if(csvOptHeaderDataTypes.length) { // csvOptHeaderDataTypes were supplied as an array
                        csvHeaderDataTypes = csvOptHeaderDataTypes;
                    } else {   // csvHeaderDataTypes were supplied as an object
                        csvHeaderDataTypes = Object.keys(csvOptHeaderDataTypes);
                    }
    
                } else if(typeof csvOptHeaderDataTypes === 'string') {
                    csvHeaderDataTypes = csvOptHeaderDataTypes.split(options.headerSeparator ? options.headerSeparator : ',');
                } else {
                    var errmsg = "parseCSV: options.csvHeaderDataTypes supplied are not of type string array or coma-separated string or object";
                    log.error(errmsg);
                    throw new Error(errmsg);
                }
            } else {
                log.warn("parseCSV: csvHeaderDataTypes are neither supplied as options.csvHeaderDataTypes nor as part of options.csvHeaders object. Assuming that all headers are of type 'string'");
                allHeadersString = true;
            }
        } 

        if(csvHeaders) {
            var delimiter = options.delimiter ? options.delimiter : ',';
            var fieldValues = (delimiter === ',' ? CSVtoArray(recData.rec) : recData.rec.split(delimiter));
            var error;
            fieldValues.forEach(function(fValue1, i) {
                if(error) return;

                fValue = fValue1.trim();

                if(fieldValues.length !== csvHeaders.length) {
                    if((fieldValues.length > csvHeaders.length) || ((fieldValues.length < csvHeaders.length) && (options.ignoreExtraHeaders !== true))) error = "parseCSV: Mis-match between fieldCount ("+ fieldValues.length +") and headerCount ("+ csvHeaders.length +"). Headers: '"+ csvHeaders +"'";
                    if((fieldValues.length < csvHeaders.length) && (options.ignoreExtraHeaders !== true)) error += " Try setting options.ignoreExtraHeaders to true";
                } 
                if(!error && csvHeaderDataTypes && (fieldValues.length !== csvHeaderDataTypes.length)) {
                    if((fieldValues.length > csvHeaderDataTypes.length) || ((fieldValues.length < csvHeaderDataTypes.length) && (options.ignoreExtraHeaderDataTypes !== true))) error = "parseCSV: Mis-match between fieldCount ("+ fieldValues.length +") and headerDataTypeCount ("+ csvHeaderDataTypes.length +"). HeaderDataTypes: '"+ csvHeaderDataTypes +"'";
                    if((fieldValues.length < csvHeaderDataTypes.length)  && (options.ignoreExtraHeaderDataTypes !== true)) error += " Try setting options.ignoreExtraHeaderDataTypes to true";
                } 
                if(!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() === 'number') {
                    fValue = Number(fValue);
                    if(isNaN(fValue)) {
                        error = "parseCSV: Data of fieldValue '" + fValue1 + "' did not match type 'number'"
                        fValue = fValue1;
                    }
                } else if(!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() === 'boolean') {
                    fValue = fValue.toLowerCase();
                    if(fValue === 'true') {
                        fValue = true;
                    } else if(fValue === 'false') {
                        fValue = false;
                    } else {
                        error = "parseCSV: Data of fieldValue '" + fValue1 + "' did not match type 'boolean'. Only true, false, TRUE, FALSE are accepted as type boolean."
                    }
                } else if(!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() !== 'string') {
                    error = "parseCSV: Specified DataType ('"+ csvHeaderDataTypes[i] +"') is neither string nor number nor boolean."
                }

                if(!error) json[csvHeaders[i].trim()] = fValue;  // fields are added to json as long as there are no errors. 
            });                                                  // When a field encounters an error, adding that field and additional fields is stopped.
            payload = { json: json  };

        }

        if(payload) {
            if(options.modelAPI) payload.modelAPI = options.modelAPI;
            if(options.method) payload.method = options.method;
            if(options.httpHeaders) payload.headers = options.httpHeaders;
        }        
        cb(payload, error);
    }
    return this;
}


function CSVtoArray(text) {
    var re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
    var re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
    // Return NULL if input string is not well formed CSV string.
    if (!re_valid.test(text)) return null;
    var a = [];                     // Initialize array to receive values.
    text.replace(re_value, // "Walk" the string using replace with callback.
        function(m0, m1, m2, m3) {
            // Remove backslash from \' in single quoted values.
            if      (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
            // Remove backslash from \" in double quoted values.
            else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
            else if (m3 !== undefined) a.push(m3);
            return ''; // Return empty string.
        });
    // Handle special case of empty last value.
    if (/,\s*$/.test(text)) a.push('');
    return a;
};




function fwParser(options) {
    var fwHeaders, fwHeaderDataTypes, allHeadersString = false;
    this.onEachRecord = function onEachRecord (recData, cb) {
        var payload, json = {};
        if(!fwHeaders) {
            if(options.fwHeaders) {  // if fwHeaders were supplied in some form
                fwOptHeaders = options.fwHeaders;
                if(typeof fwOptHeaders === 'object') { // if fwOptHeaders were supplied as an object or array (but not string)
                    if(fwOptHeaders.length) { // fwOptHeaders were supplied as an array (of objects - assumption). Each element is of the form 
                                              // {fieldName: 'accountNo', type: 'string', length: 16, startPosition: 1, endPosition: 16, justification: 'Left'}

                        fwHeaders = fwOptHeaders; 
                    } else {   // csvHeaders were supplied as an object
                        var errmsg = "parseFW: FW Headers specified as object. Should be array of objects.";
                        log.error(errmsg);
                        throw new Error(errmsg);
                    }
    
                } else if(typeof fwOptHeaders === 'string') {
                    var errmsg = "parseFW: FW Headers specified as string. Should be array of objects.";
                    log.error(errmsg);
                    throw new Error(errmsg);

                } else {
                    var errmsg = "parseFW: options.fwHeaders supplied are not of type array (of objects)";
                    log.error(errmsg);
                    throw new Error(errmsg);
                }
            } else {
                var errmsg = "parseFW: FW Headers are missing in fwParser options (options.fwHeaders - should be an array of objects)";
                log.error(errmsg);
                throw new Error(errmsg);
            }
        } 


    };

    return this;
}

module.exports = {
    csvParser: csvParser,
    fwParser:  fwParser
}