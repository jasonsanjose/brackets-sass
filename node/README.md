Mac only instructions when building/updating node-sass module:

Brackets' built-in copy of node expects a 32-bit `binding.node`. This is
neither pre-built https://github.com/andrew/node-sass-binaries nor built
during `npm install`. To build the 32-bit binary on Mac:

```
cd /path/to/brackets-sass/node
# install the latest version of node-sass
npm install

# build
cd node_modules/node-sass
node-gyp --arch=ia32 rebuild

# copy to bin
mkdir -p bin/darwin-ia32-v8-3.14
cp build/Release/binding.node bin/darwin-ia32-v8-3.14

```