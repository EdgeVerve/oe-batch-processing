/*
©2015-2016 EdgeVerve Systems Limited (a fully owned Infosys subsidiary), Bangalore, India. All Rights Reserved.
The EdgeVerve proprietary software program ("Program"), is protected by copyrights laws, international treaties and other pending or existing intellectual property rights in India, the United States and other countries.
The Program may contain/reference third party or open source components, the rights to which continue to remain with the applicable third party licensors or the open source community as the case may be and nothing here transfers the rights to the third party and open source components, except as expressly permitted.
Any unauthorized reproduction, storage, transmission in any form or by any means (including without limitation to electronic, mechanical, printing, photocopying, recording or  otherwise), or any distribution of this Program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
*/
/**
 * This module provides 'built-in' functions for parsing data-files. File types currently supported are
 * 1. Comma Separated Value (CSV) / delimited files
 * 2. Fixed Width (FW) value files
 *
 * For documentation on the usage of this module, please see README.md
 *
 * @file parsers.js
 * @author Ajith Vasudevan
 */

// Setup a environment variable for easy setup of logger configuration
/* istanbul ignore if */
if (!process.env.LOGGER_CONFIG && process.env.BATCH_LOGGER_CONFIG) {
  process.env.LOGGER_CONFIG = JSON.stringify({'levels': {'default': process.env.BATCH_LOGGER_CONFIG.trim().toLocaleLowerCase()}});
}
var log = require('oe-logger')('parsers');
var errmsg;

// The CSV Parser function wrapper - exported from this file
function csvParser(options) {
  var csvOptHeaders, csvHeaders, csvHeaderDataTypes, allHeadersString = false;
  this.onEachRecord = function onEachRecord(recData, cb) {    // The parser function
    var payload, json = {};
    if (!csvHeaders) {
      if (options.csvHeaders) {  // if csvHeaders were supplied in some form
        csvOptHeaders = options.csvHeaders;
        if (typeof csvOptHeaders === 'object') { // if csvOptHeaders were supplied as an object or array (but not string)
          if (csvOptHeaders.length) { // csvOptHeaders were supplied as an array
            csvHeaders = csvOptHeaders;
          } else {   // csvHeaders were supplied as an object
            csvHeaders = Object.keys(csvOptHeaders);
            csvHeaderDataTypes = Object.keys(csvOptHeaders).map(function (k) { return csvOptHeaders[k];});
          }
        } else if (typeof csvOptHeaders === 'string') {
          if (csvOptHeaders.trim().length !== 0) {
            csvHeaders = csvOptHeaders.split(options.headerSeparator ? options.headerSeparator : ',');
            //            csvHeaderDataTypes = options.csvHeaderDataTypes;
          } else {
            var errmsg = "parseCSV: CSV Headers specified as string is either empty or whitespace: '" + csvOptHeaders + "'. (options.csvHeaders - can be comma-separated string, string-array or object)";
            log.error(errmsg);
            throw new Error(errmsg);
          }
        } else {
          errmsg = 'parseCSV: options.csvHeaders supplied are not of type string array or coma-separated string or object';
          log.error(errmsg);
          throw new Error(errmsg);
        }
      } else {
        errmsg = 'parseCSV: CSV Headers are missing in csvParser options (options.csvHeaders - can be comma-separated string, string-array or object)';
        log.error(errmsg);
        throw new Error(errmsg);
      }
    }


    if (!csvHeaderDataTypes && !allHeadersString) {
      var csvOptHeaderDataTypes;
      if (options.csvHeaderDataTypes) {  // if csvHeaderDataTypes were supplied in some form
        csvOptHeaderDataTypes = options.csvHeaderDataTypes;
        /* istanbul ignore if */
        if (typeof csvOptHeaderDataTypes === 'object') { // if csvOptHeaderDataTypes were supplied as an object or array (but not string)
          /* istanbul ignore else */
          if (csvOptHeaderDataTypes.length) { // csvOptHeaderDataTypes were supplied as an array
            csvHeaderDataTypes = csvOptHeaderDataTypes;
          } else {   // csvHeaderDataTypes were supplied as an object
            csvHeaderDataTypes = Object.keys(csvOptHeaderDataTypes);
          }
        } else if (typeof csvOptHeaderDataTypes === 'string') {
          csvHeaderDataTypes = csvOptHeaderDataTypes.split(options.headerSeparator ? options.headerSeparator : ',');
        } else {
          errmsg = 'parseCSV: options.csvHeaderDataTypes supplied are not of type string array or coma-separated string or object';
          log.error(errmsg);
          throw new Error(errmsg);
        }
      } else {
        log.warn("parseCSV: csvHeaderDataTypes are neither supplied as options.csvHeaderDataTypes nor as part of options.csvHeaders object. Assuming that all headers are of type 'string'");
        allHeadersString = true;
      }
    }

    /* istanbul ignore else */
    if (csvHeaders) {
      var fValue;
      var delimiter = options.delimiter ? options.delimiter : ',';
      var fieldValues = (delimiter === ',' ? cSVtoArray(recData.rec) : recData.rec.split(delimiter));
      var error;
      fieldValues.forEach(function (fValue1, i) {
        if (error) return;

        fValue = fValue1.trim();

        if (fieldValues.length !== csvHeaders.length) {
          /* istanbul ignore else */
          if ((fieldValues.length > csvHeaders.length) || ((fieldValues.length < csvHeaders.length) && (options.ignoreExtraHeaders !== true))) error = 'parseCSV: Mis-match between fieldCount (' + fieldValues.length + ') and headerCount (' + csvHeaders.length + "). Headers: '" + csvHeaders + "'";
          /* istanbul ignore if */
          if ((fieldValues.length < csvHeaders.length) && (options.ignoreExtraHeaders !== true)) error += ' Try setting options.ignoreExtraHeaders to true';
        }
        if (!error && csvHeaderDataTypes && (fieldValues.length !== csvHeaderDataTypes.length)) {
          /* istanbul ignore else */
          if ((fieldValues.length > csvHeaderDataTypes.length) || ((fieldValues.length < csvHeaderDataTypes.length) && (options.ignoreExtraHeaderDataTypes !== true))) error = 'parseCSV: Mis-match between fieldCount (' + fieldValues.length + ') and headerDataTypeCount (' + csvHeaderDataTypes.length + "). HeaderDataTypes: '" + csvHeaderDataTypes + "'";
          /* istanbul ignore if */
          if ((fieldValues.length < csvHeaderDataTypes.length)  && (options.ignoreExtraHeaderDataTypes !== true)) error += ' Try setting options.ignoreExtraHeaderDataTypes to true';
        }
        if (!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() === 'number') {
          fValue = Number(fValue);
          /* istanbul ignore else */
          if (isNaN(fValue)) {
            error = "parseCSV: Data of fieldValue '" + fValue1 + "' did not match type 'number'";
            fValue = fValue1;
          }
        } else if (!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() === 'boolean') {
          fValue = fValue.toLowerCase();
          /* istanbul ignore if */
          if (fValue === 'true') {
            fValue = true;
          } else if (fValue === 'false') {
            fValue = false;
          } else {
            error = "parseCSV: Data of fieldValue '" + fValue1 + "' did not match type 'boolean'. Only true, false, TRUE, FALSE are accepted as type boolean.";
          }
        } else if (!error && csvHeaderDataTypes && csvHeaderDataTypes[i].toLowerCase().trim() !== 'string') {
          error = "parseCSV: Specified DataType ('" + csvHeaderDataTypes[i] + "') is neither string nor number nor boolean.";
        }

        if (!error) json[csvHeaders[i].trim()] = fValue;  // fields are added to json as long as there are no errors.
      });                                                  // When a field encounters an error, adding that field and additional fields is stopped.
      payload = { json: json  };
    }

    /* istanbul ignore else */
    if (payload) {
      /* istanbul ignore if */
      if (options.modelAPI) payload.modelAPI = options.modelAPI;
      /* istanbul ignore if */
      if (options.method) payload.method = options.method;
      /* istanbul ignore if */
      if (options.httpHeaders) payload.headers = options.httpHeaders;
    }
    cb(payload, error);
  };
  return this;
}


function cSVtoArray(text) {
  var re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
  var re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
  // Return NULL if input string is not well formed CSV string.
  /* istanbul ignore if */
  if (!re_valid.test(text)) return null;
  var a = [];                     // Initialize array to receive values.
  text.replace(re_value, // "Walk" the string using replace with callback.
    function (m0, m1, m2, m3) {
      // Remove backslash from \' in single quoted values.
      /* istanbul ignore if */
      if      (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
      // Remove backslash from \" in double quoted values.
      else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
      else if (m3 !== undefined) a.push(m3);
      return ''; // Return empty string.
    });
  // Handle special case of empty last value.
  /* istanbul ignore if */
  if (/,\s*$/.test(text)) a.push('');
  return a;
}

// The CSV Parser function wrapper - exported from this file
function fwParser(options) {
  var fwOptHeaders, fwHeaders;

  this.onEachRecord = function onEachRecord(recData, cb) {   // The parser function
    var payload, json = {};
    var errMsg, error;
    if (!fwHeaders) {
      if (options.fwHeaders) {  // if fwHeaders were supplied in some form
        fwOptHeaders = options.fwHeaders;
        if (typeof fwOptHeaders === 'object') { // if fwOptHeaders were supplied as an object or array (but not string)
          if (fwOptHeaders.length === 0) {
            errmsg = 'parseFW: FW Headers specified as empty array. Should be array of objects.';
            log.error(errmsg);
            throw new Error(errmsg);
          } else if (fwOptHeaders.length) { // fwOptHeaders were supplied as an array (of objects - assumption). Each element is of the form
            // {fieldName: 'accountNo', type: 'string', length: 16, startPosition: 1, endPosition: 16, justification: 'Left'}
            fwHeaders = fwOptHeaders;
          } else {   // csvHeaders were supplied as an object
            errmsg = 'parseFW: FW Headers specified as object. Should be array of objects.';
            log.error(errmsg);
            throw new Error(errmsg);
          }
        } else {
          errmsg = 'parseFW: options.fwHeaders supplied are not of type array (of objects)';
          log.error(errmsg);
          throw new Error(errmsg);
        }
      } else {
        errmsg = 'parseFW: FW Headers are missing in fwParser options (options.fwHeaders - should be an array of objects)';
        log.error(errmsg);
        throw new Error(errmsg);
      }

      errmsg = undefined;
      fwHeaders.forEach(function (headerObj, i) {
        if (!headerObj.fieldName) errmsg = 'parseFW: Header fieldName is missing in ' + JSON.stringify(headerObj) + ' at index ' + i;
        else if (!headerObj.type) errmsg = 'parseFW: Header type is missing in ' + JSON.stringify(headerObj) + ' at index ' + i;
        else if (!headerObj.startPosition) errmsg = 'parseFW: Header startPosition is missing in ' + JSON.stringify(headerObj) + ' at index ' + i;
        else if (!headerObj.endPosition) errmsg = 'parseFW: Header endPosition is missing in ' + JSON.stringify(headerObj) + ' at index ' + i;
        if (errmsg) throw new Error(errmsg);
      });
    }

    errMsg = undefined;

    /* istanbul ignore if */
    if (!recData.rec) throw new Error('parseFW: Record not found in recData');

    if (recData.rec.length > fwHeaders[fwHeaders.length - 1].endPosition) errMsg = 'parseFW: Record length is larger than max-header-position ( ' + recData.rec.length + ' > ' + fwHeaders[fwHeaders.length - 1].endPosition +  ' )';
    else if (recData.rec.length < fwHeaders[fwHeaders.length - 1].endPosition) errMsg = 'parseFW: Record length is smaller than max-header-position ( ' + recData.rec.length + ' < ' + fwHeaders[fwHeaders.length - 1].endPosition +  ' )';

    if (errMsg) return cb({}, errMsg);

    fwHeaders.forEach(function (headerObj) {
      var fieldStr = recData.rec.substring(headerObj.startPosition - 1, headerObj.endPosition);
      var fValue;
      if (headerObj.type.toLowerCase().trim() === 'number') {
        fValue = Number(fieldStr);
        if (isNaN(fValue)) {
          error = "parseFW: Data of fieldValue '" + fieldStr + "' at position " + headerObj.startPosition + ',' + headerObj.endPosition  + " did not match type 'number'";
          fValue = fieldStr;
        }
      } else if (headerObj.type.toLowerCase().trim() === 'boolean') {
        fValue = fieldStr.toLowerCase();
        /* istanbul ignore if */
        if (fValue === 'true') {
          fValue = true;
        } else if (fValue === 'false') {
          fValue = false;
        } else {
          error = "parseFW: Data of fieldValue '" + fieldStr + "' at position " + headerObj.startPosition + ',' + headerObj.endPosition  + " did not match type 'boolean'. Only true, false, TRUE, FALSE are accepted as type boolean.";
        }
      } else if (headerObj.type.toLowerCase().trim() !== 'string') {
        error = "parseFW: Specified DataType ('" + headerObj.type + "') is neither string nor number nor boolean.";
      } else fValue = fieldStr;

      if (!error) json[headerObj.fieldName.trim()] = fValue;  // fields are added to json as long as there are no errors.
    });                                                  // When a field encounters an error, adding that field and additional fields is stopped
    payload = { json: json  };

    /* istanbul ignore if */
    if (options.modelAPI) payload.modelAPI = options.modelAPI;
    /* istanbul ignore if */
    if (options.method) payload.method = options.method;
    /* istanbul ignore if */
    if (options.httpHeaders) payload.headers = options.httpHeaders;
    cb(payload, error);
  };

  return this;
}

module.exports = {
  csvParser: csvParser,
  fwParser: fwParser
};
