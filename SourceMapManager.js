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
/*global window, console, define, brackets, $, Mustache, PathUtils*/

define(function (require, exports, module) {
    "use strict";
    
    var SourceMapConsumer   = require("thirdparty/source-map/lib/source-map/source-map-consumer").SourceMapConsumer;
    
    // Load commonly used modules from Brackets
    var _               = brackets.getModule("thirdparty/lodash"),
        Async           = brackets.getModule("utils/Async"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        File            = brackets.getModule("filesystem/File"),
        FileSystem      = brackets.getModule("filesystem/FileSystem"),
        FileUtils       = brackets.getModule("file/FileUtils");
    
    var RE_SOURCE_MAPPING = /\/\*#\s*sourceMappingURL=(.+)\s+\*\//;
    
    function SourceMapManager() {
        this._sourceMapDeferreds = {};
        this._sourceMaps = {};
        this._dependencyMap = {};
    }
    
    /**
     *
     * @param {!File} file
     */
    SourceMapManager.prototype.deleteFile = function (file) {
        delete this._sourceMapDeferreds[file.fullPath];
        delete this._sourceMaps[file.fullPath];
        delete this._dependencyMap[file.fullPath];
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.setSourceMapPending = function (cssFile) {
        var self = this,
            deferred = this._sourceMapDeferreds[cssFile.fullPath];
        
        // Only create a new promise if the existing one was resolved/rejected
        if (!deferred || (deferred.state() !== "pending")) {
            deferred = new $.Deferred();
        }

        deferred.done(function (sourceMap) {
            self._sourceMaps[cssFile.fullPath] = sourceMap;
        });
        
        this._sourceMapDeferreds[cssFile.fullPath] = deferred;
    };
    
    /**
     *
     * @param {!File} cssFile
     * @return {!$.Promise}
     */
    SourceMapManager.prototype.getSourceMap = function (cssFile) {
        return this._sourceMapDeferreds[cssFile.fullPath];
    };
    
    /**
     *
     * @param {!File} cssFile
     * @return {!$.Promise}
     */
    SourceMapManager.prototype.getInputFile = function (cssFile) {
        return this.getSourceMap(cssFile).then(function (sourceMap) {
            return sourceMap.sassFile;
        });
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.getSourceDocuments = function (cssFile) {
        var deferred = new $.Deferred(),
            sourceMapPromise = this.getSourceMap(cssFile),
            docs = [],
            docsPromise;
        
        sourceMapPromise.then(function (sourceMap) {
            // Collect in-memory documents
            docsPromise = Async.doInParallel(sourceMap._localSources, function (file) {
                return DocumentManager.getDocumentForPath(file.fullPath).done(function (doc) {
                    docs.push(doc);
                });
            });
            
            docsPromise.always(function () {
                deferred.resolve(docs);
            });
        }, deferred.reject);
        
        return deferred.promise();
    };
    
    /**
     *
     * @param {!File} cssFile
     * @param {string} relPath
     * @return {$.Promise}
     */
    SourceMapManager.prototype.getSourceDocument = function (cssFile, relPath) {
        return DocumentManager.getDocumentForPath(cssFile.parentPath + relPath);
    };
    
    /**
     *
     * @param {!string} text
     */
    SourceMapManager.prototype.getSourceMappingURL = function (text) {
        var match = text.match(RE_SOURCE_MAPPING);

        if (match) {
            return match[1];
        }

        return null;
    };
    
    /**
     *
     * @param {!File} cssFile
     * @param {!(File|string)} sourceMapFile
     */
    SourceMapManager.prototype.setSourceMapFile = function (cssFile, sourceMapFile) {
        this.setSourceMapPending(cssFile);

        var self = this,
            deferred = new $.Deferred(),
            sourceMapFileResult = new $.Deferred();
        
        if (typeof sourceMapFile === "string") {
            var sourceMapRelPath = sourceMapFile;
            
            // Change relative URLs to absolute
            if (!PathUtils.isAbsoluteUrl(sourceMapRelPath)) {
                sourceMapRelPath = cssFile.parentPath + sourceMapRelPath;
            }
            
            // Resolve to a File
            FileSystem.resolve(sourceMapRelPath, function (err, file) {
                if (err) {
                    sourceMapFileResult.reject(err);
                } else {
                    sourceMapFileResult.resolve(file);
                }
            });
        } else if (sourceMapFile instanceof File) {
            sourceMapFileResult.resolve(sourceMapFile);
        }
        
        sourceMapFileResult.then(function (sourceMapFileResolved) {
            // Read source map from disk
            FileUtils.readAsText(sourceMapFileResolved).then(function (text) {
                // Parse source map text
                var sourceMap = self.setSourceMap(cssFile, sourceMapFileResolved, text);
                deferred.resolve(sourceMap);
            }, deferred.reject);
        }, deferred.reject);
        
        return deferred.promise();
    };
    
    /**
     *
     * @param {!File} cssFile
     * @param {!File} mapFile
     * @param {!string} mapText
     * @param {?File} sassFile
     */
    SourceMapManager.prototype.setSourceMap = function (cssFile, mapFile, mapText, sassFile) {
        this.setSourceMapPending(cssFile);

        var self = this,
            deferred = this._sourceMapDeferreds[cssFile.fullPath],
            sourceMap,
            localSources = [],
            error;
        
        // Try to parse source map contents
        try {
            sourceMap = mapText && new SourceMapConsumer(mapText);
        } catch (err) {
            error = err;
        }
        
        if (!sourceMap) {
            // Resolve with previous source map if available
            var prevSourceMap = this._sourceMaps[cssFile.fullPath];

            if (prevSourceMap) {
                deferred.resolve(prevSourceMap);
            } else {
                // Reject the promise if we fail to parse the source map
                deferred.reject(error);
            }
            
            return;
        }
        
        // We always generate in-memory source maps to support editor features
        // even when a user specifies that source maps should not be saved to
        // disk. If a sourceMapFile is not provided, assume localSources paths
        // are relative to the input cssFile.
        var parentPath = (mapFile || cssFile).parentPath;

        sourceMap.sources.forEach(function (source) {
            // Gather the source document(s) that generated this CSS file
            var localSourceFile = FileSystem.getFileForPath(parentPath + source),
                dependencies = self._dependencyMap[localSourceFile.fullPath] || {};
            
            localSources.push(localSourceFile);
            
            // Map each source as a dependency for the input cssFile
            self._dependencyMap[localSourceFile.fullPath] = dependencies;
            self._dependencyMap[localSourceFile.fullPath][cssFile.fullPath] = {
                cssFile: cssFile,
                sourceMap: sourceMap
            };
        });
        
        // Set input SASS document
        sourceMap.sassFile = sassFile || localSources[0];

        // Swap generated file relative paths with local absolute paths
        sourceMap._localSources = localSources;

        if (!sourceMap.file && mapFile) {
            sourceMap.file = mapFile.name.slice(0, -4);
        }

        // Set the output document (e.g. cmd line: sass input.scss output.css)
        sourceMap.cssFile = cssFile || FileSystem.getFileForPath(sourceMap._mapFile.parentPath + sourceMap.file);
        
        // Resolve getSourceMap promise
        deferred.resolve(sourceMap);
        
        return sourceMap;
    };
    
    /**
     * 
     * @param {!File} sassFile
     * @return {Object.<string,{{cssFile: File, sourceMap: SourceMapConsumer}}>}
     */
    SourceMapManager.prototype.getUsageForFile = function (sassFile) {
        return this._dependencyMap[sassFile.fullPath] || {};
    };
    
    return new SourceMapManager();
});
