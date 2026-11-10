import {createRequire} from 'node:module';
export const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
export const argumentsFor = (argv = process.argv.slice(2)) => {
  const value = (key) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : null;
  return {argv, value, apply: argv.includes('--apply')};
};
export function operatorGuard(args) {
  const projectId = args.value('--project');
  if (!projectId || !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) throw new Error('Gunakan project ID eksplisit melalui --project.');
  if (projectId.startsWith('demo-') && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Proyek demo hanya boleh memakai emulator.');
  if (args.apply && args.value('--confirm') !== projectId) throw new Error('Mutasi memerlukan --apply --confirm <project-id-yang-sama>.');
  // Independent manual data mutations are not part of the full deploy.
  // Production requires the exact project ID via --confirm, but no backup receipt.
  if (process.env.FIRESTORE_EMULATOR_HOST && !projectId.startsWith('demo-')) throw new Error('Jangan mencampur project produksi/staging dengan emulator.');
  return projectId;
}
export function operatorDatabase(projectId) {
  const {initializeApp, getApps} = requireFunctions('firebase-admin/app');
  const {getFirestore, Timestamp, FieldValue} = requireFunctions('firebase-admin/firestore');
  const name = `operator-${projectId}`;
  const app = getApps().find((item) => item.name === name) || initializeApp({projectId},name);
  return {db: getFirestore(app), Timestamp, FieldValue};
}
