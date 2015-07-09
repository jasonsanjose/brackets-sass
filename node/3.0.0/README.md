# Upgrading node-sass

* Update [/node/X.X.X/package.json](./package.json) to update the `node-sass` dependency
* `cd /path/to/brackets-sass/node/X.X.X`
* Run `npm install` for the node folder
* Follow instructions below to update the version

# Making changes to node.js modules and dependencies

Due to how [Brackets loads node domains](https://github.com/adobe/brackets/issues/9744), we must manually version the node modules (see `/node/*` files in the repository root) whenever any files change in this sub-tree.

## Rename the node directory to match the extension's version

```
# Match Y.Y.Y to /package.json version for this extension
git mv node/X.X.X node/Y.Y.Y
```

## Update client-side code to match the new version

See [Compiler.js](../../Compiler.js).

```
var _domainPath = ExtensionUtils.getModulePath(module, "node/Y.Y.Y/SASSDomain"),
    _nodeDomain = new NodeDomain("sass-vY.Y.Y", _domainPath);
```

## Update node-side code to match the new version

See [SASSDomain](./SASSDomain.js).

```
var DOMAIN = "sass-vY.Y.Y",
```

# Mac only instructions when updating node-sass module

Brackets' built-in copy of node expects a 32-bit `binding.node`. This is
neither pre-built https://github.com/sass/node-sass-binaries nor built
during `npm install`. To build the 32-bit binary on Mac:

```
cd /path/to/brackets-sass/node/Y.Y.Y
# install the latest version of node-sass
npm install

# build
cd node_modules/node-sass
node scripts/build.js --arch=ia32 -f

# copy to bin
mkdir -p vendor/darwin-ia32-11
# node-sass scripts/build.js outputs to wrong directory name
cp vendor/darwin-x64-11/binding.node vendor/darwin-ia32-11

```
