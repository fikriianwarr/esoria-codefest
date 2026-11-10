import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const load = (name) => readFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url)), 'utf8');

test('admin metric rail has one grid authority without legacy horizontal slider', () => {
  const css = load('admin.css');
  assert.match(css, /\.admin-body \.admin-metrics\{\s*display:grid!important;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
  assert.doesNotMatch(css, /Clean production v13: responsive metric rail/);
  assert.doesNotMatch(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /admin-metrics>article:last-child:nth-child\(odd\)\{grid-column:1\/-1!important\}/);
});
test('contact cards do not render a second hardcoded arrow', () => {
  const html = load('legal/contact.html');
  const css = load('legal/assets/css/legal-paper.css');
  assert.match(css, /\.btn::after\s*\{\s*content:\s*"↗"/);
  assert.equal((html.match(/class="btn contact-card-action"/g)||[]).length,3);
  assert.doesNotMatch(html, /class="btn contact-card-action"[^>]*>[^<]*<span[^>]*>↗<\/span>/);
});
test('staff pending mode keeps menu hidden until auth-ready', () => {
  const menu = load('paper-workspace-menu.js');
  const css = load('mobile-navigation-paper.css');
  assert.match(menu, /!document\.body\.classList\.contains\('auth-ready'\)\) return null/);
  assert.match(css, /auth-pending \.cf-header>\.cf-paper-menu-toggle/);
  assert.match(css, /auth-pending \.cf-header>\.cf-nav-verifying/);
});
test('security sheet starts at top and does not modify MFA checks', () => {
  const security = load('admin-security.js');
  const css = load('admin.css');
  assert.match(security, /dialog\.scrollTop = 0/);
  assert.match(css, /\.admin-body \.admin-security-dialog\{box-sizing:border-box;width:min\(960px/);
  assert.match(security, /multiFactor\(user\)\.enroll\(/);
});

test('security panel fits desktop without internal scrolling and retains mobile access', () => {
  const html=load('admin.html');
  const css=load('admin-security-fit.css');
  assert.doesNotMatch(html,/class="admin-security-footer"|operator-release-checklist/);
  assert.match(css,/@media\(min-width:760px\) and \(min-height:700px\)/);
  assert.match(css,/overflow-y:auto!important/);
  assert.match(css,/@media\(max-height:699px\)/);
  assert.match(html,/data-admin-security-close/);
});
