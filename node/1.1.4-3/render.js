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

var cwd = process.cwd();

function _success(css, map) {
    process.send({ css: css, map: map, _cwd: cwd });
}

function _error(error) {
    process.send({ error: error.message || error });
}

process.on("message", function (message) {
    if (message._compiler === "ruby") {
        var tmpCssFile = message.file.replace(/\.s[ac]ss$/, ".css"),
            command = "sass '" + message.file + "' '" + tmpCssFile + "' --style " + message.outputStyle;
        message.includePaths.forEach(function (path) {
            command += " --load-path '" + path + "'";
        });
        if (message.sourceComments) {
            command += " --line-numbers";
        }
        if (message.compass) {
            command += " --compass";
        }

        cp.exec(command, function (error, stdout, stderr) {
            if (stderr) {
                _error(stderr);
            } else if (error) {
                process.exit(error);
            } else {
                var css,
                    map;

                fs.readFile(tmpCssFile, { encoding: "utf-8" }, function (error, content) {
                    if (error) {
                        _error(error);
                    } else if (map) {
                        _success(content, map);
                    } else {
                        css = content;
                    }
                });
                fs.readFile(tmpCssFile + ".map", { encoding: "utf-8" }, function (error, content) {
                    if (error) {
                        _error(error);
                    } else if (css) {
                        _success(css, content);
                    } else {
                        map = content;
                    }
                });
            }
        });
    } else { // "libsass"
        message.success = function (css, map) {
            // Convert sources array paths to be relative to input file
            var mapJSON = JSON.parse(map),
                sourcePath,
                inputParent = path.dirname(message.file);

            mapJSON.sources.forEach(function (source, index) {
                // Resolve from working directory (e.g. c:\windows\system32)
                sourcePath = path.resolve(cwd, source);
                // See https://github.com/jasonsanjose/brackets-sass/issues/89
                if (process.platform === "win32") {
                    sourcePath = sourcePath.replace(/^([a-z]:\\){1,2}/i, "$1");
                }
                sourcePath = path.relative(inputParent, sourcePath);

                if (path.sep === "\\") {
                    sourcePath = sourcePath.replace(/\\/g, "/");
                }

                // Set source path relative to input file parent (sourceRoot)
                mapJSON.sources[index] = sourcePath;
            });

            _success(css, JSON.stringify(mapJSON));
        };
        message.error = _error;
        sass.render(message);
    }
});

process.on("exit", function (code) {
    process.send({ exitcode: code });
});

process.on("uncaughtException", _error);