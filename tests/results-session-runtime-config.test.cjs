'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('results page loads runtime config before session-aware context script', () => {
  const html = read('results.html').replace(/\s+/g, ' ');
  const runtimeIndex = html.indexOf('src="runtime-config.js"');
  const contextIndex = html.indexOf('src="results-context.js?v=');
  assert.notEqual(runtimeIndex, -1, 'results.html must load runtime-config.js');
  assert.notEqual(contextIndex, -1, 'results.html must load results-context.js');
  assert.ok(runtimeIndex < contextIndex, 'runtime-config.js must be parsed before results-context.js so Firebase uses the same environment as admin/jury/operations');
});
