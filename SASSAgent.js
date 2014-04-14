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
    var _               = brackets.getModule("thirdparty/lodash"),
        AppInit         = brackets.getModule("utils/AppInit"),
        CommandManager  = brackets.getModule("command/CommandManager"),
        ExtensionUtils  = brackets.getModule("utils/ExtensionUtils"),
        FileUtils       = brackets.getModule("file/FileUtils"),
        FileSystem      = brackets.getModule("filesystem/FileSystem"),
        Menus           = brackets.getModule("command/Menus"),
        NodeDomain      = brackets.getModule("utils/NodeDomain");
    
    // Boilerplate to load NodeDomain
    var _domainPath = ExtensionUtils.getModulePath(module, "node/SASSDomain"),
        _nodeDomain = new NodeDomain("sass", _domainPath);
    
    var FILE_EXT_RE     = /\.(sass|scss)$/;
    
    // Function to run when the menu item is clicked
//    function handleHelloWorldCommand() {
//        // Call helloWorld command in our NodeDomain (node/TemplateDomain.js)
//        _nodeDomain.exec("helloWorld", "Brackets Extension Template").done(function (retVal) {
//            window.alert(retVal);
//        }).fail(function () {
//            console.error("FAIL");
//        });
//    }
    
//    function _htmlReady() {
//        // Inject stylesheet
//        ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
//    }
    
    function _fileSystemChange(event, entry, added, removed) {
        if (!entry || !entry.isFile || !entry.name.match(FILE_EXT_RE)) {
            return;
        }
        
        // file, data, includePaths, imagePaths, outputStyle, sourceComments, sourceMap
        var renderPromise = _nodeDomain.exec("render", entry.fullPath, null, [entry.parentPath], null, null, null, "map");
        
        renderPromise.then(function (css) {
            console.log(css);
        }, function (err) {
            console.error(err);
        });
    }
    
    function _appReady() {
        // All sass/scss files get compiled when changed on disk
        // TODO preferences to compile on demand, filter for file paths, etc.?
        FileSystem.on("change", _fileSystemChange);
    }
    
    // Load CSS stylesheet after `htmlReady` event is fired
//    AppInit.htmlReady(_htmlReady);
    
    // Delay initialization until `appReady` event is fired
    AppInit.appReady(_appReady);
});
