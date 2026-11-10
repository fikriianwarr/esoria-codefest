import {readFile} from 'node:fs/promises';

// Bundles are packaged with private Cloud Functions source. Never place these
// files in public/ or expose a Hosting rewrite to their download handler.
const MATERIALS = Object.freeze({
  web: {path: './materials/ESORIA_Bahan_web.zip', fileName: 'ESORIA_Bahan_Website_Programming.zip'},
  cyber: {path: './materials/ESORIA_Bahan_cyber.zip', fileName: 'ESORIA_Bahan_Cybersecurity_Mini_CTF.zip'},
  team: {path: './materials/ESORIA_Bahan_team.zip', fileName: 'ESORIA_Bahan_Full_Stack_Team.zip'}
});

export const eligibleForMaterials = (registration, team, uid) => Boolean(
  registration && registration.active !== false
  && registration.status === 'terverifikasi'
  && registration.paymentStatus === 'sesuai'
  && typeof registration.ticketNumber === 'string'
  && /^ECF-(?!ECF-)[A-Z0-9_-]{4,80}$/.test(registration.ticketNumber)
  && Object.hasOwn(MATERIALS, registration.package)
  && (registration.userId === uid
    || (registration.package === 'team' && Array.isArray(team?.memberUids) && team.memberUids.includes(uid)))
);

// Hardcoded allowlist prevents client-selected filenames, path traversal and
// disclosure of another category. Keep this method callable only after a
// server-side membership and ticket check.
export async function readCategoryMaterials(category) {
  const entry = Object.hasOwn(MATERIALS, category) ? MATERIALS[category] : null;
  if (!entry) throw new Error('Invalid materials category');
  const data = await readFile(new URL(entry.path, import.meta.url));
  if (!data.length || data.length > 3 * 1024 * 1024) throw new Error('Invalid materials bundle size');
  return {fileName: entry.fileName, mimeType: 'application/zip', base64: data.toString('base64')};
}
