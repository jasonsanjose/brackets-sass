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
    path = require("path"),
    fs = require("fs-extra"),
    sass = require("node-sass");

var ruby = {},
    RE_RUBY_ERROR = {
        // Error: [message]\n on line [line] of [path]
        regexp: /Error: (.*)(\n|\r|\n\r)\s+on line ([0-9]+) of (.*)/i,
        index: {
            path: 4,
            line: 3,
            message: 1
        }
    },
    RE_RUBY_WARNING = {
        // WARNING: [message]\n from line [line] of [path]
        regexp: /(WARNING: [\s\S]*)from line ([0-9]+) of (.*)/i,
        index: {
            path: 3,
            line: 2,
            message: 1
        }
    };

function _log(message) {
    process.send({ log: message });
}

function _success(result) {
    process.send(result);
}

function _error(error) {
    process.send({ errorMessage: error.message || error });
}

ruby.parseError = function (file, errorString) {
    var match = errorString.match(RE_RUBY_ERROR.regexp),
        index = RE_RUBY_ERROR.index,
        details;
    
    if (!match) {
        match = errorString.match(RE_RUBY_WARNING.regexp);
        index = RE_RUBY_WARNING.index;
    }

    if (!match) {
        details = {
            errorString: errorString,
            path: file,
            pos: { line: 0, ch: 0 },
            message: errorString
        };
    } else {
        details = {
            errorString: errorString,
            path: match[index.path],
            pos: { line: parseInt(match[index.line], 10) - 1, ch: 0 },
            message: match[index.message] && match[index.message].trim()
        };
    }

    return details;
};

ruby.render = function (message) {
    var tmpCssMapFile = message.outFile + ".map",
        command = "sass '" + message.file + "' '" + message.outFile + "' --style " + message.outputStyle,
        css,
        map,
        error;
    
    message.includePaths.forEach(function (path) {
        command += " --load-path '" + path + "'";
    });
    
    if (message.sourceComments) {
        command += " --line-numbers";
    }
    
    var _finish = function () {
        if (!css && !map) {
            process.send({ error: ruby.parseError(message.file, error) });
        } else if (css && map) {
            message.success({
                css: css,
                map: map,
                error: ruby.parseError(message.file, error)
            });
        }
    };
    
    var _readTempFile = function (file, callback) {
        fs.readFile(file, { encoding: "utf-8" }, function (fileError, content) {
            if (fileError) {
                error = error || fileError;
                _finish();
            } else {
                fs.remove(message.outFile, function () {
                    callback(content);
                    _finish();
                });
            }
        });
    };

    cp.exec(command, function (execError, stdout, stderr) {
        if (stderr) {
            error = stderr;
        } else if (execError) {
            process.exit(execError);
        }
        
        _readTempFile(message.outFile, function (content) {
            css = content;
        });
        
        _readTempFile(tmpCssMapFile, function (content) {
            map = content;
        });
    });
};

process.on("message", function (message) {
    message.success = function (result) {
        _success(result);
    };

    if (message._compiler === "ruby") {
        // Create output directory before running ruby compiler
        fs.mkdirp(path.dirname(message.outFile), function () {
            ruby.render(message);
        });
    } else { // "libsass"
        message.error = function (sassError) {
            var details = {};
            
            details.errorString = sassError.message;
            details.path = sassError.file;
            details.pos = { line: sassError.line - 1, ch: sassError.column };
            details.message = sassError.message;
            
            process.send({ error: details });
        };
        
        sass.render(message);
    }
});

process.on("exit", function (code) {
    process.send({ exitcode: code });
});

process.on("uncaughtException", function (error) {
    process.send({ error: error.stack || error.message || error });
});