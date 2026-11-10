import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(root, 'public');
const errors = [];
const list = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (['node_modules', '.git', '.firebase'].includes(entry.name)) return [];
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? list(file) : [file];
});
const files = list(root);
const relative = (file) => path.relative(root, file);
for (const file of files.filter((item) => /\.(js|cjs|mjs)$/.test(item))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`${relative(file)}: ${result.stderr || result.error}`);
}
for (const name of ['.firebaserc', 'firebase.json', 'firestore.indexes.json', 'storage.cors.json', 'functions/package.json', 'functions/package-lock.json']) {
  try { JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
  catch (error) { errors.push(`${name}: ${error.message}`); }
}

function checkReference(file, reference) {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return;
  const route = new URL(reference, `https://local.test/${path.relative(publicDir, file).split(path.sep).join('/')}`);
  if (route.pathname.startsWith('/__/')) return;
  let target = path.resolve(publicDir, `.${decodeURIComponent(route.pathname)}`);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!target.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(target)) {
    errors.push(`${relative(file)}: tujuan lokal tidak ditemukan: ${reference}`);
  }
}
const pages = files.filter((file) => file.startsWith(publicDir) && file.endsWith('.html'));
for (const file of pages) {
  const source = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  for (const match of source.matchAll(/\bid\s*=\s*(['"])(.*?)\1/g)) {
    if (ids.has(match[2])) errors.push(`${relative(file)}: id ganda ${match[2]}`);
    ids.add(match[2]);
  }
  for (const match of source.matchAll(/\b(?:href|src|data-module)\s*=\s*(['"])(.*?)\1/g)) checkReference(file, match[2]);
}
// Selain HTML dan import JavaScript, CSS dapat memuat asset dan stylesheet lokal.
// Validasi referensi tersebut agar refactor tidak menyisakan gambar atau token CSS putus.
for (const file of files.filter((item) => item.startsWith(publicDir) && item.endsWith('.css'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\burl\(\s*(['"]?)([^'"\)]+)\1\s*\)/g)) {
    checkReference(file, match[2].trim());
  }
  // Quoted CSS @import is not covered by url() checks.
  // URL-form @import is already checked above and must not be reported twice.
  for (const match of source.matchAll(/@import\s+(['"])([^'"]+)\1/g)) {
    checkReference(file, match[2].trim());
  }
}
for (const file of files.filter((item) => item.startsWith(publicDir) && item.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"]+)\1/g)) checkReference(file, match[2]);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Pemeriksaan proyek lulus: ${pages.length} halaman HTML, ${files.filter((file) => /\.(js|cjs|mjs)$/.test(file)).length} skrip JavaScript, konfigurasi JSON, dan referensi aset lokal.`);
}
