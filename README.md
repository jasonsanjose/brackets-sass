brackets-sass
===========================

Compiles *.scss/*.sass files when changed. Updates styles during Live Preview.

## Compatibility

This extension uses [libsass](http://github.com/sass/libsass) instead of the Ruby-based `sass` compiler. For details on compatibility with the latest Sass features and popular Sass frameworks, [see the wiki](http://github.com/jasonsanjose/brackets-sass/wiki#compatibility).

## Features

* Compiles `*.sass` and `*.scss` files when changed and when any partial (`@import` dependency) is changed
* Generates source maps
* Show SASS compiler errors
* Update CSS in Brackets' Live Preview 

## Future Plans

* Compile keyboard shortcut (instead of waiting for file changes)
* Selector highlighting
* Option to swap `libsass` for Ruby `sass` compiler implementation
* Compass support

## Preferences

These options are passed through to [node-sass](https://github.com/andrew/node-sass).

Reference: [Sample project using Bourbon](https://github.com/jasonsanjose/bourbon-example) and `.brackets.json` preferences file.

### sass.enabled
Enable/Disable SASS compilation for a file. Default: `true`

### sass.options
Derived from [node-sass](https://github.com/andrew/node-sass) README.

### outputDir
`outputDir` is a `String` relative file path (relative to the input file) to output both the CSS file and the source map.
Default: `<input file parent directory>`.

### output
`output` is a `String` relative file path (relative to the input file, or relative to `outputDir`) for the output CSS file.
Default: `<filename>.css`.

#### includePaths
`includePaths` is an `Array` of path `String`s to look for any `@import`ed files. It is recommended that you use this option if you are using the `data` option and have **any** `@import` directives, as otherwise [libsass] may not find your depended-on files.
Default: `[<empty>]`

#### imagePath
`imagePath` is a `String` that represents the public image path. When using the `image-url()` function in a stylesheet, this path will be prepended to the path you supply. eg. Given an `imagePath` of `/path/to/images`, `background-image: image-url('image.png')` will compile to `background-image: url("/path/to/images/image.png")`
Default: `null`

#### outputStyle
`outputStyle` is a `String` to determine how the final CSS should be rendered. Its value should be one of `'nested'` or `'compressed'`.
[`'expanded'` and `'compact'` are not currently supported by [libsass]]
Default: `nested`

#### sourceComments
`sourceComments` is a `String` to determine what debug information is included in the output file. Its value should be one of `'none', 'normal', 'map'`. The default is `'map'`.
The `map` option will create the source map file in your CSS destination.
[Important: `souceComments` is only supported when using the `file` option, and does nothing when using `data` flag.]
Default: `map`

#### sourceMap
If your `sourceComments` option is set to `map`, `sourceMap` allows setting a new path context for the referenced Sass files.
The source map describes a path relative to your your `output` CSS file location. In most occasions this will work out-of-the-box but, in some cases, you may need to set a different output.
Default: `<filename>.css.map`.

### Sample .brackets.json File

```
/*
Resulting file tree will appear as follows:
+ bower_components
|--- bourbon/dist/_bourbon.scss
+ css
|--- app.css
|--- app.css.map
+ scss
|--- app.scss
*/

/* REMOVE comments from json file before using this template */
{
    "path": {
        /* default options */
        "scss/app.scss": {
            "sass.enabled": true,
            "sass.options": {
                "outputDir": "../css/",
                "includePaths": [],
                "imagePath": null,
                "sourceComments": "map",
                "outputStyle": "nested"
            }
        },
        /* disable compiling @import files in this project */
        "scss/imports/*.scss": {
            "sass.enabled": false
        }
    }
}
```
