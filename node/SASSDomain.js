/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, node: true, nomen: true, indent: 4, maxerr: 50, regexp: true */

"use strict";

var cp = require("child_process"),
    fs = require("fs"),
    fsextra = require("fs-extra"),
    os = require("os"),
    path = require("path"),
    sass = require("node-sass");

var _domainManager,
    tmpFolders = [];

// [path]:[line]:[error string]
var RE_ERROR = /(.*)(:([0-9]+):)(.*)/;

function tmpdir() {
    var baseTmpDir = os.tmpdir();
    
    if (baseTmpDir.charAt(baseTmpDir.length - 1) !== path.sep) {
        baseTmpDir = baseTmpDir + path.sep;
    }
    
    return baseTmpDir + "brackets-sass";
}

function parseError(error, file) {
    var match = error.match(RE_ERROR),
        details;
    
    if (!match) {
        details = {
            errorString: error,
            path: file,
            pos: { line: 1, ch: 0 },
            message: error
        };
    } else {
        details = {
            errorString: error,
            path: match[1],
            pos: { line: parseInt(match[3], 10) - 1, ch: 0 },
            message: match[4] && match[4].trim()
        };
    }

    return [details];
}

function render(file, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, callback) {
    var child = cp.fork(__dirname + "/render");

    child.on("message", function (message) {
        if (message.css) {
            callback(null, { css: message.css, map: message.map });
        } else if (message.error) {
            callback(parseError(message.error, file));
        }/* else if (message.exitcode) {
            console.log("exitcode: " + message.exitcode);
        }*/
    });

    child.on("error", function (err) {
        callback(err);
    });

    child.on("exit", function (code, signal) {
        if (code === null) {
            var errString = "Fatal node-sass error, signal=" + signal;

            callback([{
                errorString: errString,
                path: file,
                pos: { ch: 0 },
                message: errString
            }]);
        }/* else {
            console.log("normal exit code: " + code);
        }*/
    });

    child.send({
        file: file,
        includePaths: includePaths,
        imagePaths: imagePaths,
        outputStyle: outputStyle,
        sourceComments: sourceComments,
        sourceMap: sourceMap
    });
}

/**
 * Normalize path separator, drop drive letter on windows, and
 * return new string starting with first path separator.
 * e.g. C:/Users/me/file.txt -> \Users\me\file.txt
 */
function normalize(fullPath) {
    // Convert path separator for windows
    var result = path.normalize(fullPath);
    
    // Drop drive letter
    var firstSep = result.indexOf(path.sep);
    return (firstSep >= 0) ? result.slice(firstSep) : result;
}

function preview(file, inMemoryFiles, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, callback) {
    // Convert path separator for windows
    file = normalize(file);
    
    var originalParent = path.dirname(file),
        tmpDirPath = tmpdir(),
        tmpFolder = tmpDirPath + originalParent,
        tmpFile = tmpFolder + path.sep + path.basename(file);
    
    // Delete existing files if they exist
    fsextra.removeSync(tmpFolder);

    // Mark folder for delete
    tmpFolders.push(tmpFolder);

    // Adjust sourceMap path
    sourceMap = tmpDirPath + sourceMap;
    
    // Copy files to temp folder
    fsextra.copySync(originalParent, tmpFolder);
    
    // Write in-memory files to temp folder
    var absPaths = Object.keys(inMemoryFiles),
        inMemoryText;
    
    absPaths.forEach(function (absPath) {
        inMemoryText = inMemoryFiles[absPath];
        fs.writeFileSync(tmpDirPath + normalize(absPath), inMemoryText);
    });
    
    // Add original file dir as includePath
    includePaths = includePaths || [];
    includePaths.unshift(originalParent);
    
    render(tmpFile, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, function (errors, result) {
        // Remove tmpdir path prefix from error paths
        if (errors) {
            errors.forEach(function (error) {
                error.path = error.path.replace(tmpDirPath, "");
            });
        }

        callback(errors, result);
    });
}

function deleteTempFiles() {
    tmpFolders.forEach(function (tmpFolder) {
        fsextra.removeSync(tmpFolder);
    });
    
    tmpFolders = [];
}

function mkdirp(path, callback) {
    fsextra.mkdirp(path, callback);
}

/**
 * Initialize the "childProcess" domain.
 * The fileWatcher domain handles watching and un-watching directories.
 */
function init(domainManager) {
    if (!domainManager.hasDomain("sass")) {
        domainManager.registerDomain("sass", {major: 0, minor: 1});
    }
    
    domainManager.registerCommand(
        "sass",
        "render",
        render,
        true,
        "Returns the path to an application",
        [
            {name: "file", type: "string"},
            {name: "data", type: "string"},
            {name: "includePaths", type: "array"},
            {name: "imagePath", type: "string"},
            {name: "outputStyle", type: "string"},
            {name: "sourceComments", type: "string"},
            {name: "sourceMap", type: "string"}
        ]
    );
    
    domainManager.registerCommand(
        "sass",
        "preview",
        preview,
        true,
        "Returns the path to an application",
        [
            {name: "file", type: "string"},
            {name: "inMemoryFiles", type: "object"},
            {name: "includePaths", type: "array"},
            {name: "imagePath", type: "string"},
            {name: "outputStyle", type: "string"},
            {name: "sourceComments", type: "string"},
            {name: "sourceMap", type: "string"}
        ]
    );
    
    domainManager.registerCommand(
        "sass",
        "deleteTempFiles",
        deleteTempFiles,
        false,
        "Delete temporary files used for Live Preview",
        []
    );
    
    domainManager.registerCommand(
        "sass",
        "mkdirp",
        mkdirp,
        true,
        "Creates a directory. If the parent hierarchy doesn't exist, it's created. Like mkdir -p.",
        [
            {name: "path", type: "string"}
        ]
    );
    
    _domainManager = domainManager;
}

exports.init = init;
