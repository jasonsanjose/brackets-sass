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
    compassOptions = require("compass-options"),
    crypto = require("crypto"),
    fs = require("fs"),
    fsextra = require("fs-extra"),
    os = require("os"),
    path = require("path");

var DOMAIN = "sass-v2.0.3",
    RE_NODE_SASS_WIN_DRIVE = /([a-z]:\\([a-z]:\\))/i;

var _domainManager,
    _tmpdir,
    _compilerProcess,
    _currentRenderMsg,
    _queue = [],
    _timeout = 10000,
    tmpFolders = [];

// Cleanup compiler child process on quit
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
    if (_timeout >= 0) {
        timeout = setTimeout(function () {
            childProcess.kill();
        }, _timeout);
    }

    function cleanup() {
        _currentRenderMsg = null;
        clearTimeout(timeout);

        childProcess.removeListener("message", messageListener);
        childProcess.removeListener("error", errorListener);
        childProcess.removeListener("exit", exitListener);

        _nextRender();
    }

    messageListener = function (message) {
        if (message.log) {
            console.log(message.log);
        }
        
        if (message.css) {
            cleanup();
            
            callback(null, {
                css: message.css,
                map: JSON.parse(message.map),
                error: message.error
            });
        } else if (message.error) {
            cleanup();
            
            // TODO allow warnings?
            // message.errorMessage.indexOf("WARNING") < 0
            callback([message.error]);
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
            var errString = "Fatal compiler error, signal=" + signal;

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

    childProcess.on("message", messageListener);
    childProcess.once("error", errorListener);
    childProcess.once("exit", exitListener);

    childProcess.send(renderMsg);
}

function render(file, outFile, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, compiler, compass, callback) {
    var cwd = path.resolve(path.dirname(file)) + path.sep;

    // Normalize input/output (but don't drop drive letter)
    file = path.normalize(file);
    outFile = path.normalize(outFile);

    // Include paths are usually relative paths, convert to absolute
    includePaths = _toAbsolutePaths(cwd, includePaths);
    imagePaths = _toAbsolutePaths(cwd, imagePaths);

    if (compass) {
        compass.projectRoot = path.resolve(compass.projectRoot);

        // Compass assumes input file name is the same as output
        var outputFileName = path.basename(file).replace(/\.s[ac]ss$/, ".css"),
            outputDir;

        // Parse config.rb and use css_dir determine outFile
        // TODO support css_path
        // TODO move this to client side code?
        var compassConfig = compassOptions.paths({ config: path.join(compass.projectRoot, "config.rb") });
        
        // FIXME compass-options packages uses "css" as default instead of "stylesheets"
        // see http://compass-style.org/help/documentation/configuration-reference/
        outputDir = compassConfig.css;
        
        // outputFileName swaps .sass/.scss with .css
        outFile = path.join(compass.projectRoot, outputDir, outputFileName);
    }
    
    // Paths are relative to current working directory (file parent folder)
    var renderMsg = {
        compass: compass,
        file: file,
        outFile: outFile,
        includePaths: includePaths,
        imagePaths: imagePaths,
        outputStyle: outputStyle,
        sourceComments: sourceComments,
        sourceMap: sourceMap,
        _compiler: compiler
    };
    
    renderMsg._callback = function (errors, result) {
        var map = result && result.map;
        
        if (map && Array.isArray(map.sources)) {
            var newSources = [],
                outFolder = path.dirname(outFile),
                newSource,
                absPath;

            // compilers output relative source paths (if possible)
            // using forward slash "/" on all platforms
            map.sources.forEach(function (source) {
                // TODO refactor into implementation specific compiler modules
                // On windows, if the output file and source are on different
                // drives, weird things happen....
                // Ruby
                //     file:///D:/bourbon-example/scss/partial.scss
                // node-sass
                //     ../../../../../../../../../../D:/bourbon-example/scss/partial.scss
                newSource = source.replace("file:///", "");
                absPath = path.resolve(outFolder, newSource);

                // node-sass resolves to C:\D:\bourbon-example\scss\partial.scss
                // Remove extra drive letter
                if (absPath.match(RE_NODE_SASS_WIN_DRIVE)) {
                    newSource = absPath.replace(RE_NODE_SASS_WIN_DRIVE, "$2", "$1");
                }

                // file is a normalized path (with backslash on windows)
                if (absPath === file) {
                    // Move input file to the top
                    newSources.unshift(newSource);
                } else {
                    newSources.push(newSource);
                }
            });

            // Replaces sources with updated relative paths
            map.sources = newSources;

            // Send updated JSON string
            result.map = map;

            result._compassOutFile = compass && outFile;
        }
        
        callback.call(null, errors, result);
    };

    _queue.push(renderMsg);
    _nextRender();
}

function _removePathFromErrorString(errorString, path) {
    return errorString.replace(path, "");
}

// TODO udpate temp paths for outFile?
function preview(file, outFile, inMemoryFiles, includePaths, imagePaths, outputStyle, sourceComments, sourceMap, compiler, compass, callback) {
    // Convert path separator for windows
    var normalizedFile = normalize(file);
    
    var originalParent = path.dirname(file),
        md5 = crypto.createHash("md5").update(file).digest("hex"),
        tmpDirPath = path.join(tmpdir(), md5),
        tmpFolder = path.join(tmpDirPath, normalize(originalParent)), // <tmpdir>/<path without drive letter>
        outFolder = path.dirname(path.normalize(outFile)), // keep drive letter
        tmpOutFolder = path.join(tmpDirPath, normalize(outFolder)), // drop drive letter
        tmpFile = tmpFolder + path.sep + path.basename(file), // <tmpdir>/<path without drive letter>/<input file name>
        tmpOutFile = tmpOutFolder + path.sep + path.basename(outFile); // <tmpdir>/<path without drive letter>/<out file>
    
    // Delete temp files if they exist
    fsextra.removeSync(tmpDirPath);

    // Mark folder for delete
    tmpFolders.push(tmpDirPath);
    
    // Copy files to temp folder
    fsextra.copySync(file, tmpFile);
    
    if (compass.projectRoot) {
        var configRb = "config.rb",
            rootConfigRb = path.resolve(compass.projectRoot + path.sep + configRb),
            tmpRoot = path.join(tmpDirPath, normalize(path.dirname(rootConfigRb))),
            tmpConfigRb = tmpRoot + path.sep + configRb;
        
        try {
            // FIXME Unused, see render.js changing cwd to original project path
            fsextra.copySync(rootConfigRb, tmpConfigRb);
        } catch (err) {
            console.log("Missing config.rb file at " + rootConfigRb);
        }

        // FIXME copy source dirs from config.rb to temp?
        //compass.projectRoot = tmpRoot;
    }
    
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
    
    render(tmpFile, tmpOutFile, tmpIncludePaths, tmpImagePaths, outputStyle, sourceComments, sourceMap, compiler, compass, function (errors, result) {
        var errorsToProcess = errors || [];
        
        if (result && result.error) {
            errorsToProcess.push(result.error);
        }
        
        // Remove tmpdir path prefix from error paths
        if (errorsToProcess.length) {
            var normalizedTempFilePath = path.normalize(tmpFile);
            
            errorsToProcess.forEach(function (error) {
                error.path = path.normalize(error.path);
                
                if (error.path === normalizedTempFilePath) {
                    error.path = file;
                } else {
                    error.path = path.resolve(originalParent, path.relative(tmpFolder, error.path));
                }
                
                error.message = _removePathFromErrorString(error.message, tmpDirPath);
            });
        }
        
        if (result) {
            // Convert relative paths to tmpFile in source map
            var map = result.map;

            if (Array.isArray(map.sources)) {
                var newSources = [],
                    absPath;

                map.sources.forEach(function (source) {
                    // Resolve to absolute path, then resolve relative to input file parent folder
                    absPath = path.resolve(tmpOutFolder, source);

                    if (absPath.indexOf(tmpDirPath) >= 0) {
                        // Files copied into temp
                        newSources.push(path.relative(tmpOutFolder, absPath));
                    } else {
                        // Files found in the original project location
                        newSources.push(path.relative(outFolder, absPath));
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

function setCompilerTimeout(timeout) {
    timeout = typeof timeout === "number" ? timeout : -1;
    _timeout = timeout;
}

function killProcess() {
    if (_compilerProcess) {
        _compilerProcess.kill();
        _compilerProcess = undefined;
    }
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
            {name: "outFile", type: "string"},
            {name: "includePaths", type: "array"},
            {name: "imagePath", type: "string"},
            {name: "outputStyle", type: "string"},
            {name: "sourceComments", type: "boolean"},
            {name: "sourceMap", type: "string"},
            {name: "compiler", type: "string"},
            {name: "compass", type: "boolean"}
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
            {name: "outFile", type: "string"},
            {name: "inMemoryFiles", type: "object"},
            {name: "includePaths", type: "array"},
            {name: "imagePath", type: "string"},
            {name: "outputStyle", type: "string"},
            {name: "sourceComments", type: "boolean"},
            {name: "sourceMap", type: "string"},
            {name: "compiler", type: "string"},
            {name: "compass", type: "boolean"}
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
        "setCompilerTimeout",
        setCompilerTimeout,
        false,
        "Defines a compiler timeout",
        [
            {name: "timeout", type: "number"}
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
    
    domainManager.registerCommand(
        DOMAIN,
        "killProcess",
        killProcess,
        false,
        "Kill the compiler process",
        []
    );

    _domainManager = domainManager;
}

exports.init = init;