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

/*global module, require*/
module.exports = function (grunt) {
    'use strict';

    // Load dependencies
    require('load-grunt-tasks')(grunt, {pattern: ['grunt-contrib-*']});
    
    // Load optional requirejs config, see http://requirejs.org/docs/api.html#config
    var rjsconfig = grunt.file.readJSON("requirejs-config.json");
    
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        jshint: {
            all: ['**/*.js', '!**/node_modules/**', '!dist/**']
        },
        clean: {
            dist: {
                files: [{
                    dot: true,
                    src: ['dist']
                }]
            }
        },
        /* Non-JavaScript files to include in the build */
        copy: {
            dist: {
                files: [
                    {
                        expand: true,
                        dest: 'dist/',
                        src: [
                            'package.json',
                            /* Remove this line when not using Node */
                            'node/**',
                            /* Remove this line when not using CSS */
                            'styles/**'
                        ]
                    }
                ]
            }
        },
        requirejs: {
            dist: {
                // Options: https://github.com/jrburke/r.js/blob/master/build/example.build.js
                options: {
                    name: 'main',
                    paths: rjsconfig.paths,
                    shim: rjsconfig.shim,
                    optimize: 'uglify2',
                    out: 'dist/main.js',
                    generateSourceMaps: true,
                    useSourceUrl: true,
                    preserveLicenseComments: false,
                    useStrict: true,
                    wrap: false,
                    uglify2: {}
                }
            }
        },
        compress: {
            dist: {
                options: {
                    archive: "<%= pkg.name %>.zip"
                },
                cwd: 'dist/',
                src: ['**/*'],
                dest: '<%= pkg.name %>'
            }
        }
    });

    grunt.registerTask('build', [
        'jshint',
        'requirejs',
        'copy',
        'compress'
    ]);

    // Default task
    grunt.registerTask('default', ['clean', 'build']);
};