import { requireAuthenticated } from './auth-core.js?v=b74586eaa5ef6110';

const phoneElement = document.querySelector('#success-phone');

const formatWhatsappNumber = (value) => {
  const compact = String(value || '').replace(/[^+\d]/g, '');
  if (!compact || compact === '+62') return '';
  if (compact.startsWith('+62')) return compact;
  if (compact.startsWith('62')) return `+${compact}`;
  if (compact.startsWith('0')) return `+62${compact.slice(1)}`;
  return `+62${compact}`;
};

try {
  const { profile } = await requireAuthenticated();
  const phone = formatWhatsappNumber(profile?.phone);
  if (phoneElement) {
    phoneElement.textContent = phone || 'Nomor WhatsApp belum lengkap';
    phoneElement.dataset.state = phone ? 'ready' : 'missing';
  }
} catch {
  if (phoneElement) {
    phoneElement.textContent = 'Periksa nomor WhatsApp pada profil';
    phoneElement.dataset.state = 'missing';
  }
}


const referenceElement = document.querySelector('#success-reference');
try {
  const lastRegistration = JSON.parse(sessionStorage.getItem('esoria-last-registration') || '{}');
  const queryId = new URLSearchParams(location.search).get('id');
  referenceElement.textContent = lastRegistration.referenceNumber || queryId || 'Lihat pada halaman profil';
} catch {
  referenceElement.textContent = 'Lihat pada halaman profil';
}

document.querySelector('#success-print')?.addEventListener('click', () => window.print());
