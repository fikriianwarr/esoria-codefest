// Admin security timeout remains 25 minutes, but uses activity from all ESORIA tabs.
// Do not sign out just because an inactive admin tab has been backgrounded.
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';
import { markSessionActivity, lastAuthenticatedActivity } from './session-activity.js?v=b74586eaa5ef6110';

const IDLE_LIMIT_MS = 25 * 60_000;
const WARN_BEFORE_MS = 2 * 60_000;
let uid = null;
let signingOut = false;
let notice = null;

function showWarning(text, canContinue = true) {
  if (!notice) {
    notice = document.createElement('aside');
    notice.id = 'esoria-idle-warning';
    notice.className = 'esoria-idle-warning';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    const message = document.createElement('p');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Tetap aktif';
    button.addEventListener('click', () => { markSessionActivity(); hideWarning(); });
    notice.append(message, button);
    document.body.append(notice);
  }
  notice.querySelector('p').textContent = text;
  notice.querySelector('button').hidden = !canContinue;
  notice.hidden = false;
}
function hideWarning() { if (notice) notice.hidden = true; }

async function checkIdle() {
  if (!uid || signingOut || auth.currentUser?.uid !== uid) return;
  // An unfocused window can remain document.visible in desktop browsers.
  // Never let that window sign out a different window where the user is active.
  if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
  const elapsed = Math.max(0, Date.now() - lastAuthenticatedActivity(uid));
  if (elapsed < IDLE_LIMIT_MS - WARN_BEFORE_MS) { hideWarning(); return; }
  if (elapsed < IDLE_LIMIT_MS) {
    const minutes = Math.max(1, Math.ceil((IDLE_LIMIT_MS - elapsed) / 60000));
    showWarning(`Sesi admin akan berakhir dalam sekitar ${minutes} menit bila tidak ada aktivitas.`);
    return;
  }
  signingOut = true;
  showWarning('Sesi admin berakhir setelah 25 menit tidak ada aktivitas. Silakan masuk kembali.', false);
  try {
    await signOut(auth);
    window.location.replace('login.html?session=expired');
  } catch (error) {
    signingOut = false;
    showWarning('Gagal mengakhiri sesi tidak aktif. Periksa koneksi dan coba lagi.', false);
    console.warn('Gagal mengakhiri sesi admin:', error?.code || 'signout-failed');
  }
}

onAuthStateChanged(auth, (user) => {
  if (user?.uid === uid) return;
  uid = user?.uid || null;
  signingOut = false;
  hideWarning();
  if (uid) markSessionActivity();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void checkIdle();
});
window.setInterval(() => { void checkIdle(); }, 30000);
