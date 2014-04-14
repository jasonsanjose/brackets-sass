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
/*jslint nomen:true, vars:true*/
/*global window, console, define, brackets, $, Mustache*/

define(function (require, exports, module) {
    "use strict";
    
    // Load commonly used modules from Brackets
    var _                   = brackets.getModule("thirdparty/lodash"),
        AppInit             = brackets.getModule("utils/AppInit"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        FileUtils           = brackets.getModule("file/FileUtils"),
        FileSystem          = brackets.getModule("filesystem/FileSystem"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager"),
        NodeDomain          = brackets.getModule("utils/NodeDomain");
    
    // Boilerplate to load NodeDomain
    var _domainPath = ExtensionUtils.getModulePath(module, "node/SASSDomain"),
        _nodeDomain = new NodeDomain("sass", _domainPath);
    
    var FILE_EXT_RE     = /\.(sass|scss)$/,
        PREF_ENABLED    = "enabled",
        PREF_OPTIONS    = "options";

    var prefs = PreferencesManager.getExtensionPrefs("sass");
    
    function _render(path, data, options) {
        var deferred = new $.Deferred(),
            outputCSSPath = path.replace(FILE_EXT_RE, ".css"),
            outputMapFile = FileSystem.getFileForPath(outputCSSPath + ".map");
        
        options = _.defaults(options || {}, {
            includePaths: [],
            outputStyle: "nested",
            sourceComments: "map",
            sourceMap: outputMapFile
        });
        
        var renderPromise = _nodeDomain.exec("render",
                 path,
                 data,
                 options.includePaths,
                 options.imagePath,
                 options.outputStyle,
                 options.sourceComments,
                 outputMapFile.fullPath);
        
        renderPromise.then(function (response) {
            deferred.resolve(response.css, response.map);
        }, deferred.reject);
        
        return deferred.promise();
    }

    function _getPreferencesForFile(file) {
        var doc = DocumentManager.getCurrentDocument(),
            inputFile = (file || (doc && doc.file)) || null,
            isSASSFile = (file && file.isFile) && file.name.match(FILE_EXT_RE),
            fullPath = inputFile && inputFile.fullPath;

        if (!isSASSFile) {
            return;
        }

        // TODO (issue 7442): path-scoped preferences in extensions
        var prefs = PreferencesManager;

        var enabled = (fullPath && prefs.get("sass." + PREF_ENABLED, fullPath)),
            options = (enabled && prefs.get("sass." + PREF_OPTIONS, fullPath)),
            output = (options && options.output) || null;

        if (!enabled) {
            return;
        }

        if (output) {
            // TODO relative paths in output?
            output = FileSystem.getFileForPath(inputFile.parentPath + output);
        }

        var options = _.defaults(options || {}, {
            output: output.fullPath,
            sourceMap: outputMapPath
        });
    }
    
    function renderData(text, options) {
        return _render(null, text, options);
    }

    function renderPath(path, options) {
        return _render(path, null, options);
    }
    
    function compile(inputFile, outputFile, options) {
        outputFile = outputFile || FileSystem.getFileForPath(inputFile.fullPath.replace(FILE_EXT_RE, ".css"));
        
        var outputMapPath = outputFile.fullPath + ".map",
            renderPromise;
        
        options = _.defaults(options || {}, {
            sourceMap: outputMapPath
        });
        
        renderPromise = renderPath(inputFile.fullPath, options);
        
        return renderPromise.then(function (css, map) {
            FileUtils.writeText(outputFile, css, true);
            
            if (map) {
                var mapFile = FileSystem.getFileForPath(options.sourceMap);
                FileUtils.writeText(mapFile, map, true);
            }
        }, function (err) {
            // TODO display errors in panel?
            console.error(err);
        });
    }

    function _compileWithPreferences(file) {
        var doc = DocumentManager.getCurrentDocument(),
            inputFile = (file || (doc && doc.file)) || null,
            isSASSFile = (file && file.isFile) && file.name.match(FILE_EXT_RE),
            fullPath = inputFile && inputFile.fullPath;

        if (!isSASSFile) {
            return;
        }

        // TODO (issue 7442): path-scoped preferences in extensions
        var prefs = PreferencesManager;

        var enabled = (fullPath && prefs.get("sass." + PREF_ENABLED, fullPath)),
            options = (enabled && prefs.get("sass." + PREF_OPTIONS, fullPath)),
            output = (options && options.output) || null;

        if (!enabled) {
            return;
        }

        if (output) {
            // TODO relative paths in output?
            output = FileSystem.getFileForPath(inputFile.parentPath + output);
        }

        compile(inputFile, output, options);
    }
    
    function _fileSystemChange(event, entry, added, removed) {
        if (!entry || !entry.isFile) {
            return;
        }
        
        // TODO preferences
        // whitelist files to compile
        // node-sass options includePaths, imagePath, outputStyle, sourceComments, sourceMap
        _compileWithPreferences(entry);
    }

    function _prefChangeHandler(event) {
        _compileWithPreferences();
    }
    
    function _appReady() {
        // All sass/scss files get compiled when changed on disk
        // TODO preferences to compile on demand, filter for file paths, etc.?
        FileSystem.on("change", _fileSystemChange);
    }

    // FIXME why is change fired during app init?
    // Register preferences
    prefs.definePreference(PREF_ENABLED, "boolean", true)
        .on("change", _prefChangeHandler);
    
    prefs.definePreference(PREF_OPTIONS, "object")
        .on("change", _prefChangeHandler);
    
    // Delay initialization until `appReady` event is fired
    AppInit.appReady(_appReady);
    
    exports.renderPath = renderPath;
    exports.renderData = renderData;
    exports.compile = compile;
});