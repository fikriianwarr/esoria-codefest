import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const read = (file) => readFileSync(new URL(file, `file://${publicRoot}/`), 'utf8');
const obsoleteTapeRules = [
  ['refinement.css', '.registration-body .registration-intro .registration-flow-mini::before'],
  ['esoria-ui-final.css', '.profile-paper-poster::before'],
  ['account-paper.css', '.auth-paper-poster::before'],
  ['auth-mfa.css', '.auth-body .auth-mfa-panel::before'],
  ['paper-theme.css', '.important-arena-note::before'],
  ['legal/assets/css/legal-paper.css', '.legal-hub .brief-stack::before'],
  ['legal/assets/css/legal-paper.css', '.legal-check-paper::before'],
];

test('dekorasi selotip tidak digambar oleh CSS pada profil, form, autentikasi, tiket dan legal', () => {
  for (const [file, selector] of obsoleteTapeRules) {
    const css = read(file);
    assert.ok(!css.includes(selector), `${file} masih menggambar selotip via ${selector}`);
  }
});

test('ornamen selotip di login mobile dan tombol pendaftaran lama tidak aktif', () => {
  const account = read('account-paper.css');
  assert.match(account, /\.auth-body \.auth-story::after\s*\{\s*content:none;\s*display:none;/);
  assert.doesNotMatch(account, /\.auth-body \.auth-story::after\s*\{[^}]*display:\s*block/);
  const css = read('styles.css');
  assert.doesNotMatch(css, /\.ticket-action-grid \.ticket-payment-cta::after\s*\{[^}]*top:\s*-7px/);
  assert.match(css, /\.ticket-action-grid \.ticket-payment-cta::after\s*\{\s*content:\s*"STATUS PENDAFTARAN"/);
});

test('border paper dan petunjuk utama tetap tersedia', () => {
  assert.match(read('auth-mfa.css'), /\.auth-body \.auth-mfa-panel\s*\{[^}]*border-top:4px solid/);
  assert.match(read('paper-theme.css'), /\.important-arena-note\s*\{[^}]*border:1px solid/);
  assert.match(read('legal/assets/css/legal-paper.css'), /\.legal-check-paper\s*\{[^}]*border:1px solid/);
  assert.match(read('styles.css'), /\.ticket-action-grid \.ticket-payment-cta::after\s*\{[^}]*STATUS PENDAFTARAN/);
});
