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
/*jslint nomen:true, vars:true, regexp:true, plusplus: true*/
/*global window, console, define, brackets, $, Mustache*/

define(function (require, exports, module) {
    "use strict";
    
    var Compiler          = require("Compiler"),
        NestedStyleParser = require("NestedStyleParser"),
        SASSAgent         = require("SASSAgent"),
        SourceMapManager  = require("SourceMapManager");
    
    var _                 = brackets.getModule("thirdparty/lodash"),
        AppInit           = brackets.getModule("utils/AppInit"),
        Async             = brackets.getModule("utils/Async"),
        CSSUtils          = brackets.getModule("language/CSSUtils"),
        CodeInspection    = brackets.getModule("language/CodeInspection"),
        DocumentManager   = brackets.getModule("document/DocumentManager"),
        ExtensionManager  = brackets.getModule("extensibility/ExtensionManager"),
        FileUtils         = brackets.getModule("file/FileUtils"),
        FileSystem        = brackets.getModule("filesystem/FileSystem"),
        ProjectManager    = brackets.getModule("project/ProjectManager");

    // Distinguish input SASS files from partials
    var RE_INPUT_FILE = /^[^_].*\.(scss|sass)$/,
        RE_PARTIAL_FILE = /^_.*\.(scss|sass)$/;
    
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
                    var fullPath = doc.file.fullPath,
                        selectors = selectorCache[fullPath],
                        fileExt = FileUtils.getFileExtension(fullPath),
                        docText = doc.getText(),
                        selector,
                        origLine = origPos.line - 1,
                        i;

                    // HACK? Use CSSUtils to parse SCSS selectors
                    if (!selectors) {
                        if (fileExt === "scss") {
                            selectors = NestedStyleParser.extractAllSelectors(docText);
                        } else {
                            // TODO support SASS
                            // selectors = IndentedStyleParser.extractAllSelectors(docText);
                            selectors = [];
                        }

                        selectorCache[doc.file.fullPath] = selectors;
                    }

                    // Find the original SASS selector based on the sourceMap position
                    for (i = 0; i < selectors.length; i++) {
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
    
    // TODO Reconcile this with new quick edit support for SCSS/LESS in Brackets 44
    //      Can still provide value for SASS indented syntax
    // CSSUtils.findMatchingRules = findMatchingRules;
    
    /**
     * @private
     * CodeInspection callback to provider SASS errors
     * @param {!string} text
     * @param {!path} path
     */
    function _scanFileAsync(text, path) {
        // FIXME How to avoid calling preview() followed by compile()?
        // CodeInspection runs first firing _scanFileAsync. For now,
        // we just won't show errors when switching to a file that is not dirty
        var fileToScan = FileSystem.getFileForPath(path),
            usages = SourceMapManager.getUsageForFile(fileToScan),
            docs,
            inputFile = fileToScan,
            deferred = new $.Deferred(),
            usagePromise;
        
        if (_.size(usages) > 0) {
            _.find(usages, function (usage) {
                // Compile input SASS file (i.e. not partials) with in-memory document content
                usagePromise = SourceMapManager.getSourceDocuments(usage.cssFile);
                usagePromise.then(function (sourceDocs) {
                    docs = sourceDocs;
                    inputFile = usage.sourceMap.sassFile;
                });
                
                // Compile first usage only
                // FIXME support multiple usage?
                return true;
            });
        } else {
            docs = [];
            usagePromise = new $.Deferred().resolve().promise();
        }
        
        usagePromise.always(function () {
            var errorPromise = Compiler.getErrors(path);
            
            // If the promise is resolved, errors were cached when the file was
            // compiled as a partial.
            if (errorPromise.state() === "pending") {
                docs.unshift(DocumentManager.getOpenDocumentForPath(path));
                Compiler.preview(inputFile, docs);
            }
            
            errorPromise.done(function (result) {
                deferred.resolve(result);
            });
        });
        
        return deferred.promise();
    }

    function _scanForSourceMaps() {
        // Get all .css.map files
        var promise = ProjectManager.getAllFiles(function (file) {
            return file.name.match(/\.css\.map$/i) !== null;
        });

        // Convert .css.map paths to .css output paths
        promise = promise.then(function (sourceMapFiles) {
            return sourceMapFiles.map(function (sourceMapFile) {
                // Get associated CSS file by dropping ".map"
                return {
                    sourceMapFile: sourceMapFile,
                    cssFilePath: sourceMapFile.fullPath.replace(/\.map$/i, "")
                };
            });
        });

        // Resolve css file paths to Files
        var resolvedPairs = [];
        promise = promise.then(function (pairs) {
            return Async.doInParallel(pairs, function (pair) {
                var deferred = new $.Deferred();

                FileSystem.resolve(pair.cssFilePath, function (err, cssFile) {
                    if (err) {
                        deferred.reject();
                    } else {
                        pair.cssFile = cssFile;
                        resolvedPairs.push(pair);
                        deferred.resolve();
                    }
                });

                return deferred.promise();
            });
        });

        // Read .css file sourceMappingURL
        promise.always(function () {
            resolvedPairs.forEach(function (pair) {
                var sourceMapFile = pair.sourceMapFile,
                    cssFile = pair.cssFile;

                FileUtils.readAsText(cssFile).done(function (cssText) {
                    var sourceMapRelPath = SourceMapManager.getSourceMappingURL(cssText),
                        regExp = new RegExp(sourceMapRelPath + "$");

                    // Confirm CSS sourceMappingURL matches the source map path
                    if (!sourceMapRelPath || !regExp.exec(sourceMapFile.fullPath)) {
                        return;
                    }

                    SourceMapManager.setSourceMapFile(cssFile, sourceMapFile);
                });
            });
        });
    }

    function _isSassFile(entry, regexp) {
        var isFile = entry && entry.isFile && entry.name.match(regexp);

        return isFile && ProjectManager.isWithinProject(entry);
    }

    function _isSassFileInput(entry) {
        return _isSassFile(entry, RE_INPUT_FILE);
    }

    function _isSassFilePartial(entry) {
        return _isSassFile(entry, RE_PARTIAL_FILE);
    }

    // Check if this file is referenced in one or more source maps
    function _getUsageForFile(sassFile) {
        var usages = SourceMapManager.getUsageForFile(sassFile),
            inputFiles = [];

        _.each(usages, function (usage) {
            inputFiles.push(usage.sourceMap.sassFile);
        });

        return inputFiles;
    }
    
    function _appReady() {
        CodeInspection.register("scss", {
            name: "SCSS",
            scanFileAsync: _scanFileAsync
        });

        CodeInspection.register("sass", {
            name: "SASS",
            scanFileAsync: _scanFileAsync
        });
    }

    $(ProjectManager).on("projectOpen", function (event, root) {
        // TODO Reset SourceMapManager when project changes

        // Scan for source maps in the new project
        _scanForSourceMaps();
    });
    
    // Return pending promises until preview completes
    $(Compiler).on("sourceMapPreviewStart", function (event, sassFile, cssFile) {
        if (_isSassFileInput(sassFile)) {
            SourceMapManager.setSourceMapPending(cssFile);
        }
    });
    
    // Update source map when preview completes and resolve promise
    $(Compiler).on("sourceMapPreviewEnd", function (event, sassFile, data) {
        if (_isSassFileInput(sassFile)) {
            SourceMapManager.setSourceMap(data.css.file, data.sourceMap.file, data.sourceMap.contents);
        }
    });
    
    // Reject promise waiting for a source map
    $(Compiler).on("sourceMapPreviewError", function (event, sassFile, cssFile, errors) {
        if (_isSassFileInput(sassFile)) {
            SourceMapManager.setSourceMap(cssFile);
        }
    });
    
    // All SASS files get compiled when changed on disk
    // TODO preferences to compile on demand, filter for file paths, etc.?
    FileSystem.on("change", function (event, entry, added, removed) {
        var filesToCompile = [],
            findUsage = [];

        if (entry) {
            if (_isSassFileInput(entry)) {
                // Compile a changed input file
                filesToCompile.push(entry);
                findUsage.push(entry);
            } else if (_isSassFilePartial(entry)) {
                // Check for usage of a partial file
                findUsage.push(entry);
            }
        }

        if (removed) {
            removed.forEach(function (removedFile) {
                // Find usages of partial files
                if (_isSassFilePartial(removedFile)) {
                    findUsage.push(removedFile);
                }

                // Clear caches
                SourceMapManager.deleteFile(removedFile);
            });
        }

        // Compile new input files (but not partials)
        if (added) {
            added.forEach(function (addedFile) {
                if (_isSassFileInput(addedFile)) {
                    filesToCompile.push(addedFile);
                }
            });
        }

        // Add input files that reference deleted/changed files
        findUsage.forEach(function (sassFile) {
            filesToCompile = filesToCompile.concat(_getUsageForFile(sassFile));
        });
        
        // Re-compile
        _.each(_.uniq(filesToCompile), function (entry) {
            Compiler.compile(entry);
        });
    });
    
    ExtensionManager.on("statusChange", function (event, extensionId) {
        if (extensionId === "jasonsanjose.brackets-sass" && (ExtensionManager.isMarkedForUpdate(extensionId) || ExtensionManager.isMarkedForRemoval(extensionId))) {
            Compiler.killProcess();
        }
    });

    // Delay initialization until `appReady` event is fired
    AppInit.appReady(_appReady);
});