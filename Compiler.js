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
 */
/*jslint nomen:true, vars:true, regexp:true, plusplus:true*/
/*global window, console, define, brackets, $, PathUtils*/

define(function (require, exports, module) {
    "use strict";
    
    var StatusBarUtil = require("StatusBarUtil");
    
    // Load commonly used modules from Brackets
    var _                   = brackets.getModule("thirdparty/lodash"),
        CodeInspection      = brackets.getModule("language/CodeInspection"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        FileUtils           = brackets.getModule("file/FileUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        NodeDomain          = brackets.getModule("utils/NodeDomain"),
        ProjectManager      = brackets.getModule("project/ProjectManager");
    
    // Boilerplate to load NodeDomain
    var _domainPath = ExtensionUtils.getModulePath(module, "node/2.0.3/SASSDomain"),
        _nodeDomain = new NodeDomain("sass-v2.0.3", _domainPath);
    
    // Initialize temp folder on windows only
    // This is to normalize windows paths instead of using Node's os.tmpdir()
    // which usually resolves to C:\Users\name~1\..., getApplicationSupportDirectory
    // will resolve to C:\Users\name_000 instead which is more compatible
    // with Brackets' FileSystem paths
    if (brackets.platform === "win") {
        _nodeDomain.exec("setTempDir", brackets.app.getApplicationSupportDirectory()).fail(function (err) {
            console.error("Failed creating brackets-sass temporary directory: " + err);
        });
    }
    
    var RE_FILE_EXT     = /\.(sass|scss)$/,
        PREF_ENABLED    = "enabled",
        PREF_COMPILER   = "compiler",
        PREF_COMPASS    = "compass",
        PREF_TIMEOUT    = "timeout",
        PREF_OPTIONS    = "options";

    var extensionPrefs = PreferencesManager.getExtensionPrefs("sass"),
        scannedFileMap = {},
        partialErrorMap = {};

    // Normalize a path (e.g. a/b/../c becomes a/c)
    function _normalizePath(path) {
        var up = 0,
            i,
            parts = path.split("/").filter(function (part, index) {
                return !!part;
            });

        for (i = parts.length - 1; i >= 0; i--) {
            var last = parts[i];
            if (last === ".") {
                parts.splice(i, 1);
            } else if (last === "..") {
                parts.splice(i, 1);
                up++;
            } else if (up) {
                parts.splice(i, 1);
                up--;
            }
        }
        while (up--) {
            parts.unshift("..");
        }

        return parts.join("/");
    }

    function _fixSourceMapPaths(json, css, prefs) {
        var inputFile = prefs.inputFile,
            cssFilePath = prefs.outputCSSFile.fullPath,
            sourceMapFilePath = prefs.outputSourceMapFile.fullPath;

        // Replace backslashes in paths
        json.sources = json.sources.map(function (source) {
            return source.replace(/\\/g, "/");
        });

        // Output CSS file should be relative to the source map
        if (typeof prefs.options.sourceMap === "string") {
            json.file = PathUtils.makePathRelative(cssFilePath, sourceMapFilePath);

            if (prefs.compiler === "ruby") {
                var sourcesPrefix = PathUtils.makePathRelative(PathUtils.directory(cssFilePath), PathUtils.directory(sourceMapFilePath)),
                    mapPrefix = PathUtils.makePathRelative(PathUtils.directory(sourceMapFilePath), PathUtils.directory(cssFilePath));

                json.sources = json.sources.map(function (source) {
                    return _normalizePath(sourcesPrefix + source);
                });

                css = css.replace(/\/\*# sourceMappingURL=(.*?) \*\//, function (_, url) {
                    return "/*# sourceMappingUrl=" + _normalizePath(mapPrefix + url) + " */";
                });
            }
        }

        // For some reason, sources are output relative to the CWD
        // Add a sourceRoot to fix
        // json.sourceRoot = PathUtils.makePathRelative(inputFile.parentPath, sourceMapFilePath);

        // TODO read tab/space preference?
        return {
            map: JSON.stringify(json, null, "  "),
            css: css
        };
    }
    
    function _render(path, prefs) {
        var deferred = new $.Deferred(),
            options = prefs.options;
        
        var renderPromise = _nodeDomain.exec("render",
            path,
            prefs.outputCSSFile.fullPath,
            options.includePaths,
            options.imagePath,
            options.outputStyle,
            options.sourceComments,
            prefs.outputSourceMapFile.fullPath,
            prefs.compiler,
            prefs.compass);

        renderPromise.then(function (response) {
            var result = _fixSourceMapPaths(response.map, response.css, prefs);
            deferred.resolve(result.css, result.map, response.error, response._compassOutFile);
        }, deferred.reject);
        
        return deferred.promise();
    }

    function _getPreferencesForFile(file) {
        var prefs = extensionPrefs,
            enabled = prefs.get(PREF_ENABLED, { path: file.fullPath }),
            compiler = prefs.get(PREF_COMPILER, { path: file.fullPath }) || "libsass",
            compass = !!prefs.get(PREF_COMPASS, { path: file.fullPath }),
            options = prefs.get(PREF_OPTIONS, { path: file.fullPath }),
            outputName = (options && options.output) || file.name.replace(RE_FILE_EXT, ".css"),
            outputDir = (options && options.outputDir),
            parentPath = file.parentPath,
            sourceMapPath,
            outputFile;

        if (outputDir) {
            if (outputDir.charAt(outputDir.length - 1) !== "/") {
                outputDir = outputDir + "/";
            }

            if (FileSystem.isAbsolutePath(outputDir)) {
                parentPath = outputDir;
            } else {
                parentPath = FileSystem.getDirectoryForPath(parentPath + outputDir).fullPath;
            }
        }

        outputFile = FileSystem.getFileForPath(parentPath + outputName);

        options = _.defaults(options || {}, {
            outputStyle: "nested",
            sourceComments: true,
            sourceMap: true
        });

        // Initialize sourceMap with full path
        if (typeof options.sourceMap === "string") {
            options.sourceMap = outputFile.parentPath + options.sourceMap;
            sourceMapPath = options.sourceMap;
        } else {
            sourceMapPath = outputFile.parentPath + outputFile.name + ".map";
        }
        
        return {
            enabled: enabled,
            compiler: compiler,
            compass: compass ? { projectRoot: ProjectManager.getProjectRoot().fullPath } : false,
            options: options,
            inputFile: file,
            outputCSSFile: outputFile,
            outputSourceMapFile: FileSystem.getFileForPath(sourceMapPath)
        };
    }
    
    function _deferredForScannedPath(path, doAbort) {
        var deferred = scannedFileMap[path];
        
        if (deferred && doAbort) {
            // Abort current scan
            deferred.resolve({
                errors: [],
                aborted: true
            });

            deferred = null;
        }
        
        if (!deferred) {
            deferred = new $.Deferred();
            scannedFileMap[path] = deferred;
        }
        
        return deferred;
    }
    
    function getErrors(path) {
        return _deferredForScannedPath(path, true).promise();
    }
    
    function _getInMemoryFiles(docs) {
        var map = {};
        
        _.each(docs, function (doc) {
            if (doc.isDirty) {
                map[doc.file.fullPath] = doc.getText();
            }
        });
        
        return map;
    }
    
    function _finishScan(file, errors) {
        var path = file.fullPath,
            prefs = _getPreferencesForFile(file),
            sassFileExtension = FileUtils.getFileExtension(path),
            scanDeferred = _deferredForScannedPath(path);

        // Clear cached errors
        partialErrorMap = {};

        var result = {
            errors: [],
            aborted: false
        };

        errors = errors || [];
        errors = Array.isArray(errors) ? errors : [errors];

        if (prefs.compiler !== "ruby" && prefs.compass) {
            result.errors.push({
                message: "Libsass doesn't support Compass yet: something may not work. You should use the Ruby Sass compiler.",
                pos: {
                    line: undefined
                }
            });
        }

        _.each(errors, function (err) {
            if (err && err.path) {
                err.path = FileUtils.convertWindowsPathToUnixPath(err.path);
            }
            
            if (typeof err === "string") {
                err = {
                    message: err,
                    pos: {
                        line: -1
                    }
                };
            } else if (path !== err.path) {
                // Can't report errors on files other than the current document, see CodeInspection
                // Clone error
                var clonedError = _.clone(err);
                clonedError.pos = _.clone(err.pos);

                partialErrorMap[err.path] = partialErrorMap[err.path] || [];
                partialErrorMap[err.path].push(clonedError);

                // Omit position if the file path doesn't match
                err.pos.line = undefined;

                // HACK Add path to error message
                err.message = err.path + " - " + err.message;
            }

            err.type = CodeInspection.Type.ERROR;
            result.errors.push(err);
        });

        scanDeferred.resolve(result);

        // Resolve promises for partials
        _.each(scannedFileMap, function (deferred, partialPath) {
            // Only deal with pending files
            if (deferred.state() !== "pending") {
                return;
            }
            
            deferred.resolve({
                errors: partialErrorMap[partialPath] || [],
                aborted: false
            });
        });
    }
    
    function _mkdirp(path) {
        return _nodeDomain.exec("mkdirp", path);
    }
    
    function compile(sassFile) {
        var prefs = _getPreferencesForFile(sassFile);

        if (!prefs.enabled) {
            return new $.Deferred().reject().promise();
        }

        var cssFile = prefs.outputCSSFile,
            mapFile = prefs.outputSourceMapFile,
            renderPromise;
        
        renderPromise = _render(sassFile.fullPath, prefs);
        
        StatusBarUtil.showBusyStatus("Compiling " + PathUtils.makePathRelative(sassFile.fullPath, ProjectManager.getProjectRoot().fullPath));
        
        return renderPromise.then(function (css, map, error, _compassOutFile) {
            // HACK deal with compass output
            if (_compassOutFile) {
                _compassOutFile = FileUtils.convertWindowsPathToUnixPath(_compassOutFile);
                cssFile = FileSystem.getFileForPath(_compassOutFile);
                mapFile = FileSystem.getFileForPath(_compassOutFile + ".map");
            }

            var eventData = {
                    css: {
                        file: cssFile,
                        contents: css
                    }
                };
            
            _mkdirp(cssFile.parentPath).done(function () {
                FileUtils.writeText(cssFile, css, true);
            });
            
            if (map) {
                _mkdirp(mapFile.parentPath).done(function () {
                    FileUtils.writeText(mapFile, map, true);
                
                    eventData.sourceMap = {
                        file: mapFile,
                        contents: map
                    };
                });
            }
            
            _finishScan(sassFile, error);
        }, function (errors) {
            _finishScan(sassFile, errors);
        }).always(function () {
            StatusBarUtil.hideBusyStatus();
        });
    }
    
    function preview(sassFile, docs) {
        var deferred = new $.Deferred(),
            prefs = _getPreferencesForFile(sassFile);
        
        // TODO warnings for compass that live preview isn't supported yet
        // TODO support compiler errors with compass
        // Requires changes to config.rb?
        if (prefs.compass) {
            _finishScan(sassFile, []);
            return deferred.resolve().promise();
        }
        
        var cssFile = prefs.outputCSSFile,
            mapFile = prefs.outputSourceMapFile,
            options = prefs.options,
            previewPromise,
            inMemoryFiles = _getInMemoryFiles(docs),
            compass = prefs.compass;
        
        $(exports).triggerHandler("sourceMapPreviewStart", [sassFile, cssFile]);
        
        previewPromise = _nodeDomain.exec("preview",
            sassFile.fullPath,
            prefs.outputCSSFile.fullPath,
            inMemoryFiles,
            options.includePaths,
            options.imagePath,
            options.outputStyle,
            "map",
            prefs.outputSourceMapFile.fullPath,
            prefs.compiler,
            prefs.compass);
        
        StatusBarUtil.showBusyStatus("Checking for errors");
        
        previewPromise.then(function (response) {
            var result = _fixSourceMapPaths(response.map, response.css, prefs),
                eventData = {
                    css: {
                        file: cssFile,
                        contents: result.css
                    },
                    sourceMap: {
                        file: mapFile,
                        contents: result.json
                    }
                };

            $(exports).triggerHandler("sourceMapPreviewEnd", [sassFile, eventData]);
            _finishScan(sassFile, response.error);
            
            deferred.resolve(response.css, response.map);
        }, function (errors) {
            $(exports).triggerHandler("sourceMapPreviewError", [sassFile, cssFile, errors]);
            _finishScan(sassFile, errors);
            
            deferred.reject(errors);
        }).always(function () {
            StatusBarUtil.hideBusyStatus();
        });
        
        return deferred.promise();
    }

    function deleteTempFiles() {
        return _nodeDomain.exec("deleteTempFiles");
    }

    function _prefChangeHandler(event) {
        // TODO compile all files?
        // _compileWithPreferences();
        _nodeDomain.exec("setCompilerTimeout", extensionPrefs.get(PREF_TIMEOUT));
    }

    function killProcess() {
        _nodeDomain.exec("killProcess");
    }
     
    // Register preferences
    extensionPrefs.definePreference(PREF_ENABLED, "boolean", true)
        .on("change", _prefChangeHandler);
    
    extensionPrefs.definePreference(PREF_OPTIONS, "object")
        .on("change", _prefChangeHandler);
    
    extensionPrefs.definePreference(PREF_COMPILER, "string", "libsass")
        .on("change", _prefChangeHandler);

    extensionPrefs.definePreference(PREF_COMPASS, "boolean", false)
        .on("change", _prefChangeHandler);

    extensionPrefs.definePreference(PREF_TIMEOUT, "number", -1)
        .on("change", _prefChangeHandler);
    
    _prefChangeHandler();

    // Public API
    exports.compile = compile;
    exports.preview = preview;
    exports.deleteTempFiles = deleteTempFiles;
    exports.getErrors = getErrors;
    exports.killProcess = killProcess;
});