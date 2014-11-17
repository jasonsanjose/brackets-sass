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

    // load dependencies
    require("load-grunt-tasks")(grunt);
    
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        jshint: {
            all: ['**/*.js', '!**/node_modules/**', '!dist/**', '!thirdparty/**']
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
            debug: {
                files: [
                    {
                        expand: true,
                        dest: 'dist/',
                        src: [
                            'package.json',
                            '**/*.js',
                            '!node_modules/**',
                            'node/**',
                            '!node/node_modules/node-sass/build/**',
                            '!node/node_modules/node-sass/test/**'
                        ]
                    }
                ]
            },
            dist: {
                files: [
                    {
                        expand: true,
                        dest: 'dist/',
                        src: [
                            'package.json',
                            'node/*/render.js',
                            'node/*/SASSDomain.js',
                            '!node/*/node_modules/node-sass-binaries/**',
                            'node/*/node_modules/fs-extra/**',
                            'node/*/node_modules/node-sass/{package.json,sass.js,binding.gyp}',
                            'node/*/node_modules/node-sass/bin/**',
                            'node/*/node_modules/node-sass/node_modules/object-assign/**'
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
                    archive: "<%= pkg.name %>.<%= pkg.version %>.zip"
                },
                expand: true,
                cwd: 'dist/',
                src: ['**/*'],
                dest: '<%= pkg.name %>'
            }
        }
    });

    grunt.registerTask("build-version", function () {
        grunt.task.requires("gitinfo");

        var packageJSON = grunt.config("pkg"),
            version = packageJSON.version,
            gitinfo = grunt.config("gitinfo");

        // Add SHA
        version = version + "-" + gitinfo.local.branch.current.lastCommitNumber;

        packageJSON.version = version;
        grunt.config("pkg", packageJSON);

        grunt.file.write("dist/package.json", JSON.stringify(packageJSON, null, "  "));
    });

    grunt.registerTask('build', [
        'jshint',
        'requirejs',
        'copy:dist',
        'gitinfo',
        'build-version',
        'compress'
    ]);

    grunt.registerTask('debug', [
        'clean',
        'copy:debug',
        'gitinfo',
        'build-version',
        'compress'
    ]);

    // Default task
    grunt.registerTask('default', ['clean', 'build']);
};
