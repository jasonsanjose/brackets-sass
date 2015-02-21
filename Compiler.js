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
/*jslint nomen:true, vars:true, regexp:true*/
/*global window, console, define, brackets, $, PathUtils*/

define(function (require, exports, module) {
    "use strict";
    
    // Load commonly used modules from Brackets
    var _                   = brackets.getModule("thirdparty/lodash"),
        CodeInspection      = brackets.getModule("language/CodeInspection"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        FileUtils           = brackets.getModule("file/FileUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        NodeDomain          = brackets.getModule("utils/NodeDomain");
    
    // Boilerplate to load NodeDomain
    var _domainPath = ExtensionUtils.getModulePath(module, "node/1.1.4-3/SASSDomain"),
        _nodeDomain = new NodeDomain("sass-v1.1.4-3", _domainPath);
    
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
        PREF_OPTIONS    = "options";

    var extensionPrefs = PreferencesManager.getExtensionPrefs("sass"),
        scannedFileMap = {},
        partialErrorMap = {};

    function _fixSourceMap(json, prefs) {
        var inputFile = prefs.inputFile,
            cssFilePath = prefs.outputCSSFile.fullPath,
            sourceMapFilePath = prefs.outputSourceMapFile.fullPath;

        // Output CSS file should be relative to the source map
        json.file = PathUtils.makePathRelative(cssFilePath, sourceMapFilePath);

        // For some reason, sources are output relative to the CWD
        // Add a sourceRoot to fix
        json.sourceRoot = PathUtils.makePathRelative(inputFile.parentPath, sourceMapFilePath);

        // TODO read tab/space preference?
        return JSON.stringify(json, null, "  ");
    }

    function _makeSourceMapRelativeToOutput(prefs) {
        var sourceMapPath = prefs.outputSourceMapFile.fullPath,
            cssFilePath = prefs.outputCSSFile.fullPath;

        // sourceMap should be relative to the output file
        // This is only used when generating sourceMappingURL
        return PathUtils.makePathRelative(sourceMapPath, cssFilePath);
    }
    
    function _render(path, prefs) {
        var deferred = new $.Deferred(),
            options = prefs.options,
            sourceMap = _makeSourceMapRelativeToOutput(prefs);
        
        var renderPromise = _nodeDomain.exec("render",
                 path,
                 options.includePaths,
                 options.imagePath,
                 options.outputStyle,
                 options.sourceComments,
                 sourceMap,
                 prefs.compiler,
                 prefs.compass);
        
        renderPromise.then(function (response) {
            deferred.resolve(response.css, _fixSourceMap(response.map, prefs));
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
            sourceMap: outputFile.name + ".map"
        });

        // Initialize sourceMap with full path
        options.sourceMap = outputFile.parentPath + options.sourceMap;
        
        return {
            enabled: enabled,
            compiler: compiler,
            compass: compass,
            options: options,
            inputFile: file,
            outputCSSFile: outputFile,
            outputSourceMapFile: FileSystem.getFileForPath(options.sourceMap)
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
            if (typeof err === "string") {
                err = {
                    message: "Runtime error: " + err,
                    pos: {
                        line: -1
                    }
                };
            } else if (path !== err.path) {
                // Can't report errors on files other than the current document, see CodeInspection
                // Clone error
                var clonedError = _.clone(err);
                clonedError.pos = _.clone(err.pos);

                // FIXME determine when to add underscore prefix to partials
                // HACK libsass errors on partials don't include the file extension!
                clonedError.path += sassFileExtension;

                partialErrorMap[clonedError.path] = partialErrorMap[clonedError.path] || [];
                partialErrorMap[clonedError.path].push(clonedError);

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
        _.each(partialErrorMap, function (partialErrors, partialPath) {
            _deferredForScannedPath(partialPath).resolve({
                errors: partialErrors,
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
        
        return renderPromise.then(function (css, map) {
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
                    // TODO relative paths in sourceMap?
                    FileUtils.writeText(mapFile, map, true);
                
                    eventData.sourceMap = {
                        file: mapFile,
                        contents: map
                    };
                });
            }
            
            _finishScan(sassFile);
        }, function (errors) {
            _finishScan(sassFile, errors);
        });
    }
    
    function preview(sassFile, docs) {
        var deferred = new $.Deferred(),
            prefs = _getPreferencesForFile(sassFile),
            cssFile = prefs.outputCSSFile,
            mapFile = prefs.outputSourceMapFile,
            sourceMap = _makeSourceMapRelativeToOutput(prefs),
            options = prefs.options,
            previewPromise,
            inMemoryFiles = _getInMemoryFiles(docs);
        
        $(exports).triggerHandler("sourceMapPreviewStart", [sassFile, cssFile]);
        
        previewPromise = _nodeDomain.exec("preview",
            sassFile.fullPath,
            inMemoryFiles,
            options.includePaths,
            options.imagePath,
            options.outputStyle,
            "map",
            sourceMap,
            prefs.compiler,
            prefs.compass);
        
        previewPromise.then(function (response) {
            var eventData = {
                css: {
                    file: cssFile,
                    contents: response.css
                },
                sourceMap: {
                    file: mapFile,
                    contents: _fixSourceMap(response.map, prefs)
                }
            };
            
            $(exports).triggerHandler("sourceMapPreviewEnd", [sassFile, eventData]);
            _finishScan(sassFile);
            
            deferred.resolve(response.css, response.map);
        }, function (errors) {
            $(exports).triggerHandler("sourceMapPreviewError", [sassFile, cssFile, errors]);
            _finishScan(sassFile, errors);
            
            deferred.reject(errors);
        });
        
        return deferred.promise();
    }

    function deleteTempFiles() {
        return _nodeDomain.exec("deleteTempFiles");
    }

    function _prefChangeHandler(event) {
        // TODO compile all files?
        // _compileWithPreferences();
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

    // Public API
    exports.compile = compile;
    exports.preview = preview;
    exports.deleteTempFiles = deleteTempFiles;
    exports.getErrors = getErrors;
});