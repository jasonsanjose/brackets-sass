var fs = require('fs'),
    path = require('path'),
    request = require('request'),
    mkdirp = require('mkdirp'),
    exec = require('shelljs').exec,
    npmconf = require('npmconf'),
    packageInfo = require('./node_modules/node-sass/package.json');

require('./node_modules/node-sass/lib/extensions');

/**
 * Download file, if succeeds save, if not delete
 *
 * @param {String} url
 * @param {String} dest
 * @param {Function} cb
 * @api private
 */

function download(url, dest, cb) {
  applyProxy({ rejectUnauthorized: false }, function(options) {
    var returnError = function(err) {
      cb(typeof err.message === 'string' ? err.message : err);
    };
    request.get(url, options).on('response', function(response) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        returnError('Can not download file from ' + url);
        return;
      }
      response.pipe(fs.createWriteStream(dest));
    }).on('error', returnError);
  });
}

/**
 * Get applyProxy settings
 *
 * @param {Object} options
 * @param {Function} cb
 * @api private
 */

function applyProxy(options, cb) {
  npmconf.load({}, function (er, conf) {
    var proxyUrl;

    if (!er) {
      ['https-proxy', 'proxy', 'http-proxy'].some(function(setting) {
        var npmProxyUrl = conf.get(setting);
        if (npmProxyUrl) {
          proxyUrl = npmProxyUrl;
          return true;
        }
      });
    }

    if (!proxyUrl) {
      var env = process.env;
      proxyUrl = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
    }

    options.proxy = proxyUrl;
    cb(options);
  });
}

/**
 * Check if binaries exists
 *
 * @api private
 */

function checkAndFetchBinaries(sassBinaryName) {
  fs.exists(path.join(__dirname, 'node_modules', 'node-sass', 'vendor', sassBinaryName), function (exists) {
    if (exists) {
      return;
    }

    fetch(sassBinaryName);
  });
}

/**
 * Fetch binaries
 *
 * @api private
 */

function fetch(sassBinaryName) {
  var url = [
    'https://raw.githubusercontent.com/sass/node-sass-binaries/v',
    packageInfo.version, '/', sassBinaryName,
    '/binding.node'
  ].join('');
  var dir = path.join(__dirname, 'node_modules', 'node-sass', 'vendor', sassBinaryName);
  var dest = path.join(dir, 'binding.node');

  mkdirp(dir, function(err) {
    if (err) {
      console.error(err);
      return;
    }

    download(url, dest, function(err) {
      if (err) {
        console.error(err);
        return;
      }

      console.log('Binary downloaded and installed at ' + dest);
    });
  });
}

/**
 * Skip if CI
 */

if (process.env.SKIP_SASS_BINARY_DOWNLOAD_FOR_CI) {
  console.log('Skipping downloading binaries on CI builds');
  return;
}

/**
 * Run
 */
// Mac 32-bit not available. See README.md to build manually.
["linux-ia32-node-0.10", "win32-ia32-node-0.10"].forEach(checkAndFetchBinaries);
