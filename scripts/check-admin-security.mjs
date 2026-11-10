#!/usr/bin/env node
// Verify MFA policy files and flags are consistent without touching cloud state.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = fs.readFileSync(path.join(root, 'functions/.env.esoria-codefest'), 'utf8');
const lines = new Map([...input.matchAll(/^([A-Z_]+)\s*=\s*(true|false)\s*$/gm)].map(m=>[m[1],m[2]]));
const mfa = lines.get('REQUIRE_ADMIN_MFA');
const recent = lines.get('REQUIRE_RECENT_ADMIN_AUTH');
if (!mfa || !recent) throw Error('Flag MFA / reautentikasi wajib eksplisit true atau false.');
if (mfa !== recent) throw Error('MFA dan recent-auth harus diganti serentak, bukan parsial.');
const rules = ['firestore.rules','storage.rules'].map(file=>fs.readFileSync(path.join(root,file),'utf8'));
const enforced = rules.every(rule => rule.includes('sign_in_second_factor') && /request\.auth\.token\.admin\s*==\s*true/.test(rule));
if (mfa === 'true' && !enforced) throw Error('Backend MFA aktif tetapi active Firestore/Storage Rules belum MFA-enforced.');
if (mfa === 'false' && enforced) throw Error('Rules MFA aktif tetapi backend belum MFA-enforced.');
if (mfa === 'false') {
  console.log('MFA: staged; admin belum diwajibkan MFA. Aktifkan hanya setelah seluruh admin enrol dan uji pemulihan; baca docs/PANDUAN_DEPLOY.md.');
} else {
  console.log('MFA: enabled di source/backend/Rules. Pastikan semua akun admin telah enroll di STAGING sebelum produksi.');
}
