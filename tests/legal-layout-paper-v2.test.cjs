'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const folder = path.resolve(__dirname, '../public/legal');
const pages = fs.readdirSync(folder).filter((filename) => filename.endsWith('.html'));
const read = (name) => fs.readFileSync(path.join(folder, name), 'utf8');
const css = read('assets/css/legal-paper.css');
const script = read('assets/js/legal-paper.js');
const abandoned = /legal-resource-band|legal-context-note|legal-documents-next|legal-context-list|legal-context-chips|legal-center-note-grid|legal-center-note-foot|Bacaan terkait|Catatan penting:/i;

test('all ten legal pages omit the removed note and related-reading panels', () => {
  assert.equal(pages.length, 10);
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, abandoned, page);
    assert.match(html, /<footer class="footer">/, `${page}: footer retained`);
    assert.match(html, /<main\b[^>]*>/, `${page}: main retained`);
    assert.match(html, /class="nav-links"/, `${page}: navigation retained`);
    if (page === 'index.html') assert.match(html, /id="sebelum-mendaftar"/);
    else assert.match(html, /<h1\b[^>]*>/, `${page}: document heading retained`);
  }
});

test('contact help cards and email guidance remain usable after the panels are deleted', () => {
  const contact = read('contact.html');
  assert.match(contact, /class="cards contact-help-cards"/);
  assert.equal((contact.match(/class="contact-card-footer"/g) || []).length, 3);
  assert.match(contact, /Format Pesan yang Disarankan/);
  for (const name of ['payment-policy.html', 'refund-policy.html', 'data-request.html']) {
    assert.match(contact, new RegExp(`class="btn contact-card-action" href="${name}"`));
  }
});

test('remaining legal navigation and footer links lead to existing local documents', () => {
  for (const page of pages) {
    const html = read(page);
    const links = [...html.matchAll(/<a\b[^>]*\bhref="([^\"]+)"/g)].map((found) => found[1]);
    assert.ok(links.length > 0, `${page}: links retained`);
    for (const href of links) {
      if (/^(?:mailto:|https?:|\/|#|tel:)/.test(href)) continue;
      if (!href.includes('.html')) continue;
      assert.ok(fs.existsSync(path.resolve(folder, href.split('#')[0])), `${page}: ${href}`);
    }
  }
});

test('mobile cards keep fluid heights and the contact cards stack on small displays', () => {
  assert.match(css, /\.cards\s*>\s*\.card\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.contact-help-cards\s*\{\s*grid-template-columns:1fr/s);
  assert.match(css, /@media \(max-width:700px\)/);
});

test('legal menu and generated document index still work without removed panel JS', () => {
  assert.doesNotMatch(script, /classList\.toggle\('open', open\)/);
  assert.match(script, /classList\.toggle\('is-open', open\)/);
  assert.match(script, /article\.append\(grid\)/);
  assert.match(script, /element\.tagName === 'SECTION'/);
  assert.doesNotMatch(script, abandoned);
  assert.doesNotMatch(css, /\.nav-links\.open/);
});

test('no legacy animated stamp, redundant fixed body texture, or panel-only CSS remains', () => {
  assert.doesNotMatch(css, /animation:\s*(?:orbitPaper|sealFloat)/);
  assert.doesNotMatch(css, /@keyframes (?:orbitPaper|sealFloat)/);
  assert.doesNotMatch(css, /body::after\s*\{\s*position:/);
  assert.doesNotMatch(css, abandoned);
});
