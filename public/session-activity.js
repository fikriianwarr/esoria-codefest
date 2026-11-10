/* Shared across same-origin tabs. Records interaction only for a real signed-in user.
 * Never stores Auth tokens, credentials, or participant information. */
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';

const ACTIVITY_KEY = 'esoria:authenticated-activity:v1';
const WRITE_INTERVAL_MS = 8000;
let localActivityAt = Date.now();
let lastWriteAt = 0;

export const markSessionActivity = () => {
  localActivityAt = Date.now();
  const uid = auth.currentUser?.uid;
  if (!uid || localActivityAt - lastWriteAt < WRITE_INTERVAL_MS) return;
  lastWriteAt = localActivityAt;
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ uid, at: localActivityAt }));
  } catch { /* Private browsing/storage restrictions: local state still works. */ }
};

export const lastAuthenticatedActivity = (uid) => {
  const now = Date.now();
  let latest = localActivityAt;
  try {
    const item = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || 'null');
    if (item?.uid === uid && Number.isFinite(item.at) && item.at <= now + 1000 && item.at >= now - 86400000) {
      latest = Math.max(latest, item.at);
    }
  } catch { /* Malformed or inaccessible cache cannot authorize an account. */ }
  return latest;
};

for (const name of ['pointerdown', 'keydown', 'touchstart']) {
  document.addEventListener(name, markSessionActivity, { passive: true });
}
