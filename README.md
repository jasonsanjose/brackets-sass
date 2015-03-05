brackets-sass
===========================

Compiles \*.scss/\*.sass files when changed. Updates styles during Live Preview. Demo video: http://youtu.be/gYE7jybP_5Y.

## Compiler Compatibility

By default, this extension uses [libsass](http://github.com/sass/libsass) [3.1](https://github.com/sass/libsass/releases/tag/3.1.0). The Ruby-based `sass` compiler is also supported, see `sass.compiler` [preference](#sasscompiler). For details on compatibility with the latest Sass features and popular Sass frameworks, [see the wiki](http://github.com/jasonsanjose/brackets-sass/wiki/Compatibility).

## Features

* Compiles `*.sass` (indented syntax) and `*.scss` (main syntax) files when changed and when any partial (`@import` dependency) is changed
* Generates source maps
* Show SASS compiler errors
* Update CSS in Brackets' Live Preview 
* Option to swap libsass for Ruby sass compiler implementation
* __Experimental__ Compass support

## Future Plans

* Selector highlighting

## Preferences

### sass.enabled
Type: `Boolean`
Default: `true`

Enable/Disable compilation for a file.

### sass.compiler
Type: `String`
Default: `libsass`
Values: `libsass`, `ruby`

Choose which compiler to use. `libsass` is used by default and is bundled with the extension, no extra install is necessary. Use `ruby` if you need full compatilibity with 3.4 (learn more about [libsass compatibility](https://github.com/sass/libsass/wiki/The-LibSass-Compatibility-Plan). Using the `ruby` options requires [separate installation](http://sass-lang.com/install).

### sass.compass
Type: `Boolean`
Default: `false`

__EXPERIMENTAL__ Enable/Disable [Compass](http://compass-style.org/) for a file. Requires `"sass.compiler": "ruby"` and [Compass installation](http://compass-style.org/install/). Some Compass features will require a `config.rb` file at your project root.

As of the 2.0.x release, Compass support is experimental. Compiler workflows in Brackets are supported, e.g.:

* Compiling on save
* Compiler errors
* Compiling when a partial changes
* Source map output

Note that __Live Preview is NOT supported yet__. See [example project](https://github.com/jasonsanjose/compass-example) for usage.

### sass.options

#### outputDir
Type: `String`
Default: `<parent directory of input sass file>`

A relative file path (relative to the input file) to output both the CSS file and the source map.

#### output
Type: `String`
Default: `<input sass file name>.css`

File name to use for the output CSS file.

#### includePaths
Type: `Array<String>`
Default: `[]`

An array of paths to use when resolving `@import` declarations (a.k.a `--load-path`, see [Sass documentation](http://sass-lang.com/documentation/file.SASS_REFERENCE.html#load_paths-option))

#### outputStyle
Type: `String`
Default: `nested`
Values: `nested`, `compressed`

Determines the output format of the final CSS style. (`'expanded'` and `'compact'` are not currently supported by [libsass], but are planned in a future version.)

#### sourceComments
Type: `Boolean`
Default: `false`

`true` enables additional debugging information in the output file as CSS comments

#### sourceMap
Type: `Boolean | String | undefined`
Default: `true` (implies `<input sass file name>`.css.map)

Outputs a source map. When `sourceMap === true`, the values for `outputDir` and `output` are used as the target output location for the source map. When `typeof sourceMap === "String"`, the value of `sourceMap` will be used as the writing location for the file.

## Sample .brackets.json File

Reference: [Sample project using Bourbon](https://github.com/jasonsanjose/bourbon-example) and `.brackets.json` preferences file.

```
/*
Resulting file tree will appear as follows:
+ bower_components/
|--- bourbon/app/assets/stylesheets/_bourbon.scss
+ css/
|--- app.css
|--- app.css.map
+ scss/
|--- app.scss
*/

/* REMOVE comments from json file before using this template */
{
    /* disable compiling other files that aren't the "main" file */
    "sass.enabled": false,
    "path": {
        "scss/app.scss": {
            "sass.enabled": true,
            "sass.options": {
                "outputDir": "../css/",
                "includePaths": [],
                "sourceComments": true,
                "outputStyle": "nested"
            }
        }
    }
}
```
