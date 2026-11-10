// Admin-only printable preview for internally generated historical records.
// Not an official certificate. No public QR, verification token, or Firestore writes.
import {StandardFonts, rgb} from 'pdf-lib';

function printable(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?').replace(/\s+/g, ' ').trim();
}

export async function drawEsoriaCertificatePreview(pdf, details) {
  const page = pdf.addPage([842, 595]); // Landscape A4 in points.
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const heavy = await pdf.embedFont(StandardFonts.HelveticaBold);
  const title = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const navy = rgb(0.08, 0.16, 0.24);
  const red = rgb(0.72, 0.18, 0.21);
  const muted = rgb(0.33, 0.37, 0.38);
  const paper = rgb(0.98, 0.97, 0.94);
  const gold = rgb(0.84, 0.68, 0.35);
  const draw = (value, x, y, size = 12, font = body, color = navy) =>
    page.drawText(printable(value), {x, y, size, font, color});
  const centered = (value, y, size, font = body, color = navy) => {
    const str = printable(value);
    draw(str, (842 - font.widthOfTextAtSize(str, size)) / 2, y, size, font, color);
  };
  const fitted = (value, maxWidth, base = 33, minimum = 15) => {
    const str = printable(value) || 'Nama belum tersedia';
    let size = base;
    while (size > minimum && title.widthOfTextAtSize(str, size) > maxWidth) size -= 0.5;
    if (title.widthOfTextAtSize(str, size) <= maxWidth) return {value: str, size};
    let short = str;
    while (short.length > 2 && title.widthOfTextAtSize(short + '...', minimum) > maxWidth) short = short.slice(0, -1);
    return {value: short + '...', size: minimum};
  };

  page.drawRectangle({x:0, y:0, width:842, height:595, color:paper});
  page.drawRectangle({x:0, y:0, width:13, height:595, color:navy});
  page.drawRectangle({x:13, y:579, width:829, height:16, color:gold});
  page.drawRectangle({x:30, y:29, width:782, height:535, borderWidth:1.2, borderColor:navy});
  page.drawRectangle({x:38, y:37, width:766, height:519, borderWidth:0.6, borderColor:gold});

  centered('ESORIA CODEFEST', 496, 21, title);
  centered('PRATINJAU SERTIFIKAT', 414, 36, title, navy);
  centered('ARSIP INTERNAL - BUKAN BUKTI PENGHARGAAN RESMI', 376, 10, heavy, red);
  centered('Data yang tercatat atas nama', 337, 12, body, muted);
  const recipient = fitted(details.recipientName || details.userName);
  centered(recipient.value, 283, recipient.size, title, navy);
  page.drawLine({start:{x:125,y:262},end:{x:717,y:262},color:gold,thickness:1.3});
  centered(`${details.category || 'Kompetisi'} / ${details.period || '-'} / ${details.wave || '-'}`, 232, 12, heavy);
  if (Number.isInteger(details.rank) && details.rank >= 1 && details.rank <= 3) {
    centered(`Peringkat yang tercatat pada arsip internal: ${details.rank}`, 205, 12, body);
  } else {
    centered('Rekap internal keikutsertaan kompetisi', 205, 12, body);
  }
  centered('Dokumen ini dapat dicetak untuk memeriksa desain dan data arsip.', 152, 10, body, muted);
  centered('Tidak menyatakan kemenangan, pembayaran, atau pengesahan publik.', 135, 10, heavy, red);
  draw(`Referensi internal: ${printable(details.registrationId).slice(0,110)}`, 62, 74, 8, body, muted);
  draw('Tidak memiliki QR atau validasi sertifikat resmi.', 62, 56, 8, body, muted);

  pdf.setTitle('Pratinjau Sertifikat - ESORIA CodeFest');
  pdf.setAuthor('ESORIA CodeFest');
  pdf.setSubject('Pratinjau cetak internal, bukan sertifikat resmi');
  return pdf;
}
