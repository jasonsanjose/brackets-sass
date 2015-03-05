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
    
    var Compiler            = require("Compiler"),
        SourceMapManager    = require("SourceMapManager");
    
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
    
    function _setStatus(status, err) {
        // HACK expose LiveDevelopment._setStatus()
        LiveDevelopment.status = status;
        window.$(LiveDevelopment).triggerHandler("statusChange", [status, err]);
    }
    
    function _docChangeHandler(data) {
        // Show out of sync while we wait for SASS to compile
        _setStatus(LiveDevelopment.STATUS_OUT_OF_SYNC);

        var sourceMapPromise = SourceMapManager.getSourceMap(data.cssFile);

        sourceMapPromise.then(function (sourceMap) {
            return Compiler.preview(sourceMap.sassFile, data.docs).then(function (css) {
                Inspector.CSS.setStyleSheetText(data.header.styleSheetId, css);
                
                // TODO look for added/removed docs?
                // FIXME This will clobber other status (e.g. HTML live preview)
                _setStatus(LiveDevelopment.STATUS_ACTIVE);
            });
        }, function (err) {
            // TODO show errors in gutter
            console.log(err);

            _setStatus(LiveDevelopment.STATUS_SYNC_ERROR);
        });
    }
    
    function _installSourceDocumentChangeHandlers(cssFile, sourceURL, header) {
        var docs = [],
            sourceMapPromise = SourceMapManager.getSourceMap(cssFile),
            docsPromise;

        docsPromise = sourceMapPromise.then(function (sourceMap) {
            return Async.doInParallel(sourceMap._localSources, function (file) {
                return DocumentManager.getDocumentForPath(file.fullPath).done(function (doc) {
                    docs.push(doc);
                });
            });
        });
        
        // Install change event handlers for source SCSS/SASS files
        docsPromise.always(function () {
            var data = {
                cssFile: cssFile,
                header: header,
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
            var cssPath = server.urlToPath(sourceURL),
                cssFile = cssPath && FileSystem.getFileForPath(cssPath),
                sourceMapURL = sourceURL.replace(new RegExp(PathUtils.parseUrl(sourceURL).filename + "$"), header.sourceMapURL),
                sourceMapPath = server.urlToPath(sourceMapURL),
                sourceMapFile = sourceMapPath && FileSystem.getFileForPath(sourceMapPath);
            
            SourceMapManager.setSourceMapFile(cssFile, sourceMapFile);
            _installSourceDocumentChangeHandlers(cssFile, sourceURL, header);
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
