import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { functions, runtimeConfig } from './firebase-config.js?v=b74586eaa5ef6110';

let offset = 0;
let syncedAt = 0;
let pending = null;

export const serverNow = () => Date.now() + offset;
export const getServerClockOffset = () => offset;

export const syncServerClock = async ({ force = false } = {}) => {
  if (!force && syncedAt && Date.now() - syncedAt < 4 * 60 * 1000) return serverNow();
  if (pending) return pending;
  pending = (async () => {
    const started = Date.now();
    try {
      const response = await httpsCallable(functions, 'esoriaApi', { timeout: 10000, limitedUseAppCheckTokens: Boolean(runtimeConfig.appCheckSiteKey) })({ action: 'serverClock', payload: {} });
      const finished = Date.now();
      const serverDate = Number(response.data?.serverNow);
      if (Number.isFinite(serverDate)) {
        offset = serverDate + Math.round((finished - started) / 2) - finished;
        syncedAt = finished;
      }
    } catch {
      // Tetap memakai offset sinkronisasi terakhir bila backend sedang tidak tersedia.
    } finally {
      pending = null;
    }
    return serverNow();
  })();
  return pending;
};
