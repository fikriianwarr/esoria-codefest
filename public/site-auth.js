import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { isAdminUser } from './auth-core.js?v=b74586eaa5ef6110';
import { auth } from './firebase-config.js?v=b74586eaa5ef6110';

import { verifyAndWatchDeviceSession } from './single-device-session.js?v=b74586eaa5ef6110';

const root = document.body.dataset.root || '.';
const authLinks = [...document.querySelectorAll('[data-auth-link]')];
const profileLinks = [...document.querySelectorAll('[data-profile-link]')];
const logoutButtons = [...document.querySelectorAll('[data-logout]')];
const footerPortal = document.querySelector('[data-footer-portal-link]');
const footerDashboard = document.querySelector('[data-footer-dashboard-link]');
let currentUser = null;
let currentAdmin = false;
let currentRegistrationState = document.documentElement.dataset.registrationState || 'checking';
const registrationEyebrow = () => ({
  open: 'PENDAFTARAN AKTIF', upcoming: 'SEGERA DIBUKA',
  full: 'KUOTA PENUH', closed: 'PENDAFTARAN DITUTUP'
}[currentRegistrationState] || 'CEK STATUS PENDAFTARAN');
const refreshRegistrationEyebrow = () => {
  if (!currentUser || currentAdmin) return;
  authLinks.forEach((link) => {
    const eyebrow = link.querySelector('[data-auth-eyebrow]');
    if (eyebrow) eyebrow.textContent = registrationEyebrow();
  });
};
window.addEventListener('esoria:registration-status', (event) => {
  currentRegistrationState = event.detail?.state || 'checking';
  refreshRegistrationEyebrow();
});

const checkAdmin = async (user) => {
  if (user) await verifyAndWatchDeviceSession(user);
  return isAdminUser(user);
};
let authEpoch = 0;

const setFooterLink = (link, href, label) => {
  if (!link) return;
  link.href = `${root}/${href}`;
  link.textContent = label;
  link.removeAttribute('aria-disabled');
  link.removeAttribute('tabindex');
};

const lockAuthLinks = (eyebrow = 'MEMERIKSA SESI', label = 'Memuat akun…') => {
  // Prevent a signed-in user being shown an outdated login link while roles load.
  [footerPortal, footerDashboard].forEach((link) => {
    if (!link) return;
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.textContent = label;
  });
  document.documentElement.dataset.authState = 'checking';
  authLinks.forEach((link) => {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.setAttribute('aria-label', label);
    const note = link.querySelector('[data-auth-eyebrow]');
    const text = link.querySelector('[data-auth-label]') || link;
    if (note) note.textContent = eyebrow;
    text.textContent = label;
  });
};

const updateAuthLinks = async (user) => {
  // Keep both mobile and desktop nav inert during the protected admin lookup.
  const epoch = ++authEpoch;
  lockAuthLinks();
  const admin = await checkAdmin(user);
  if (epoch !== authEpoch || auth.currentUser?.uid !== user?.uid) return;
  currentUser = user;
  currentAdmin = admin;
  profileLinks.forEach((link) => {
    link.hidden = !user;
    link.href = admin ? `${root}/admin.html` : `${root}/profil.html`;
    link.textContent = admin ? 'Panel Admin' : 'Profil';
  });
  logoutButtons.forEach((button) => { button.hidden = !user; });
  const destination = !user ? 'login.html' : !user.emailVerified ? 'verify-email.html' : admin ? 'admin.html' : 'dashboard.html';
  const footerTitle = !user ? 'Masuk ke Portal ↗' : !user.emailVerified ? 'Verifikasi Email ↗' : admin ? 'Buka Panel Admin ↗' : 'Buka Dashboard ↗';
  const footerShort = !user ? 'Portal Akun' : !user.emailVerified ? 'Verifikasi Email' : admin ? 'Panel Admin' : 'Dashboard Saya';
  setFooterLink(footerPortal, destination, footerTitle);
  setFooterLink(footerDashboard, destination, footerShort);
  authLinks.forEach((link) => {
    const label = link.querySelector('[data-auth-label]') || link;
    const eyebrow = link.querySelector('[data-auth-eyebrow]');
    link.href = user ? (admin ? `${root}/admin.html` : `${root}/form-pendaftaran.html`) : `${root}/login.html`;
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
    label.textContent = user ? (admin ? 'Kelola Data ↗' : 'Daftar Lomba ↗') : 'Masuk ↗';
    if (eyebrow) eyebrow.textContent = user ? (admin ? 'ADMIN CONTROL' : registrationEyebrow()) : 'MEMBER ACCESS';
    link.setAttribute('aria-label', user ? (admin ? 'Buka panel admin' : 'Buka pendaftaran lomba') : 'Masuk ke akun Esoria');
  });
  document.documentElement.dataset.authState = user ? 'signed-in' : 'signed-out';
};

onAuthStateChanged(auth, (user) => {
  // Ignore a failure from an earlier user/role lookup after Auth has changed.
  // Otherwise an old async rejection may overwrite a newly verified navbar.
  const requestEpoch = authEpoch + 1;
  void updateAuthLinks(user).catch((error) => {
    if (requestEpoch !== authEpoch) return;
    console.warn('Navigasi akun menunggu verifikasi keamanan:', error?.code || 'verification-error');
    lockAuthLinks('SESI BELUM TERVERIFIKASI', 'Coba lagi nanti');
    document.documentElement.dataset.authState = 'verification-error';
  });
});
