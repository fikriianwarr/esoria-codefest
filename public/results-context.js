/*
 * No private data or permissions are granted by navigation.
 * The archive is public. A query parameter never confers staff privilege.
 * A staff navigation context is shown only after Firebase Auth and Firestore
 * have verified the signed-in user. Errors never terminate the Auth session.
 */
(() => {
  'use strict';
  const from = new URLSearchParams(location.search).get('from');
  const destinations = Object.freeze({ admin: 'admin.html', operations: 'operations.html', jury: 'jury.html', dashboard: 'dashboard.html' });
  if (!Object.prototype.hasOwnProperty.call(destinations, from)) return;

  // A navigation hint is NOT authorization. Do not rely on referrer:
  // browsers may omit it, and clients can forge the query parameter.
  // Administrative navigation is shown only after the Auth/role check below.

  const publicNav = document.querySelector('[data-context-nav="public"]');
  const staffNav = document.querySelector('[data-context-nav="staff"]');
  const memberNav = document.querySelector('[data-context-nav="member"]');
  const preview = document.querySelector('#results-admin-preview');
  let status = null;
  let verifiedUser = null;
  let roleEpoch = 0;
  let verifyRole = () => {};
  let readCurrentUser = () => verifiedUser;
  let visibleUid = null;
  const endPending = () => document.documentElement?.classList.remove('esoria-context-pending');
  const hideContext = () => {
    if (publicNav) publicNav.hidden = true;
    if (staffNav) staffNav.hidden = true;
    if (memberNav) memberNav.hidden = true;
    if (preview) preview.hidden = true;
    visibleUid = null;
  };
  const showMember = (user) => {
    if (publicNav && memberNav) {
      publicNav.hidden = true;
      if (staffNav) staffNav.hidden = true;
      memberNav.hidden = false;
      if (preview) preview.hidden = true;
      visibleUid = user.uid;
    }
    endPending();
  };


  const resetToPublic = () => {
    // A role is never inferred from URL parameters or the last checked user.
    if (publicNav) publicNav.hidden = false;
    if (staffNav) staffNav.hidden = true;
    if (memberNav) memberNav.hidden = true;
    if (preview) preview.hidden = true;
    visibleUid = null;
    endPending();
  };
  const clearStatus = () => {
    if (status) { status.remove(); status = null; }
  };
  const setStatus = (message, action = '') => {
    if (!status) {
      status = document.createElement('p');
      status.id = 'esoria-results-session-status';
      status.className = 'cf-context-state';
      status.setAttribute('role', 'status');
      const hero = document.querySelector('.cf-hero');
      if (hero) hero.insertAdjacentElement('beforebegin', status);
    }
    if (!status) return;
    status.replaceChildren();
    const notice = document.createElement('span');
    notice.textContent = message;
    status.append(notice);
    // Navigating to a protected page without a session would redirect to login.
    // Explicit sign-in is clearer than a misleading 'return' button.
    if (action === 'login') {
      const login = document.createElement('a');
      login.href = `login.html?next=${encodeURIComponent(destinations[from])}`;
      login.textContent = 'Masuk untuk membuka ruang kerja ↗';
      status.append(login);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cf-context-retry';
      retry.textContent = 'Periksa sesi lagi';
      retry.addEventListener('click', () => { void verifyRole(readCurrentUser()); });
      status.append(retry);
    } else if (action === 'retry') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cf-context-retry';
      retry.textContent = 'Periksa akses lagi';
      retry.addEventListener('click', () => { void verifyRole(verifiedUser); });
      status.append(retry);
    }
  };

  // Subscribe once. When a user switches accounts or signs out in another tab,
  // Firebase notifies this page and the previous navigation is immediately hidden.
  // The epoch prevents an older Firestore lookup from restoring stale permissions.
  void (async () => {
    try {
      const { observeAuthChanges, isAdminUser, getCurrentAuthUser } =
        await import('./auth-core.js?v=b74586eaa5ef6110');
      if (typeof getCurrentAuthUser === 'function') readCurrentUser = getCurrentAuthUser;
      verifyRole = async (user) => {
        const epoch = ++roleEpoch;
        verifiedUser = user;
        // The URL is only a navigation hint, never evidence of authorization.
        // Keep already verified navigation in place while rechecking the SAME
        // signed-in UID, rather than flashing the anonymous/member navbar.
        const sameVerifiedUser = Boolean(user?.uid && visibleUid === user.uid);
        if (!sameVerifiedUser) {
          hideContext();
          clearStatus();
        }
        if (!user) {
          resetToPublic();
          setStatus('Sesi login belum tersedia di browser ini. Hasil resmi tetap publik. Jika sebelumnya sudah login, periksa izin penyimpanan situs atau buka ruang kerja kembali setelah masuk.', 'login');
          return;
        }
        if (!user.emailVerified) {
          resetToPublic();
          setStatus('Verifikasi email akun diperlukan sebelum membuka navigasi akun.');
          return;
        }
        try {
          const admin = await isAdminUser(user);
          if (epoch !== roleEpoch) return;
          if (from === 'dashboard' && !admin) {
            clearStatus();
            showMember(user);
            return;
          }
          const permitted = admin;
          if (!permitted) {
            resetToPublic();
            setStatus('Halaman ini membutuhkan akses sesuai jenis akun. Hasil resmi tetap dapat dibaca publik.');
            return;
          }
          if (!publicNav || !staffNav) { resetToPublic(); return; }
          const adminLink = staffNav.querySelector('[data-nav-admin]');
          const operationsLink = staffNav.querySelector('[data-nav-operations]');
          const juryLink = staffNav.querySelector('[data-nav-jury]');
          const resultsLink = staffNav.querySelector('[data-nav-result]');
          if (!adminLink || !operationsLink || !juryLink || !resultsLink) { resetToPublic(); return; }
          const destination = from === 'dashboard' ? 'admin' : from;
          resultsLink.href = `results.html?from=${destination}`;
          adminLink.hidden = false;
          operationsLink.hidden = false;
          juryLink.hidden = false;
          clearStatus();
          publicNav.hidden = true;
          if (memberNav) memberNav.hidden = true;
          staffNav.hidden = false;
          const logout = staffNav.querySelector('[data-logout]');
          if (logout) {
            logout.hidden = false;
            // Import logout behavior only after the administrative role is verified.
            void import('./logout-controller.js?v=b74586eaa5ef6110').catch((error) => {
              console.warn('ESORIA: tombol Keluar belum dapat digunakan', error?.code || 'module-failed');
            });
          }
          if (preview) preview.hidden = false;
          visibleUid = user.uid;
          endPending();
        } catch (error) {
          if (epoch !== roleEpoch) return;
          // Role lookup failure never signs out; but a failed verification
          // cannot keep privileged navigation visible indefinitely.
          resetToPublic();
          setStatus('Hak akses akun belum dapat diperiksa. Sesi belum tentu berakhir; coba periksa kembali.', 'retry');
          console.warn('ESORIA: konteks pengelola belum terverifikasi', error?.code || 'verification-failed');
        }
      };
      observeAuthChanges((user) => { void verifyRole(user); }, (error) => {
        ++roleEpoch;
        verifiedUser = null;
        resetToPublic();
        setStatus('Pemeriksaan sesi tidak tersedia. Muat ulang halaman untuk mencoba lagi.');
        console.warn('ESORIA: Auth belum tersedia', error?.code || 'auth-failed');
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void verifyRole(readCurrentUser());
      });
    } catch (error) {
      resetToPublic();
      setStatus('Hak akses akun belum dapat diperiksa. Arsip hasil resmi tetap publik.');
      console.warn('ESORIA: modul akun gagal dimuat', error?.code || 'module-load-failed');
    }
  })();
})();
