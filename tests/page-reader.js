// The shared page reader (src/stores/cart.js) for a test's VM context. The manifest loads it after the content
// scripts that call it, so a test loads it after them too. It is run with `module` hidden: cart.js exports itself
// for Node, which in a VM would replace the `module.exports` the script under test just set.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'stores', 'cart.js'), 'utf8');

function loadPageReader(vm, context) {
  vm.runInContext(`(function (module) {\n${SOURCE}\n})(undefined);`, context, { filename: 'stores/cart.js' });
}

module.exports = { loadPageReader };
