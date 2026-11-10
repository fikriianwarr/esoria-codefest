/* ESORIA CodeFest background messages. Hosted at the origin root. */
/* global firebase, importScripts, clients, self */
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

importScripts('/runtime-config.js');
firebase.initializeApp(self.ESORIA_RUNTIME_CONFIG?.firebase || {
  apiKey: 'AIzaSyBVdDOxokBR67-QGiS5KYONLDlqUkASq-U',
  authDomain: 'esoria-codefest.firebaseapp.com',
  projectId: 'esoria-codefest',
  messagingSenderId: '56329075998',
  appId: '1:56329075998:web:85268753c681f782da1d0f'
});

const messaging = firebase.messaging();
const safeTarget = (url) => {
  try {
    const parsed = new URL(url || '/profil.html', self.location.origin);
    if (parsed.origin !== self.location.origin) return '/profil.html';
    if (!['/profil.html', '/index.html', '/dashboard.html', '/submission.html', '/results.html'].includes(parsed.pathname)) return '/profil.html';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return '/profil.html'; }
};

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  return self.registration.showNotification(String(data.title || 'ESORIA CodeFest').slice(0, 100), {
    body: String(data.body || 'Ada pembaruan aktivitas peserta.').slice(0, 400),
    icon: '/assets/logo_esoria.png',
    badge: '/assets/favicon.svg',
    tag: `esoria-${Date.now()}`,
    data: { url: safeTarget(data.url) }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safeTarget(event.notification.data?.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((windowClient) => new URL(windowClient.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      await existing.focus();
    } else {
      await clients.openWindow(target);
    }
  })());
});
