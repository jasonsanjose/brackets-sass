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
/*global window, console, define, brackets, $, Mustache, PathUtils*/

define(function (require, exports, module) {
    "use strict";
    
    var Compiler            = require("main"),
        SourceMapConsumer   = require("thirdparty/source-map/lib/source-map/source-map-consumer").SourceMapConsumer;
    
    // Load commonly used modules from Brackets
    var _               = brackets.getModule("thirdparty/lodash"),
        Async           = brackets.getModule("utils/Async"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        FileSystem      = brackets.getModule("filesystem/FileSystem"),
        FileUtils       = brackets.getModule("file/FileUtils"),
        Inspector       = brackets.getModule("LiveDevelopment/Inspector/Inspector"),
        LiveDevelopment = brackets.getModule("LiveDevelopment/LiveDevelopment");
    
    var server,
        mapSourceURLs = {};
    
    var previewDebounce = _.debounce(function (root, inMemoryFiles) {
        Compiler.preview(root, inMemoryFiles);
    }, 500);
    
    function _parseSourceMap(sourceMapURL, sourceMapFile, text) {
        var parseURL = PathUtils.parseUrl(sourceMapURL);

        var sourceMap = new SourceMapConsumer(text),
            localSources = [];
        
        sourceMap._url = sourceMapURL;
        sourceMap._mapFile = sourceMapFile;

        sourceMap.sources.forEach(function (source) {
            // Gather the source document(s) that generated this CSS file
            localSources.push(FileSystem.getFileForPath(sourceMap._mapFile.parentPath + source));
        });

        // Swap generated file relative paths with local absolute paths
        sourceMap._localSources = localSources;

        // If the generated file name is missing, assume the source-map file name and drop the .map extension
        if (!sourceMap.file) {
            sourceMap.file = sourceMap._mapFile.name.slice(0, -4);
        }

        // Set the output document (e.g. cmd line: sass input.scss output.css)
        sourceMap._outputFile = FileSystem.getFileForPath(sourceMap._mapFile.parentPath + sourceMap.file);
        
        return sourceMap;
    }
    
    function _getSourceMap(sourceMapURL) {
        var sourceMapDeferred = new $.Deferred(),
            sourceMapPath = server.urlToPath(sourceMapURL),
            sourceMapFile;

        if (!sourceMapPath) {
            return sourceMapDeferred.resolve().promise();
        }

        sourceMapFile = FileSystem.getFileForPath(sourceMapPath);

        FileUtils.readAsText(sourceMapFile).then(function (contents) {
            sourceMapDeferred.resolve(_parseSourceMap(sourceMapURL, sourceMapFile, contents));
        }, sourceMapDeferred.reject);

        return sourceMapDeferred.promise();
    }
    
    function _getInMemoryFiles(docs) {
        var map = {};
        
        _.each(docs, function (doc) {
            map[doc.file.fullPath] = doc.getText();
        });
        
        return map;
    }

    function _setStatus(status, err) {
        // HACK expose LiveDevelopment._setStatus()
        LiveDevelopment.status = status;
        window.$(LiveDevelopment).triggerHandler("statusChange", [status, err]);
    }
    
    function _docChangeHandler(data) {
        var inMemoryFiles = _getInMemoryFiles(data.docs);

        // Show out of sync while we wait for SASS to compile
        _setStatus(LiveDevelopment.STATUS_OUT_OF_SYNC);
        
        Compiler.preview(data.sourceMap._localSources[0], inMemoryFiles).then(function (css, mapText) {
            Inspector.CSS.setStyleSheetText(data.header.styleSheetId, css);
            
            // FIXME This will clobber other status (e.g. HTML live preview)
            _setStatus(LiveDevelopment.STATUS_ACTIVE);
            
            // TODO look for added/removed docs?
            // update SourceMap
            data.sourceMap = _parseSourceMap(data.sourceMap._url, data.sourceMap._mapFile, mapText);
        }, function (err) {
            console.error(err);

            _setStatus(LiveDevelopment.STATUS_SYNC_ERROR);
        });
    }
    
    function _installSourceDocumentChangeHandlers(sourceURL, header, sourceMap) {
        var docs = [],
            docsPromise;
        
        docsPromise = Async.doInParallel(sourceMap._localSources, function (file) {
            return DocumentManager.getDocumentForPath(file.fullPath).done(function (doc) {
                docs.push(doc);
            });
        });
        
        // Install change event handlers for source SCSS/SASS files
        docsPromise.always(function () {
            var data = {
                header: header,
                sourceMap: sourceMap,
                docs: docs
            };

            var changeCallback = function (event, doc, res) {
                _docChangeHandler(data);
            };
            
            _.each(docs, function (doc) {
                doc.addRef();
                $(doc).on("change.sass", changeCallback);
            });
            
            mapSourceURLs[sourceURL] = data;
        });
    }
    
    function _styleSheetAdded(event, sourceURL, header) {
        var existing = mapSourceURLs[sourceURL];
        
        // detect duplicates
        if (existing && existing.styleSheetId === header.styleSheetId) {
            return;
        }
        
        if (header.sourceMapURL) {
            var sourceMapURL = sourceURL.replace(new RegExp(PathUtils.parseUrl(sourceURL).filename + "$"), header.sourceMapURL);
            
            _getSourceMap(sourceMapURL).done(function (sourceMap) {
                _installSourceDocumentChangeHandlers(sourceURL, header, sourceMap);
            });
        }
    }
    
    function _styleSheetRemoved(event, sourceURL) {
        var data = mapSourceURLs[sourceURL];
        
        delete mapSourceURLs[sourceURL];
        
        if (!data) {
            return;
        }
        
        _.each(data.docs, function (doc) {
            doc.releaseRef();
            $(doc).off(".sass");
        });
    }
    
    function _statusChangeHandler(event, status, reason) {
        var $CSSAgent = $(LiveDevelopment.agents.css);
        
        if (status <= LiveDevelopment.STATUS_INACTIVE) {
            $CSSAgent.off(".sass");
            
            _.each(Object.keys(mapSourceURLs), function (sourceURL) {
                _styleSheetRemoved(null, sourceURL);
            });

            Compiler.deleteTempFiles();
            
            server = null;
        } else if (!server) {
            $CSSAgent.on("styleSheetAdded.sass", _styleSheetAdded);
            $CSSAgent.on("styleSheetRemoved.sass", _styleSheetRemoved);
            
            server = LiveDevelopment._getServer();
        }
    }
    
    $(LiveDevelopment).on("statusChange", _statusChangeHandler);
});
