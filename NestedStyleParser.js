/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
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
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true */
/*global brackets, define, $, _parseRuleList: true */

// JSLint Note: _parseRuleList() is cyclical dependency, not a global function.
// It was added to this list to prevent JSLint warning about being used before being defined.

/**
 * Set of utilities for simple parsing of CSS text.
 */
define(function (require, exports, module) {
    "use strict";
    
    var CodeMirror = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");

    /**
     * Extracts all CSS selectors from the given text
     * Returns an array of selectors. Each selector is an object with the following properties:
         selector:                 the text of the selector (note: comma separated selector groups like 
                                   "h1, h2" are broken into separate selectors)
         ruleStartLine:            line in the text where the rule (including preceding comment) appears
         ruleStartChar:            column in the line where the rule (including preceding comment) starts
         selectorStartLine:        line in the text where the selector appears
         selectorStartChar:        column in the line where the selector starts
         selectorEndLine:          line where the selector ends
         selectorEndChar:          column where the selector ends
         selectorGroupStartLine:   line where the comma-separated selector group (e.g. .foo, .bar, .baz)
                                   starts that this selector (e.g. .baz) is part of. Particularly relevant for
                                   groups that are on multiple lines.
         selectorGroupStartChar:   column in line where the selector group starts.
         selectorGroup:            the entire selector group containing this selector, or undefined if there 
                                   is only one selector in the rule.
         declListStartLine:        line where the declaration list for the rule starts
         declListStartChar:        column in line where the declaration list for the rule starts
         declListEndLine:          line where the declaration list for the rule ends
         declListEndChar:          column in the line where the declaration list for the rule ends
     * @param text {!string} CSS text to extract from
     * @return {Array.<Object>} Array with objects specifying selectors.
     */
    function extractAllSelectors(text) {
        var selectors = [];
        var mode = CodeMirror.getMode({indentUnit: 2}, "sass");
        var state, lines, lineCount;
        var token, style, stream, line;
        var currentSelector = "";
        var ruleStartChar = -1, ruleStartLine = -1;
        var selectorStartChar = -1, selectorStartLine = -1;
        var selectorGroupStartLine = -1, selectorGroupStartChar = -1;
        var declListStartLine = -1, declListStartChar = -1;
        var escapePattern = new RegExp("\\\\[^\\\\]+", "g");
        var validationPattern = new RegExp("\\\\([a-f0-9]{6}|[a-f0-9]{4}(\\s|\\\\|$)|[a-f0-9]{2}(\\s|\\\\|$)|.)", "i");
        
        // implement _firstToken()/_nextToken() methods to
        // provide a single stream of tokens
        
        function _hasStream() {
            while (stream.eol()) {
                line++;
                if (line >= lineCount) {
                    return false;
                }
                if (currentSelector.match(/\S/)) {
                    // If we are in a current selector and starting a newline,
                    // make sure there is whitespace in the selector
                    currentSelector += " ";
                }
                stream = new CodeMirror.StringStream(lines[line]);
            }
            return true;
        }
        
        function _firstToken() {
            state = CodeMirror.startState(mode);
            lines = CodeMirror.splitLines(text);
            lineCount = lines.length;
            if (lineCount === 0) {
                return false;
            }
            line = 0;
            stream = new CodeMirror.StringStream(lines[line]);
            if (!_hasStream()) {
                return false;
            }
            style = mode.token(stream, state);
            token = stream.current();
            return true;
        }
        
        function _nextToken() {
            // advance the stream past this token
            stream.start = stream.pos;
            if (!_hasStream()) {
                return false;
            }
            style = mode.token(stream, state);
            token = stream.current();
            return true;
        }
        
        function _firstTokenSkippingWhitespace() {
            if (!_firstToken()) {
                return false;
            }
            while (!token.match(/\S/)) {
                if (!_nextToken()) {
                    return false;
                }
            }
            return true;
        }
        
        function _nextTokenSkippingWhitespace() {
            if (!_nextToken()) {
                return false;
            }
            while (!token.match(/\S/)) {
                if (!_nextToken()) {
                    return false;
                }
            }
            return true;
        }

        function _isStartComment() {
            return (token.match(/^\/\*/));
        }

        function _isStartSingleLineComment() {
            return (token.match(/^\/\//));
        }
        
        function _parseComment() {
            while (!token.match(/\*\/$/)) {
                if (!_nextToken()) {
                    break;
                }
            }
        }

        function _nextTokenSkippingComments() {
            var isMultiLine = _isStartComment(),
                isSingleLine = _isStartSingleLineComment();

            if (!_nextToken()) {
                return false;
            }
            while (isSingleLine || isMultiLine) {
                if (isMultiLine) {
                    _parseComment();
                }/* else {
                    stream.skipToEnd();
                }*/
                if (!_nextToken()) {
                    return false;
                }

                isMultiLine = _isStartComment();
                isSingleLine = _isStartSingleLineComment();
            }
            return true;
        }

        function _parseSelector(start) {
            
            currentSelector = "";
            selectorStartChar = start;
            selectorStartLine = line;
            
            // Everything until the next ',' or '{' is part of the current selector
            while (token !== "," && token !== "{") {
                currentSelector += token;
                if (!_nextTokenSkippingComments()) {
                    return false; // eof
                }
            }
            
            // Unicode character replacement as defined in http://www.w3.org/TR/CSS21/syndata.html#characters
            if (/\\/.test(currentSelector)) {
                // Double replace in case of pattern overlapping (regex improvement?)
                currentSelector = currentSelector.replace(escapePattern, function (escapedToken) {
                    return escapedToken.replace(validationPattern, function (unicodeChar) {
                        unicodeChar = unicodeChar.substr(1);
                        if (unicodeChar.length === 1) {
                            return unicodeChar;
                        } else {
                            if (parseInt(unicodeChar, 16) < 0x10FFFF) {
                                return String.fromCharCode(parseInt(unicodeChar, 16));
                            } else { return String.fromCharCode(0xFFFD); }
                        }
                    });
                });
            }
            
            currentSelector = currentSelector.trim();
            var startChar = (selectorGroupStartLine === -1) ? selectorStartChar : selectorStartChar + 1;
            var selectorStart = (stream.string.indexOf(currentSelector, selectorStartChar) !== -1) ? stream.string.indexOf(currentSelector, selectorStartChar - currentSelector.length) : startChar;

            if (currentSelector !== "") {
                selectors.push({selector: currentSelector,
                                ruleStartLine: ruleStartLine,
                                ruleStartChar: ruleStartChar,
                                selectorStartLine: selectorStartLine,
                                selectorStartChar: selectorStart,
                                declListEndLine: -1,
                                selectorEndLine: line,
                                selectorEndChar: selectorStart + currentSelector.length,
                                selectorGroupStartLine: selectorGroupStartLine,
                                selectorGroupStartChar: selectorGroupStartChar
                               });
                currentSelector = "";
            }
            selectorStartChar = -1;

            return true;
        }
        
        function _parseSelectorList() {
            selectorGroupStartLine = (stream.string.indexOf(",") !== -1) ? line : -1;
            selectorGroupStartChar = stream.start;

            if (!_parseSelector(stream.start)) {
                return false;
            }

            while (token === ",") {
                if (!_nextTokenSkippingComments()) {
                    return false; // eof
                }
                if (!_parseSelector(stream.start)) {
                    return false;
                }
            }

            return true;
        }

        function _parseDeclarationList() {

            var j;
            declListStartLine = Math.min(line, lineCount - 1);
            declListStartChar = stream.start;
            
            // Extract the entire selector group we just saw.
            var selectorGroup, sgLine;
            if (selectorGroupStartLine !== -1) {
                selectorGroup = "";
                for (sgLine = selectorGroupStartLine; sgLine <= declListStartLine; sgLine++) {
                    var startChar = 0, endChar = lines[sgLine].length;
                    if (sgLine === selectorGroupStartLine) {
                        startChar = selectorGroupStartChar;
                    } else {
                        selectorGroup += " "; // replace the newline with a single space
                    }
                    if (sgLine === declListStartLine) {
                        endChar = declListStartChar;
                    }
                    selectorGroup += lines[sgLine].substring(startChar, endChar);
                }
                selectorGroup = selectorGroup.trim();
            }

            // Since we're now in a declaration list, that means we also finished
            // parsing the whole selector group. Therefore, reset selectorGroupStartLine
            // so that next time we parse a selector we know it's a new group
            selectorGroupStartLine = -1;
            selectorGroupStartChar = -1;
            ruleStartLine = -1;
            ruleStartChar = -1;

            // Skip everything until the next '}'
            while (token !== "}") {
                if (!_nextTokenSkippingComments()) {
                    break;
                }
            }
            
            // TODO support nested rules and parent selector "&"
            // assign this declaration list position and selector group to every selector on the stack
            // that doesn't have a declaration list start and end line
            for (j = selectors.length - 1; j >= 0; j--) {
                if (selectors[j].declListEndLine !== -1) {
                    break;
                } else {
                    selectors[j].declListStartLine = declListStartLine;
                    selectors[j].declListStartChar = declListStartChar;
                    selectors[j].declListEndLine = line;
                    selectors[j].declListEndChar = stream.pos - 1; // stream.pos actually points to the char after the }
                    if (selectorGroup) {
                        selectors[j].selectorGroup = selectorGroup;
                    }
                }
            }
        }
        
        function includeCommentInNextRule() {
            if (ruleStartChar !== -1) {
                return false;       // already included
            }
            if (stream.start > 0 && lines[line].substr(0, stream.start).indexOf("}") !== -1) {
                return false;       // on same line as '}', so it's for previous rule
            }
            return true;
        }
        
        function _isStartAtRule() {
            return (token.match(/^@/));
        }
        
        function _parseAtRule() {

            // reset these fields to ignore comments preceding @rules
            ruleStartLine = -1;
            ruleStartChar = -1;
            selectorStartLine = -1;
            selectorStartChar = -1;
            selectorGroupStartLine = -1;
            selectorGroupStartChar = -1;
            
            if (token.match(/@media/i)) {
                // @media rule holds a rule list
                
                // Skip everything until the opening '{'
                while (token !== "{") {
                    if (!_nextTokenSkippingComments()) {
                        return; // eof
                    }
                }

                // skip past '{', to next non-ws token
                if (!_nextTokenSkippingWhitespace()) {
                    return; // eof
                }

                // Parse rules until we see '}'
                _parseRuleList("}");

            } else if (token.match(/@(charset|import|namespace)/i)) {
                
                // This code handles @rules in this format:
                //   @rule ... ;
                // Skip everything until the next ';'
                while (token !== ";") {
                    if (!_nextTokenSkippingComments()) {
                        return; // eof
                    }
                }
                
            } else {
                // This code handle @rules that use this format:
                //    @rule ... { ... }
                // such as @page, @keyframes (also -webkit-keyframes, etc.), and @font-face.
                // Skip everything until the next '}'
                while (token !== "}") {
                    if (!_nextTokenSkippingComments()) {
                        return; // eof
                    }
                }
            }
        }

        // parse a style rule
        function _parseRule() {
            if (!_parseSelectorList()) {
                return false;
            }

            _parseDeclarationList();
        }
        
        function _parseRuleList(escapeToken) {
            
            while ((!escapeToken) || token !== escapeToken) {
                if (_isStartAtRule()) {
                    // @rule
                    _parseAtRule();
    
                } else if (_isStartComment()) {
                    // comment - make this part of style rule
                    if (includeCommentInNextRule()) {
                        ruleStartChar = stream.start;
                        ruleStartLine = line;
                    }
                    _parseComment();
                
                } else if (_isStartSingleLineComment()) {
                    // comment - make this part of style rule
                    if (includeCommentInNextRule()) {
                        ruleStartChar = stream.start;
                        ruleStartLine = line;
                    }
                } else {
                    // Otherwise, it's style rule
                    if (ruleStartChar === -1) {
                        ruleStartChar = stream.start;
                        ruleStartLine = line;
                    }
                    _parseRule();
                }
                
                if (!_nextTokenSkippingWhitespace()) {
                    break;
                }
            }
        }
        
        // Do parsing

        if (_firstTokenSkippingWhitespace()) {

            // Style sheet is a rule list
            _parseRuleList();
        }

        return selectors;
    }
    
    exports.extractAllSelectors = extractAllSelectors;
});
