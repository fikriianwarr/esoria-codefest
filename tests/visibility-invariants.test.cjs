'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname,'..','public','paper-mobile-controls.css'),'utf8');
test('a hidden staff navbar stays hidden despite mobile display grid !important',()=>{
 assert.match(source,/body\.esoria-dossier-page \.cf-nav\[hidden\]/);
 assert.match(source,/body\[data-workspace="jury"\] \.cf-nav\[hidden\]/);
 assert.match(source,/body\[data-workspace="operations"\] \.cf-nav\[hidden\]/);
 assert.match(source,/display:\s*none\s*!important/);
});
test('role-specific hidden links cannot be revealed by responsive tab styling',()=>{
 assert.match(source,/\.cf-nav :is\(a,button\)\[hidden\]/);
});
test('unavailable staff workflow buttons respect hidden state',()=>{
 assert.match(source,/body\[data-workspace="jury"\] button\[hidden\]/);
 assert.match(source,/body\[data-workspace="operations"\] button\[hidden\]/);
});
