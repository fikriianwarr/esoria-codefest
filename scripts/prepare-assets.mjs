import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const checkOnly = process.argv.includes('--check');
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(html|js|css)$/.test(entry.name)) files.push(file);
  }
}
await visit(publicDir);
files.sort();

// Normalize previous versions before hashing, so running this twice is stable.
const assetUrl = /(['"])((?:\.{1,2}\/|\/)?[A-Za-z0-9_./-]+\.(?:js|css))(?:\?[^'"\s<>]*)?\1/g;
const rewrite = (text, version = '') => text.replace(assetUrl, (_, quote, pathname) => {
  const uncached = /(?:^|\/)(runtime-config|firebase-messaging-sw)\.js$/.test(pathname);
  return `${quote}${pathname}${version && !uncached ? `?v=${version}` : ''}${quote}`;
});
const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')]));
const hash = createHash('sha256');
for (const [file, source] of sources) {
  hash.update(path.relative(publicDir, file).split(path.sep).join('/'));
  hash.update('\0');
  hash.update(rewrite(source));
  hash.update('\0');
}
const version = hash.digest('hex').slice(0, 16);
let changed = 0;
for (const [file, source] of sources) {
  const prepared = rewrite(source, version);
  if (prepared === source) continue;
  changed += 1;
  if (!checkOnly) await writeFile(file, prepared);
}
if (checkOnly && changed) {
  console.error(`Versi aset belum sinkron (${changed} file). Jalankan: node scripts/prepare-assets.mjs`);
  process.exitCode = 1;
} else {
  console.log(`Versi aset ${version}: ${checkOnly ? 'valid' : `${changed} file disinkronkan`}.`);
}
