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
/*global window, console, define, brackets, $, Mustache*/

define(function (require, exports, module) {
    "use strict";
    
    // Load commonly used modules from Brackets
    var _                   = brackets.getModule("thirdparty/lodash"),
        CodeInspection      = brackets.getModule("language/CodeInspection"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        FileUtils           = brackets.getModule("file/FileUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        NodeDomain          = brackets.getModule("utils/NodeDomain");
    
    // Boilerplate to load NodeDomain
    var _domainPath = ExtensionUtils.getModulePath(module, "node/SASSDomain"),
        _nodeDomain = new NodeDomain("sass", _domainPath);
    
    var RE_FILE_EXT     = /^[^_].*\.scss$/, /* Add .sass later... /^[^_].*\.(sass|scss)$/ */
        PREF_ENABLED    = "enabled",
        PREF_OPTIONS    = "options";

    var extensionPrefs = PreferencesManager.getExtensionPrefs("sass"),
        scannedFileMap = {},
        partialErrorMap = {};
    
    function _render(path, options) {
        var deferred = new $.Deferred();
        
        var renderPromise = _nodeDomain.exec("render",
                 path,
                 options.includePaths,
                 options.imagePath,
                 options.outputStyle,
                 options.sourceComments,
                 options.sourceMap);
        
        renderPromise.then(function (response) {
            deferred.resolve(response.css, response.map);
        }, deferred.reject);
        
        return deferred.promise();
    }

    function _getPreferencesForFile(file) {
        // TODO (issue 7442): path-scoped preferences in extensions
        var prefs = PreferencesManager, /* extensionPrefs */
            enabled = prefs.get("sass." + PREF_ENABLED, file.fullPath),
            options = (enabled && prefs.get("sass." + PREF_OPTIONS, file.fullPath)),
            outputName = (options && options.output) || file.name.replace(RE_FILE_EXT, ".css"),
            outputFile;

        if (!enabled) {
            return false;
        }

        if (outputName) {
            // TODO relative paths in output?
            outputFile = FileSystem.getFileForPath(file.parentPath + outputName);
        }

        options = _.defaults(options || {}, {
            includePaths: [],
            outputStyle: "nested",
            sourceComments: "map",
            sourceMap: outputFile.fullPath + ".map"
        });
        
        return {
            outputCSSFile: outputFile,
            outputSourceMapFile: options.sourceMap && FileSystem.getFileForPath(options.sourceMap),
            options: options
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
            map[doc.file.fullPath] = doc.getText();
        });
        
        return map;
    }
    
    function _finishScan(file, errors) {
        var path = file.fullPath,
            scanDeferred = _deferredForScannedPath(path);

        // Clear cached errors
        partialErrorMap = {};

        var result = {
            errors: [],
            aborted: false
        };

        errors = errors || [];
        errors = Array.isArray(errors) ? errors : [errors];

        _.each(errors, function (err) {
            // Can't report errors on files other than the current document, see CodeInspection
            if (path !== err.path) {
                // Clone error
                var clonedError = _.clone(err);
                clonedError.pos = _.clone(err.pos);

                // HACK libsass errors on partials don't include the file extension!
                clonedError.path += ".scss";

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
    
    function compile(sassFile) {
        var prefs = _getPreferencesForFile(sassFile);
            cssFile = prefs.outputCSSFile,
            hasSourceMap = prefs.sourceComments === "map",
            mapFile = hasSourceMap && prefs.outputSourceMapFile,
            renderPromise;
        
        if (!prefs) {
            return;
        }
        
        renderPromise = _render(sassFile.fullPath, prefs.options);
        
        return renderPromise.then(function (css, map) {
            var eventData = {
                    css: {
                        file: cssFile,
                        contents: css
                    }
                };
            
            FileUtils.writeText(cssFile, css, true);
            
            if (map) {
                // TODO relative paths in sourceMap?
                FileUtils.writeText(mapFile, map, true);
                
                eventData.sourceMap = {
                    file: mapFile,
                    contents: map
                };
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
            options = prefs.options,
            previewPromise,
            inMemoryFiles = _getInMemoryFiles(docs);
        
        if (!prefs) {
            return;
        }
        
        $(exports).triggerHandler("sourceMapPreviewStart", [sassFile, cssFile]);
        
        previewPromise = _nodeDomain.exec("preview",
            sassFile.fullPath,
            inMemoryFiles,
            options.includePaths,
            options.imagePath,
            options.outputStyle,
            "map",
            mapFile.fullPath);
        
        previewPromise.then(function (response) {
            var eventData = {
                css: {
                    file: cssFile,
                    contents: response.css
                },
                sourceMap: {
                    file: mapFile,
                    contents: response.map
                }
            };
            
            $(exports).triggerHandler("sourceMapPreviewEnd", [sassFile, eventData]);
            _finishScan(sassFile);
            
            deferred.resolve(response.css, response.map);
        }, function (errors) {
            $(exports).triggerHandler("sourceMapPreviewError", [sassFile, errors]);
            _finishScan(sassFile, errors);
            
            deferred.reject(errors);
        });
        
        return deferred.promise();
    }

    function deleteTempFiles() {
        return _nodeDomain.exec("deleteTempFiles");
    }
    
    function _fileSystemChange(event, entry, added, removed) {
        if (!entry || !entry.isFile || !entry.name.match(RE_FILE_EXT)) {
            return;
        }
        
        compile(entry);
    }

    function _prefChangeHandler(event) {
        // TODO compile all files?
        // _compileWithPreferences();
    }
    
    // All SASS files get compiled when changed on disk
    // TODO preferences to compile on demand, filter for file paths, etc.?
    FileSystem.on("change", _fileSystemChange);
        
    // FIXME why is change fired during app init?
    // Register preferences
    extensionPrefs.definePreference(PREF_ENABLED, "boolean", true)
        .on("change", _prefChangeHandler);
    
    extensionPrefs.definePreference(PREF_OPTIONS, "object")
        .on("change", _prefChangeHandler);
    
    // Public API
    exports.compile = compile;
    exports.preview = preview;
    exports.deleteTempFiles = deleteTempFiles;
    exports.getErrors = getErrors;
});