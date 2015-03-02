var iniparser = require('iniparser');
var fs = require('fs');

var dirs = function (options) {
  var config = options && options.config ? options.config : './config.rb';
  var trailing = options && options.trailing ? options.trailing : false;
  var userSettings = {};
  if (fs.existsSync(config)) {
    userSettings = iniparser.parseSync(config)
  }
  else {
    userSettings = {
      'http_path': '.',
      'css_dir': 'css',
      'sass_dir': 'sass',
      'images_dir': 'images',
      'javascripts_dir': 'js',
      'fonts_dir': 'fonts'
    }
  }

  var options = {
    html: userSettings.http_path || '.',
    css: userSettings.css_dir || 'css',
    sass: userSettings.sass_dir || 'sass',
    img: userSettings.images_dir || 'images',
    js: userSettings.javascripts_dir || 'js',
    fonts: userSettings.fonts_dir || 'fonts'
  };

  // Remove quotes from options, Compass needs them, but we don't.
  for (var k in options) {
    if (typeof(options[k]) === 'string') {
      options[k] = options[k].replace(/"/g, '');
      options[k] = options[k].replace(/'/g, '');

      if (options[k].slice(-1) === '/') {
        options[k] = options[k].slice(0, -1)
      }

      if (trailing === true) {
        options[k] += '/';
      }
    }
  }

  return options;
};


module.exports.paths = function (options) {
  var settings = dirs(options);
  var trailing = options && options.trailing ? options.trailing : false;
  var paths = {};
      paths.html = settings.html;

  for (var i in settings) {
    if (i !== 'html') {
      if (settings[i].slice(0, 1) === '/') {
        paths[i] = settings[i];
      }
      else {
        paths[i] = paths.html
        if (trailing === false) {
          paths[i] += '/';
        }
        paths[i] += settings[i];
      }
    }
  }

  return paths;
}

module.exports.dirs = function (options) {
  return dirs(options);
}