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

process.on("uncaughtException", function (error) {
    process.send({ error: error.stack || error.message || error });
});

// HACK make process.sassBinaryName read only
Object.defineProperty(process, "sassBinaryName", {
    value: process.platform + "-ia32-11"
});

var cp = require("child_process"),
    path = require("path"),
    fs = require("fs-extra"),
    sass = require("node-sass"),
    rubyChildProcess;

var ruby = {},
    // Error: [message]\n on line [line] of [path]
    RE_RUBY_ERROR = /Error: ([\s\S]*)on line ([0-9]+) of (.*)/i,
    // WARNING: [message]\n from line [line] of [path]
    RE_RUBY_WARNING = /(WARNING: [\s\S]*)from line ([0-9]+) of (.*)/i;

function _success(result) {
    process.send(result);
}

function _error(error) {
    process.send({ error: error });
}

function _log(message) {
    process.send({ log: message });
}

ruby.parseError = function (file, errorString) {
    var match = errorString.match(RE_RUBY_ERROR),
        type = "error",
        details;
    
    if (!match) {
        match = errorString.match(RE_RUBY_WARNING);
        type = "warning";
    }

    if (!match) {
        details = {
            type: "error",
            errorString: errorString,
            path: file,
            pos: { line: 0, ch: 0 },
            message: errorString
        };
    } else {
        details = {
            type: type,
            errorString: errorString,
            path: match[3],
            pos: { line: parseInt(match[2], 10) - 1, ch: 0 },
            message: match[1] && match[1].trim()
        };
    }

    return details;
};

ruby.render = function (message) {
    var tmpCssMapFile = message.outFile + ".map",
        command = "sass '" + message.file + "'",
        options = {},
        css,
        map,
        error;
    
    // Save output
    command += " '" + message.outFile + "'";
    
    if (message.sourceComments) {
        command += " --line-numbers";
    }
    
    command += " --style " + message.outputStyle;

    if (message.compass) {
        // Enable compass
        command += " --compass";
        
        // defer to <project root>/config.rb when using compass
        // FIXME how to deal with relative paths in config.rb from temp dir?
        options.cwd = message.compass.projectRoot;
    } else {
        message.includePaths.forEach(function (path) {
            command += " --load-path '" + path + "'";
        });
    }
    
    var _finish = function () {
        if (error && error.type === "error") {
            _error(error);
        } else if (css && map) {
            _success({
                css: css,
                map: map,
                error: error // !error || error.type === "warning"
            });
        }
    };
    
    var _readTempFile = function (file, callback) {
        fs.readFile(file, { encoding: "utf-8" }, function (fileError, content) {
            if (fileError) {
                error = error || ruby.parseError(message.file, fileError);
                _finish();
            } else {
                callback(content);
                _finish();
            }
        });
    };
    
    // log details to brackets
    /*_log({
        message: message,
        command: command
    });*/

    rubyChildProcess = cp.exec(command, options, function (execError, stdout, stderr) {
        if (stderr) {
            error = ruby.parseError(message.file, stderr);
        } else if (execError) {
            process.exit(execError);
        }
        
        _readTempFile(message.outFile, function (content) {
            css = content;
        });
        
        _readTempFile(tmpCssMapFile, function (content) {
            map = content;
        
            fs.unlink(tmpCssMapFile);
        });
    });
};

process.on("message", function (message) {
    if (message._compiler === "ruby") {
        // Create output directory before running ruby compiler
        fs.mkdirp(path.dirname(message.outFile), function () {
            ruby.render(message);
        });
    } else { // "libsass"
        sass.render(message, function (error, result) {
            if (error) {
                _error({
                    errorString: error.message,
                    path: error.file,
                    pos: { line: error.line - 1, ch: error.column },
                    message: error.message
                });
            } else {
                _success({
                    css: result.css.toString(),
                    map: result.map.toString()
                });
            }
        });
    }
});

process.on("exit", function (code) {
    if (rubyChildProcess) {
        rubyChildProcess.kill();
    }
    
    process.send({ exitcode: code });
});