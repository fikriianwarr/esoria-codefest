/** Port selection ONLY for the isolated Firebase demo emulator test runner.
 * This module does not touch firebase.json or production configuration.
 */
import {createServer} from 'node:net';

const host = '127.0.0.1';
const fallbacks = {firestore: 18080, auth: 19099, storage: 19199, functions: 15001, hub: 14400, logging: 14500};

async function available(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({host, port, exclusive: true}, () => server.close(() => resolve(true)));
  });
}

async function ephemeral() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({host, port: 0, exclusive: true}, () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/** Return a new emulator map, leaving the checked-in defaults untouched. */
export async function chooseEmulatorPorts(defaults) {
  const selected = new Set();
  const result = structuredClone(defaults);
  // Firebase Emulator Hub and logging also default to fixed ports and can clash.
  for (const [service, defaultPort] of Object.entries({
    auth: defaults.auth?.port ?? 9099,
    firestore: defaults.firestore?.port ?? 8080,
    storage: defaults.storage?.port ?? 9199,
    functions: defaults.functions?.port ?? 5001,
    hub: defaults.hub?.port ?? 4400,
    logging: defaults.logging?.port ?? 4500,
  })) {
    let port = defaultPort;
    if (selected.has(port) || !(await available(port))) {
      port = fallbacks[service];
      if (selected.has(port) || !(await available(port))) {
        do { port = await ephemeral(); } while (selected.has(port));
      }
      // Do not stop another local process or change its settings.
      process.stdout.write(`[ESORIA Emulator] Port ${defaultPort} (${service}) sedang digunakan; memakai ${port} untuk pengujian demo.\n`);
    }
    selected.add(port);
    result[service] = {...result[service], host, port};
  }
  return result;
}
