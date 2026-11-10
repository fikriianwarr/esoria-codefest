// Structural/contrast checks only. Actual viewport rendering is in tests/browser/.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=new URL('../public/',import.meta.url);
const files=[];
function walk(url){for(const item of readdirSync(url,{withFileTypes:true})){const next=new URL(item.name+(item.isDirectory()?'/':''),url);if(item.isDirectory())walk(next);else if(item.name.endsWith('.html')&&!item.name.startsWith('google'))files.push(next);}}
walk(root);
test('all pages allow browser zoom and declare a responsive viewport',()=>{
 for(const file of files){const html=readFileSync(file,'utf8');assert.match(html,/<meta\b(?=[^>]*name="viewport")[^>]*>/,path.basename(file.pathname));assert.doesNotMatch(html,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,"\s])/i);}
});
function luminance(hex){const [r,g,b]=hex.match(/[a-f0-9]{2}/gi).map((part)=>parseInt(part,16)/255).map((c)=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('paper token text combinations meet WCAG AA normal-text contrast',()=>{
 const css=readFileSync(new URL('paper-tokens.css',root),'utf8');const colors=Object.fromEntries([...css.matchAll(/--esoria-([a-z]+):\s*(#[a-f0-9]{6})/g)].map((match)=>[match[1],match[2]]));
 for(const color of ['ink','muted','red','green'])assert.ok(contrast(colors[color],colors.paper)>=4.5,`${color} contrast`);
});
test('new protected workspaces are inert until verified, and have skip links and native modal dialogs',()=>{
 for(const name of ['dashboard','submission','operations','jury']){
  const html=readFileSync(new URL(`${name}.html`,root),'utf8');assert.match(html,/<main[^>]*inert/);assert.match(html,/<a[^>]+href="#main-content"/);assert.match(html,/<dialog[^>]+aria-labelledby="workspace-dialog-title"/);assert.match(html,/<html lang="id">/);
 }
});
