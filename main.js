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
        NestedStyleParser   = require("NestedStyleParser"),
        SASSAgent           = require("SASSAgent"),
        SourceMapManager    = require("SourceMapManager");
    
    var _                   = brackets.getModule("thirdparty/lodash"),
        AppInit             = brackets.getModule("utils/AppInit"),
        Async               = brackets.getModule("utils/Async"),
        CSSUtils            = brackets.getModule("language/CSSUtils"),
        CodeInspection      = brackets.getModule("language/CodeInspection"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        FileSystem          = brackets.getModule("filesystem/FileSystem");
    
    // Return pending promises until preview completes
    $(Compiler).on("sourceMapPreviewStart", function (event, sassFile, cssFile) {
        SourceMapManager.setSourceMapPending(cssFile);
    });
    
    // Update source map when preview completes and resolve promise
    $(Compiler).on("sourceMapPreviewEnd", function (event, sassFile, data) {
        SourceMapManager.setSourceMap(sassFile, data.css, data.sass);
    });
    
    // Reject promise waiting for a source map
    $(Compiler).on("sourceMapPreviewError", function (event, sassFile, errors) {
        SourceMapManager.setSourceMap(sassFile);
    });
    
    // Augment CSSUtils.findMatchingRules to support source maps
    var baseFindMatchingRules = CSSUtils.findMatchingRules;
    
    function _convertMatchingRuleResult(selectorCache, generatedResult) {
        // Check CSS text for a sourceMappingURL
        var oneResult = new $.Deferred(),
            cssFile = generatedResult.document.file,
            sourceMapPromise = SourceMapManager.getSourceMap(cssFile),
            match = !sourceMapPromise && SourceMapManager.getSourceMappingURL(generatedResult.document.getText());
        
        if (match) {
            sourceMapPromise = SourceMapManager.setSourceMapFile(cssFile, match);
        }

        if (sourceMapPromise) {
            sourceMapPromise.then(function (sourceMap) {
                // TODO core brackets change to add selectorInfo 
                // generatedPos = { line: info.selectorStartLine + 1, column: info.selectorStartChar },
                var info = generatedResult.selectorInfo,
                    generatedPos = { line: generatedResult.lineStart + 1, column: 0 },
                    origPos = sourceMap.originalPositionFor(generatedPos),
                    newResult;
                
                SourceMapManager.getSourceDocument(cssFile, origPos.source).then(function (doc) {
                    var selectors = selectorCache[doc.file.fullPath],
                        selector,
                        origLine = origPos.line - 1;

                    // HACK? Use CSSUtils to parse SASS selectors
                    if (!selectors) {
                        selectors = NestedStyleParser.extractAllSelectors(doc.getText());
                        selectorCache[doc.file.fullPath] = selectors;
                    }

                    // Find the original SASS selector based on the sourceMap position
                    for (var i = 0; i < selectors.length; i++) {
                        selector = selectors[i];

                        if ((origLine >= selector.ruleStartLine) && (origLine <= selector.selectorEndLine)) {
                            break;
                        } else if (origLine < selector.ruleStartLine) {
                            // HACK We may skip over the actual rule/mixin due to our limited SASS parsing
                            break;
                        }
                    }

                    if (selector) {
                        // CSSUtils can't handle single line '//' comments
                        var name = selector.selector.replace("//.*\n", "");
                        
                        newResult = {
                            name: name,
                            document: doc,
                            lineStart: selector.ruleStartLine,
                            lineEnd: selector.declListEndLine,
                            selectorGroup: selector.selectorGroup
                        };
                    }

                    // Overwrite original result
                    if (newResult) {
                        oneResult.resolve(newResult);
                    } else {
                        oneResult.reject();
                    }
                }, oneResult.reject);
            }, function () {
                // Source map error, use the original result
                oneResult.reject();
            });
        } else {
            // No source map for this result
            oneResult.reject();
        }

        return oneResult.promise();
    }
    
    /**
     * Replace matched CSS rules with SASS rules
     */
    function findMatchingRules(selector, htmlDocument) {
        var basePromise = baseFindMatchingRules(selector, htmlDocument),
            deferred = new $.Deferred(),
            newResults = [],
            selectorCache = {};
        
        // Check CSS file results for an associated source map
        basePromise.then(function (resultSelectors) {
            var parallelPromise = Async.doInParallel(resultSelectors, function (resultSelector, index) {
                var onePromise = _convertMatchingRuleResult(selectorCache, resultSelector);
                
                onePromise.then(function (newResult) {
                    // Use new SASS results
                    newResults[index] = newResult;
                }, function () {
                    // Use original result
                    newResults[index] = resultSelector;
                });
                
                return onePromise;
            });
            
            parallelPromise.always(function () {
                deferred.resolve(newResults);
            });
        }, deferred.reject);
        
        return deferred.promise();
    }
    
    CSSUtils.findMatchingRules = findMatchingRules;
    
    /**
     * @private
     * CodeInspection callback to provider SASS errors
     * @param {!string} text
     * @param {!path} path
     */
    function _scanFileAsync(text, path) {
        var promise = Compiler.getErrors(path);
        
        // If the promise is resolved, errors were cached when the file was
        // compiled as a partial.
        if (promise.state() === "pending") {
            // FIXME How to avoid calling preview() followed by compile()?
            // CodeInspection runs first firing _scanFileAsync. For now,
            // we just won't show errors when switching to a file that is not dirty
            var sassFile = FileSystem.getFileForPath(path);

            // FIXME compile input SASS file (i.e. not partials) with in-memory document content
            // var inMemoryDocsPromise = SourceMapManager.getSourceDocuments(sassFile);
            // inMemoryDocsPromise.then(function (docs) {
            var docs = [DocumentManager.getOpenDocumentForPath(path)];
            Compiler.preview(sassFile, docs);
            //});
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