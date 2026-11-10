'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => readFileSync(path.join(root,p),'utf8');
const legal = path.join(root, 'public','legal');

test('all policy documents retain working navigation but no bottom note/reading panels', () => {
  for (const page of ['privacy-policy','terms-and-conditions','refund-policy','payment-policy','event-rules','cookie-policy','data-request','contact','intellectual-property']) {
    const src=read(`public/legal/${page}.html`);
    assert.doesNotMatch(src,/legal-resource-band|legal-context-note|legal-documents-next/,page);
    assert.match(src,/class="nav-links"/,`${page}: top navigation`);
    assert.match(src,/<footer class="footer">/,`${page}: footer`);
    for (const target of ['privacy-policy.html','terms-and-conditions.html','refund-policy.html','payment-policy.html']) {
      assert.match(src,new RegExp(`href="${target}"`),`${page}: core policy links`);
      assert.ok(existsSync(path.join(legal,target)),`${page}: ${target} exists`);
    }
  }
});

test('contact actions are side-by-side and are authentic email/legal destinations', () => {
  const src=read('public/legal/contact.html');
  assert.match(src,/class="hero-actions contact-hero-actions"/);
  assert.match(src,/href="mailto:esoria\.lab@gmail\.com"/);
  assert.match(src,/href="index\.html">Pusat Legal<\/a>/);
  const css=read('public/legal/assets/css/legal-paper.css');
  assert.match(css,/\.contact-hero-actions\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
});

test('legal menu compact grid keeps native focusable links and no scroll outside viewport', () => {
  const css=read('public/legal/assets/css/legal-paper.css');
  assert.match(css,/\.site-header \.nav-links\{\s*display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/max-height:min\(68dvh,405px\)/);
  assert.match(read('public/legal/assets/js/legal-paper.js'),/aria-expanded/);
});

test('submission navigation gets shared paper skin as the final stylesheet', () => {
  const html=read('public/submission.html');
  const idx=html.indexOf('mobile-navigation-paper.css');
  assert.ok(idx>0);
  assert.ok(idx>html.indexOf('team-workspace-paper.css'));
  const css=read('public/mobile-navigation-paper.css');
  assert.match(css,/body\[data-workspace="submission"\] \.cf-header>nav\.cf-nav/);
  assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('results pending brand and status fit separate rows without trusting role hints', () => {
  const css=read('public/mobile-navigation-paper.css');
  assert.match(css,/html\.esoria-context-pending body\[data-workspace="results"\]/);
  assert.match(css,/grid-column:1\/-1;grid-row:1/);
  const ctx=read('public/results-context.js');
  assert.match(ctx,/hideContext/);
  assert.match(ctx,/isAdminUser/);
});

test('mobile dropdown preserves hidden role-dependent links', () => {
  const css=read('public/mobile-navigation-paper.css');
  assert.match(css,/nav\.cf-nav\[hidden\]/);
  assert.match(css,/:is\(a,button\)\[hidden\]\{display:none!important\}/);
  const src=read('public/paper-workspace-menu.js');
  assert.doesNotMatch(src, /\bsignOut\s*\(|\bsetPersistence\s*\(/);
});
