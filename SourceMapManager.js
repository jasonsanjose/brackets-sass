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
        this._sourceMaps = {};
        this._sourceMapPreviews = {};
        this._dependencyMap = {};
    }
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.deleteSourceMap = function (cssFile) {
        this.deleteSourceMapPreview(cssFile);
        delete this._sourceMaps[cssFile.fullPath];
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.deleteSourceMapPreview = function (cssFile) {
        delete this._sourceMapPreviews[cssFile.fullPath];
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.getSourceMap = function (cssFile) {
        var preview = this._sourceMapPreviews[cssFile.fullPath];
        
        if (preview) {
            return preview;
        }
        
        return this._sourceMaps[cssFile.fullPath];
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.getSourceDocuments = function (cssFile) {
        var deferred = new $.Deferred(),
            sourceMap = this.getSourceMap(cssFile),
            docs = [],
            docsPromise;
        
        if (!sourceMap) {
            deferred.reject();
            return deferred.promise();
        }
        
        // Collect in-memory documents
        docsPromise = Async.doInParallel(sourceMap._localSources, function (file) {
            return DocumentManager.getDocumentForPath(file.fullPath).done(function (doc) {
                docs.push(doc);
            });
        });
        
        docsPromise.always(function () {
            deferred.resolve(docs);
        });
        
        return deferred.promise();
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.getSourceMappingURL = function (cssFile) {
        var deferred = new $.Deferred();
        
        FileUtils.readAsText(cssFile).then(function (text) {
            var match = text.match(RE_SOURCE_MAPPING);

            if (match) {
                deferred.resolve(match[1]);
            } else {
                deferred.reject();
            }
        });
        
        return deferred.promise();
    };
    
    /**
     *
     * @param {!File} cssFile
     * @param {!(File|string)} sourceMapFile
     */
    SourceMapManager.prototype.setSourceMapFile = function (cssFile, sourceMapFile) {
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
            FileSystem.resolve(sourceMapRelPath).then(sourceMapFileResult.resolve, sourceMapFileResult.reject);
        } else if (sourceMapFile instanceof File) {
            sourceMapFileResult.resolve(sourceMapFile);
        }
        
        sourceMapFileResult.then(function (sourceMapFileResolved) {
            // Read source map from disk
            FileUtils.readAsText(sourceMapFileResolved).then(function (text) {
                // Parse source map text
                var sourceMap = self.setSourceMapContent(cssFile, sourceMapFileResolved, text);
                deferred.resolve(sourceMap);
            }, deferred.reject);
        }, deferred.reject);
        
        return deferred.promise();
    };
    
    /**
     *
     * @param {!File} cssFile
     * @param {!string} sourceMapText
     * @param {?File} sourceMapFile
     */
    SourceMapManager.prototype.setSourceMapContent = function (cssFile, sourceMapText, sourceMapFile, isPreview) {
        var self = this,
            sourceMap = new SourceMapConsumer(sourceMapText),
            localSources = [];
        
        // We always generate in-memory source maps to support editor features
        // even when a user specifies that source maps should not be saved to
        // disk. If a sourceMapFile is not provided, assume localSources paths
        // are relative to the input cssFile.
        var parentPath = (sourceMapFile || cssFile).parentPath;

        sourceMap.sources.forEach(function (source) {
            // Gather the source document(s) that generated this CSS file
            var localSourceFile = FileSystem.getFileForPath(parentPath + source);
            localSources.push(localSourceFile);
            
            // Map each source as a dependency for the input cssFile
            self._dependencyMap[localSourceFile.fullPath] = self._dependencyMap[localSourceFile.fullPath] || [];
            self._dependencyMap[localSourceFile.fullPath].push(cssFile);
        });

        // Swap generated file relative paths with local absolute paths
        sourceMap._localSources = localSources;

        if (!sourceMap.file && sourceMapFile) {
            sourceMap.file = sourceMapFile.name.slice(0, -4);
        }

        // Set the output document (e.g. cmd line: sass input.scss output.css)
        sourceMap._outputFile = FileSystem.getFileForPath(sourceMap._mapFile.parentPath + sourceMap.file);
        
        // Cache source map
        if (isPreview) {
            this._sourceMaps[cssFile.fullPath] = sourceMap;
        } else {
            this._sourceMapPreviews[cssFile.fullPath] = sourceMap;
        }
        
        return sourceMap;
    };
    
    SourceMapManager.prototype.setSourceMapPreview = function (cssFile, sourceMapText, sourceMapFile) {
        this.setSourceMapContent(cssFile, sourceMapText, sourceMapFile, true);
    };
    
    /**
     *
     * @param {!File} cssFile
     */
    SourceMapManager.prototype.getUsageForFile = function (cssFile) {
        return this._dependencyMap[cssFile.fullPath] || [];
    };
    
    return new SourceMapManager();
});
