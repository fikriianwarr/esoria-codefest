import {canonical, sha256, scopeFor} from '../functions/domain.js';
export const MIGRATION_ID = 'esoria-competition-expansion';
export function planRegistration(registrationId, reg, team, digest, now) {
  const plan = [];
  if (reg.package === 'team' && reg.userId && !team) plan.push({path:`teams/${registrationId}`, before:null, after:{registrationId,scope:scopeFor(reg),leaderUid:reg.userId,memberUids:[reg.userId],editorUids:[],createdByMigration:MIGRATION_ID,updatedAt:now}});
  if (/^[a-f0-9]{64}$/.test(reg.proofSha256 || '')) {
    const ids = Array.isArray(digest?.registrationIds) ? digest.registrationIds : [];
    if (!ids.includes(registrationId)) plan.push({path:`proofDigests/${reg.proofSha256}`,before:digest || null,after:{...(digest || {}),registrationIds:[...new Set([...ids,registrationId])].slice(-100),updatedAt:now}});
  }
  return plan.map((item) => ({...item,afterHash:sha256(canonical(item.after))}));
}
export const canRollback = (current, expectedHash) => current && sha256(canonical(current)) === expectedHash;
