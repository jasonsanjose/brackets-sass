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
    crypto = require("crypto"),
    fs = require("fs"),
    fsextra = require("fs-extra"),
    os = require("os"),
    path = require("path");

// [path]:[line]:[error string]
var RE_ERROR = /(.*)(:([0-9]+):)(.*)/,
    DOMAIN = "sass-v1.1.4-3";

var _domainManager,
    _tmpdir,
    _compilerProcess,
    _currentRenderMsg,
    _queue = [],
    tmpFolders = [];

// Cleanup node-sass child process on quit
process.on("exit", function () {
    if (!_compilerProcess) {
        return;
    }

    _compilerProcess.kill();
});

/**
 * Normalize path separator, drop drive letter on windows, and
 * return new string starting with first path separator.
 * e.g. C:/Users/me/file.txt -> \Users\me\file.txt
 */
function normalize(fullPath) {
    // Convert path separator for windows
    var result = path.resolve(path.normalize(fullPath));
    
    // Drop drive letter
    var firstSep = result.indexOf(path.sep);
    return (firstSep >= 0) ? result.slice(firstSep) : result;
}

function tmpdir() {
    if (_tmpdir) {
        return _tmpdir;
    }
    
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

function _toArray(arr) {
    return Array.isArray(arr) ? arr : [];
}

function _toRelativePaths(file, pathsArray) {
    var retval = [],
        absolute,
        relative;

    if (pathsArray) {
        pathsArray = Array.isArray(pathsArray) ? pathsArray : [pathsArray];
        
        pathsArray.forEach(function (p) {
            absolute = path.resolve(file, p);
            relative = path.relative(file, absolute);
            retval.push(relative);
        });
    }

    return retval;
}

function _toAbsolutePaths(file, pathsArray, tmpRoot) {
    var retval = [],
        absolute;
    
    if (pathsArray) {
        pathsArray = Array.isArray(pathsArray) ? pathsArray : [pathsArray];

        pathsArray.forEach(function (p) {
            absolute = path.resolve(file, p);

            // If tmpRoot is defined, and path is relative, add relative path in tmpRoot
            if (tmpRoot && (p !== absolute)) {
                retval.push(path.resolve(tmpRoot, p));
            }
            
            retval.push(absolute);
        });
    }

    return retval;
}

function _createChildProcess() {
    if (!_compilerProcess) {
        var renderScript = __dirname + path.sep + "render";
        _compilerProcess = cp.fork(renderScript);

        // Recreate the process if it dies unexpectedly
        _compilerProcess.on("exit", function () {
            _compilerProcess = null;
        });
    }
    return _compilerProcess;
}

function _nextRender() {
    if (_currentRenderMsg || _queue.length === 0) {
        return;
    }

    _currentRenderMsg = _queue.shift();

    var renderMsg = _currentRenderMsg,
        callback = renderMsg._callback,
        childProcess = _createChildProcess(),
        messageListener,
        errorListener,
        exitListener,
        timeout;

    // Set timeout
    timeout = setTimeout(function () {
        childProcess.kill();
    }, 10000);

    function cleanup() {
        _currentRenderMsg = null;
        clearTimeout(timeout);

        childProcess.removeListener("message", messageListener);
        childProcess.removeListener("error", errorListener);
        childProcess.removeListener("exit", exitListener);

        _nextRender();
    }

    messageListener = function (message) {
        cleanup();

        if (message.css) {
            // Convert sources array paths to be relative to input file
            var mapJSON = JSON.parse(message.map),
                sourcePath,
                inputParent = path.dirname(renderMsg.file);

            mapJSON.sources.forEach(function (source, index) {
                // Resolve from working directory (e.g. c:\windows\system32)
                sourcePath = path.resolve(message._cwd, source);
                sourcePath = path.relative(inputParent, sourcePath);

                if (path.sep === "\\") {
                    sourcePath = sourcePath.replace(/\\/g, "/");
                }

                // Set source path relative to input file parent (sourceRoot)
                mapJSON.sources[index] = sourcePath;
            });

            callback(null, { css: message.css, map: mapJSON });
        } else if (message.error) {
            callback(parseError(message.error, renderMsg._file));
        }/* else if (message.exitcode) {
            console.log("exitcode: " + message.exitcode);
        }*/
    };

    errorListener = function (err) {
        cleanup();
        callback(err);
    };

    exitListener = function (code, signal) {
        cleanup();

        if (code === null) {
            var errString = "Fatal node-sass error, signal=" + signal;

            callback([{
                errorString: errString,
                path: renderMsg.file,
                pos: { ch: 0 },
                message: errString
            }]);
        }/* else {
            console.log("normal exit code: " + code);
        }*/
    };

    childProcess.once("message", messageListener);
    childProcess.once("error", errorListener);
    childProcess.once("exit", exitListener);

    childProcess.send(renderMsg);
}

function render(file, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, compiler, callback) {
    var cwd = path.resolve(path.dirname(file)) + path.sep;

    includePaths = _toAbsolutePaths(cwd, includePaths);
    imagePaths = _toAbsolutePaths(cwd, imagePaths);
    
    // Paths are relative to current working directory (file parent folder)
    var renderMsg = {
        file: path.resolve(file),
        includePaths: includePaths,
        imagePaths: imagePaths,
        outputStyle: outputStyle,
        sourceComments: sourceComments,
        sourceMap: sourceMap,
        _file: file,
        _callback: callback,
        _compiler: compiler,
        _sourceMapPath: path.resolve(cwd, sourceMap)
    };

    _queue.push(renderMsg);
    _nextRender();
}

function preview(file, inMemoryFiles, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, compiler, callback) {
    // Convert path separator for windows
    var normalizedFile = normalize(file);
    
    var originalParent = path.dirname(normalizedFile),
        md5 = crypto.createHash("md5").update(file).digest("hex"),
        tmpDirPath = path.join(tmpdir(), md5),
        tmpFolder = path.join(tmpDirPath, originalParent),
        tmpFile = tmpFolder + path.sep + path.basename(file);
    
    // Delete temp files if they exist
    fsextra.removeSync(tmpDirPath);

    // Mark folder for delete
    tmpFolders.push(tmpDirPath);
    
    // Copy files to temp folder
    //fsextra.copySync(originalParent, tmpFolder);
    fsextra.copySync(file, tmpFile);
    
    // Convert include and image paths to absolute paths relative to parent folder
    var tmpIncludePaths = _toAbsolutePaths(originalParent, includePaths, tmpFolder),
        tmpImagePaths = _toAbsolutePaths(originalParent, imagePaths, tmpFolder);

    // Copy include paths to tmpDirPath
    tmpIncludePaths.forEach(function (absPath) {
        if (fs.existsSync(absPath)) {
            fsextra.copySync(absPath, path.join(tmpDirPath, normalize(absPath)));
        }
    });

    // Add original file dir as includePath to handle "../" relative imports
    tmpIncludePaths.unshift(originalParent);
    
    // Write in-memory files to temp folder
    var absPaths = Object.keys(inMemoryFiles),
        inMemoryText;
    
    absPaths.forEach(function (absPath) {
        inMemoryText = inMemoryFiles[absPath];
        fsextra.outputFileSync(path.join(tmpDirPath, normalize(absPath)), inMemoryText);
    });
    
    render(tmpFile, tmpIncludePaths, tmpImagePaths, outputStyle, sourceComments, sourceMap, compiler, function (errors, result) {
        // Remove tmpdir path prefix from error paths
        if (errors) {
            var normalizedTempFilePath = path.normalize(tmpFile),
                normalizedErrorPath;
            
            errors.forEach(function (error) {
                normalizedErrorPath = path.normalize(error.path);
                
                if (normalizedErrorPath === normalizedTempFilePath) {
                    error.path = file;
                } else {
                    error.path = path.resolve(tmpFolder, error.path);
                }
            });
        } else {
            // Convert relative paths to tmpFile in source map
            var map = result.map;

            if (Array.isArray(map.sources)) {
                var newSources = [],
                    absPath;

                map.sources.forEach(function (source) {
                    // Resolve to absolute path, then resolve relative to input file parent folder
                    absPath = path.resolve(tmpFolder, source);

                    if (path.normalize(absPath) === tmpFile) {
                        // Special case for input file
                        newSources.push(path.basename(file));
                    } else {
                        newSources.push(path.relative(path.dirname(file), absPath));
                    }
                });

                // Replaces sources with updated relative paths
                map.sources = newSources;

                // Send updated JSON string
                result.map = map;
            }
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

function mkdirp(pathToDir, callback) {
    fsextra.mkdirp(pathToDir, callback);
}


function setTempDir(pathToDir, callback) {
    _tmpdir = path.join(pathToDir, "brackets-sass");
    fsextra.mkdirp(_tmpdir, callback);
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
        DOMAIN,
        "render",
        render,
        true,
        "Returns the path to an application",
        [
            {name: "file", type: "string"},
            {name: "includePaths", type: "array"},
            {name: "imagePath", type: "string"},
            {name: "outputStyle", type: "string"},
            {name: "sourceComments", type: "boolean"},
            {name: "sourceMap", type: "string"},
            {name: "compiler", type: "string"}
        ]
    );
    
    domainManager.registerCommand(
        DOMAIN,
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
            {name: "sourceComments", type: "boolean"},
            {name: "sourceMap", type: "string"},
            {name: "compiler", type: "string"}
        ]
    );
    
    domainManager.registerCommand(
        DOMAIN,
        "deleteTempFiles",
        deleteTempFiles,
        false,
        "Delete temporary files used for Live Preview",
        []
    );
    
    domainManager.registerCommand(
        DOMAIN,
        "mkdirp",
        mkdirp,
        true,
        "Creates a directory. If the parent hierarchy doesn't exist, it's created. Like mkdir -p.",
        [
            {name: "path", type: "string"}
        ]
    );
    
    domainManager.registerCommand(
        DOMAIN,
        "setTempDir",
        setTempDir,
        true,
        "Set the temporary directory used for in-memory compiling",
        [
            {name: "path", type: "string"}
        ]
    );
    
    _domainManager = domainManager;
}

exports.init = init;