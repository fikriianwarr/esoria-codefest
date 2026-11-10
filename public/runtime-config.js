// Konfigurasi publik yang aman untuk disimpan di Hosting.
// Site key reCAPTCHA Enterprise bersifat publik dan digunakan untuk Firebase App Check.
globalThis.ESORIA_RUNTIME_CONFIG = Object.freeze({
  // Opt-in is constrained to the isolated Firebase Hosting emulator origin.
  demoEmulator: ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '5000',
  appCheckSiteKey: '6LeRRGQtAAAAAHtkdUIezH-N7fKDaQPGHD3uH86M',
  // Aktifkan hanya setelah authDomain dan Google OAuth redirect URI diotorisasi.
  googleRedirectReady: false,
  analyticsEnabled: true,
  performanceEnabled: true,
  functionsRegion: 'asia-southeast2',
  // Wajib isi Public Web Push certificate (VAPID) dari Firebase Console > Cloud Messaging.
  // Bukan API key, server key, atau App Check site key.
  messagingVapidKey: 'BEb64Qa3wjY8DZ8YI4vYZ2eOPToaYXLOPZqWvgEbJNBsz8WuIZHNAcbN81KUKDoiOLmQlTzWAArbU-pfg-k9SEU'
});
