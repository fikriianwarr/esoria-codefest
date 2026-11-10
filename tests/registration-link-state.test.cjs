const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'live-registration-status.js'), 'utf8');
const start = source.indexOf('const updateRegistrationLinks =');
const end = source.indexOf('const renderWaveDossier =', start);
const context = {};
vm.runInNewContext(source.slice(start, end) + '\nthis.updateLinks = updateRegistrationLinks;', context);

// Minimal anchor fixture. Attribute matching follows the queried CSS attributes,
// so removing href actually removes the anchor from an href-only selection.
function anchor(href, html, classes = ['btn-register'], marked = false) {
  const attributes = new Map([['href', href]]);
  const names = new Set(classes);
  let content = html;
  const node = {
    dataset: marked ? { registrationLink: '' } : {},
    classList: {
      toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); },
      contains(name) { return names.has(name); }
    },
    getAttribute(name) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return Object.hasOwn(this.dataset, key) ? this.dataset[key] : null;
      }
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    set tabIndex(value) { attributes.set('tabindex', String(value)); },
    get innerHTML() { return content; },
    set innerHTML(value) { content = value; },
    get textContent() { return content; },
    set textContent(value) { content = value; },
    matches(selector) {
      for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!names.has(match[1])) return false;
      for (const match of selector.matchAll(/\[([\w-]+)(?:(\*=|=)"([^"]*)")?\]/g)) {
        const value = this.getAttribute(match[1]);
        if (value === null) return false;
        if (match[2] === '*=' && !value.includes(match[3])) return false;
        if (match[2] === '=' && value !== match[3]) return false;
      }
      return true;
    }
  };
  return node;
}

function scope(...nodes) {
  return { querySelectorAll(selector) { return nodes.filter(node => selector.split(',').some(part => node.matches(part.trim()))); } };
}

test('a registration link recovers its URL, content and keyboard access after closed becomes open', () => {
  const original = '<span>Daftar Lomba</span><b>↗</b>';
  const link = anchor('../form-pendaftaran.html?paket=team', original);
  const page = scope(link);
  context.updateLinks({ state: 'closed' }, page);
  assert.equal(link.getAttribute('href'), null);
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.equal(link.getAttribute('tabindex'), '-1');
  context.updateLinks({ state: 'open' }, page);
  assert.equal(link.getAttribute('href'), '../form-pendaftaran.html?paket=team');
  assert.equal(link.innerHTML, original);
  assert.equal(link.getAttribute('aria-disabled'), 'false');
  assert.equal(link.getAttribute('tabindex'), null);
  assert.equal(link.classList.contains('registration-link-disabled'), false);
});

test('repeated full/upcoming/closed transitions preserve registration destinations and other navigation', () => {
  const link = anchor('login.html?next=form-pendaftaran.html', 'Masuk & Daftar');
  const marked = anchor('/registration', 'Daftar', [], true);
  const other = anchor('#timeline', 'Lihat Jadwal', ['btn-ghost']);
  const page = scope(link, marked, other);
  for (const state of ['open', 'full', 'full', 'upcoming', 'closed', 'open', 'closed', 'open']) {
    context.updateLinks({ state }, page);
    for (const node of [link, marked]) {
      assert.equal(Boolean(node.getAttribute('href')), state === 'open');
      assert.equal(node.getAttribute('aria-disabled'), String(state !== 'open'));
    }
    assert.equal(other.getAttribute('href'), '#timeline');
    assert.equal(other.textContent, 'Lihat Jadwal');
    assert.equal(other.getAttribute('aria-disabled'), null);
  }
  assert.equal(link.getAttribute('href'), 'login.html?next=form-pendaftaran.html');
  assert.equal(marked.getAttribute('href'), '/registration');
});
