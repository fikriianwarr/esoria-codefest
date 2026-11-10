import {api, escapeHtml as esc, formatDate, download} from './competition-client.js?v=b74586eaa5ef6110';
import {friendlyFirebaseError} from './auth-core.js?v=b74586eaa5ef6110';
const alert = document.querySelector('#workspace-alert');
const dialog = document.querySelector('#workspace-dialog');
let dialogCleanup = null;
export const report = (message, type = 'error') => {
  alert.textContent = message;
  alert.dataset.type = type;
  alert.hidden = !message;
};
export const reportError = (error) => {
  const fallback = 'Layanan belum dapat merespons. Periksa koneksi atau coba beberapa saat lagi.';
  const message = error?.code ? friendlyFirebaseError(error) : error?.message || fallback;
  report(message === 'Masuk belum berhasil. Periksa data akun Anda lalu coba kembali.' ? fallback : message);
};
export async function busy(formOrButton, callback) {
  if (formOrButton.dataset.busy === 'true') return;
  formOrButton.dataset.busy = 'true';
  formOrButton.setAttribute('aria-busy', 'true');
  const controls = formOrButton.matches('button') ? [formOrButton] : [...formOrButton.querySelectorAll('button,input,select,textarea')];
  const original = controls.map((control) => control.disabled);
  controls.forEach((control) => {control.disabled = true;});
  try {return await callback();} catch (error) {reportError(error);} finally {
    controls.forEach((control, index) => {control.disabled = original[index];});
    delete formOrButton.dataset.busy;
    formOrButton.removeAttribute('aria-busy');
  }
}
export const modal = (title, html, onReady) => {
  dialogCleanup?.();
  document.querySelector('#workspace-dialog-title').textContent = title;
  const content = document.querySelector('#workspace-dialog-content');
  content.innerHTML = html;
  dialog.showModal();
  dialogCleanup = onReady?.(content) || null;
};
export const closeModal = () => dialog.close();
document.querySelector('#workspace-dialog-close').addEventListener('click', closeModal);
dialog.addEventListener('close', () => {dialogCleanup?.(); dialogCleanup = null;});

let anchorServer = Date.now();
let anchorMono = performance.now();
export const setClock = (serverNow) => {if (Number.isFinite(serverNow)) {anchorServer = serverNow; anchorMono = performance.now();}};
export const now = () => anchorServer + performance.now() - anchorMono;
export const countdown = (deadline) => {
  if (!Number.isFinite(deadline)) return 'Jadwal belum ditetapkan';
  const remaining = deadline - now();
  if (remaining <= 0) return 'Waktu pengumpulan selesai';
  const seconds = Math.floor(remaining / 1000);
  return `${Math.floor(seconds / 86400)} hari ${Math.floor(seconds / 3600) % 24} jam ${Math.floor(seconds / 60) % 60} menit ${seconds % 60} detik`;
};
export const empty = (title, message, action = '') => `<div class="cf-empty"><h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</div>`;
export const statusLabel = (value) => ({menunggu: 'Menunggu pemeriksaan', terverifikasi: 'Diterima', ditolak: 'Ditolak', belum_diperiksa: 'Belum diperiksa', sesuai: 'Pembayaran sesuai', bermasalah: 'Perlu perbaikan', draft: 'Draft', submitted: 'Terkirim', updated: 'Diperbarui', locked: 'Dikunci', reviewed: 'Selesai dinilai', belum_ada: 'Belum ada karya'})[value] || value;
export const scopeFromForm = (form) => Object.fromEntries(new FormData(form));
export const monthWib = () => {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map((part)=>[part.type,part.value]));return `${parts.year}-${parts.month}`;};

export {api, esc, formatDate, download};
