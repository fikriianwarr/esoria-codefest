// Reusable accessible paper-style confirmation for in-site actions.
// The browser's native beforeunload dialog still protects closing a tab or external navigation.
let queue = Promise.resolve();
function createDialog() {
  let dialog = document.getElementById('esoria-paper-confirm');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'esoria-paper-confirm';
  dialog.className = 'esoria-paper-confirm';
  dialog.setAttribute('aria-labelledby', 'esoria-paper-confirm-title');
  dialog.setAttribute('aria-describedby', 'esoria-paper-confirm-body');
  dialog.innerHTML = `<div class="esoria-paper-confirm-card">
    <header><span class="esoria-paper-confirm-kicker">ESORIA / KONFIRMASI</span><button type="button" class="esoria-paper-confirm-x" data-paper-cancel aria-label="Tutup dialog">×</button></header>
    <div class="esoria-paper-confirm-content"><span class="esoria-paper-confirm-stamp">MOHON PERIKSA</span><h2 id="esoria-paper-confirm-title"></h2><p id="esoria-paper-confirm-body"></p></div>
    <footer><button type="button" class="esoria-paper-confirm-cancel" data-paper-cancel>Tetap di sini</button><button type="button" class="esoria-paper-confirm-accept" data-paper-confirm>Lanjutkan →</button></footer>
  </div>`;
  document.body.append(dialog);
  return dialog;
}
function ask({ title, message, confirmText = 'Lanjutkan', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    const titleNode = dialog.querySelector('#esoria-paper-confirm-title');
    const bodyNode = dialog.querySelector('#esoria-paper-confirm-body');
    const accept = dialog.querySelector('[data-paper-confirm]');
    const cancelButtons = [...dialog.querySelectorAll('[data-paper-cancel]')];
    titleNode.textContent = title || 'Konfirmasi tindakan';
    bodyNode.textContent = message || 'Apakah Anda ingin melanjutkan?';
    accept.textContent = `${confirmText} →`;
    dialog.dataset.danger = String(danger);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      accept.removeEventListener('click', onAccept);
      cancelButtons.forEach((node) => node.removeEventListener('click', onCancelClick));
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onCancel = (event) => { event.preventDefault(); finish(false); };
    const onClose = () => finish(false);
    const onCancelClick = () => finish(false);
    const onAccept = () => finish(true);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    accept.addEventListener('click', onAccept);
    cancelButtons.forEach((node) => node.addEventListener('click', onCancelClick));
    dialog.showModal();
    accept.focus();
  });
}
export const paperConfirm = (options) => {
  const next = queue.then(() => ask(options));
  queue = next.then(() => undefined, () => undefined);
  return next;
};
