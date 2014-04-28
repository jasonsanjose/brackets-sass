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
    
    var Compiler            = require("Compiler"),
        SASSAgent           = require("SASSAgent"),
        SourceMapManager    = require("SourceMapManager");
    
    var AppInit             = brackets.getModule("utils/AppInit"),
        CodeInspection      = brackets.getModule("language/CodeInspection"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        FileSystem          = brackets.getModule("filesystem/FileSystem");
    
    // Preview SASS content
    
    // Update source maps for Compiler events: sourceMapCompile and sourceMapPreview
    Compiler.on("sourceMapCompile", function (event, sassFile, sourceMapText, sourceMapFile) {
        // Parse updated source map
        SourceMapManager.setSourceMapContent(sassFile, sourceMapText, sourceMapFile);
    });
    Compiler.on("sourceMapPreview", function (event, sassFile, sourceMapText) {
        // Parse updated source map
        SourceMapManager.setSourceMapPreview(sassFile, sourceMapText);
    });
    
    /**
     * @private
     * CodeInspection callback to provider SASS errors
     * @param {!string} text
     * @param {!path} path
     */
    function _scanFileAsync(text, path) {
        var promise = Compiler.getErrorPromise(path);
        
        // If the promise is resolved, errors were cached when the file was
        // compiled as a partial.
        if (promise.state() === "pending") {
            // FIXME How to avoid calling preview() followed by compile()?
            // CodeInspection runs first firing _scanFileAsync. For now,
            // we just won't show errors when switching to a file that is not dirty
            var sassFile = FileSystem.getFileForPath(path),
                inMemoryDocsPromise = SourceMapManager.getSourceDocuments(sassFile);
            
            inMemoryDocsPromise.then(function (docs) {
                return Compiler.preview(sassFile, docs);
            });
        }
        
        return promise;
    }
    
    function _appReady() {
        CodeInspection.register("scss", {
            name: "SCSS",
            scanFileAsync: _scanFileAsync
        });
    }
    
    // Delay initialization until `appReady` event is fired
    AppInit.appReady(_appReady);
});