Compass-Options
===============

A small Node module for parsing Compass's config.rb file into options for use in Node projects (especially Grunt/Gulp/etc…)

## Installation

```
$ npm install compass-options --save-dev
```

## Usage

Configure your [Compass `config.rb`](http://compass-style.org/help/tutorials/configuration-reference/) file as normal. Currently reads in the following settings with the following defaults:

* `http_path` - `'.'`
* `css_dir` - `'css'`
* `sass_dir` - `'sass'`
* `images_dir` - `'images'`
* `javascripts_dir` - `'js'`
* `fonts_dir` - `'fonts'`



```js
//////////////////////////////
// Get directories from Compass settings
////////////////////////////// 
var dirs = require('compass-options').dirs({
  'config': './config.rb', // Points to config.rb relative to this file. Defaults to './config.rb'
  'trailing': false //  Whether or not to include a trailing slash for directories
});

//////////////////////////////
// Get full paths from Compass settings (http_path + directory)
//////////////////////////////
var paths = require('compass-options').paths({
  'config': './config.rb', // Points to config.rb relative to this file. Defaults to './config.rb'
  'trailing': false //  Whether or not to include a trailing slash for paths
});
```