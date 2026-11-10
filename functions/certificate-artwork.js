// ESORIA CodeFest - certificate artwork only. Authorization, result validity,
// revocation, verification URL and storage remain in competition.js.
// All artwork is built from PDF vector primitives; no external image/font needed.
const INK = [0.071, 0.145, 0.216];
const PAPER = [0.973, 0.962, 0.932];
const GOLD = [0.690, 0.494, 0.239];
const RED = [0.671, 0.184, 0.188];
const GREEN = [0.086, 0.369, 0.290];
const MUTED = [0.352, 0.379, 0.379];

export async function drawEsoriaCertificate({pdf, rgb, QRCode, font, titleFont, bodyBold, pdfText, data, certificateId, verificationUrl}) {
  const c = (arr) => rgb(...arr);
  const page = pdf.addPage([842, 595]); // A4 landscape at 72 dpi, one PDF page.
  const rect = (x, y, width, height, fill, opts = {}) => page.drawRectangle({x, y, width, height, color: c(fill), ...opts});
  const line = (x1, y1, x2, y2, color = GOLD, thickness = 1) => page.drawLine({start: {x: x1, y: y1}, end: {x: x2, y: y2}, color: c(color), thickness});
  const disc = (x, y, radius, color, borderColor = GOLD, borderWidth = 1) => page.drawCircle({x, y, size: radius, color: c(color), borderColor: c(borderColor), borderWidth});
  const safe = (value) => pdfText(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim());
  const draw = (value, x, y, size, face = font, color = INK) => page.drawText(face === font ? safe(value) : String(value), {x, y, size, font: face, color: c(color)});
  const textWidth = (value, size, face = font) => face.widthOfTextAtSize(face === font ? safe(value) : String(value), size);
  const centered = (value, centerX, y, size, face = font, color = INK) => draw(value, centerX - textWidth(value, size, face) / 2, y, size, face, color);
  const fitted = (value, maxWidth, size = 12, minSize = 9, face = font) => {
    const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
    const normalized = words.join(' ');
    let currentSize = size;
    while (currentSize > minSize && textWidth(normalized, currentSize, face) > maxWidth) currentSize -= 0.5;
    if (textWidth(normalized, currentSize, face) <= maxWidth) return {lines: [normalized], size: currentSize};
    // Split long names in up to two balanced lines rather than silently clipping.
    const lines = ['', ''];
    const mid = Math.ceil(words.length / 2);
    if (words.length > 1) {
      lines[0] = words.slice(0, mid).join(' ');
      lines[1] = words.slice(mid).join(' ');
    } else {
      const chars = [...normalized];
      lines[0] = chars.slice(0, Math.ceil(chars.length / 2)).join('');
      lines[1] = chars.slice(Math.ceil(chars.length / 2)).join('');
    }
    currentSize = size;
    while (currentSize > minSize && lines.some((entry) => textWidth(entry, currentSize, face) > maxWidth)) currentSize -= 0.5;
    return {lines, size: currentSize};
  };
  const compact = (value, maxWidth, size, face = font) => {
    const normalized = String(value ?? '').trim();
    if (textWidth(normalized, size, face) <= maxWidth) return normalized;
    let short = normalized;
    while (short.length > 2 && textWidth(`${short}...`, size, face) > maxWidth) short = short.slice(0, -1);
    return `${short}...`;
  };

  // Linen stationery sheet, registration marks and editorial frame.
  rect(0, 0, 842, 595, PAPER);
  rect(0, 0, 13, 595, INK);
  rect(13, 577, 829, 18, GOLD);
  // Offset print-registration corner colours, subtly recalling the event palette.
  rect(13, 0, 104, 12, GREEN);
  rect(725, 0, 117, 12, RED);
  rect(13, 552, 62, 25, RED);
  // Low-contrast ink grid: vector, reproducible and printable offline.
  for (let gx = 78; gx < 778; gx += 35) line(gx, 183, gx, 471, [0.943, 0.928, 0.902], 0.26);
  for (let gy = 201; gy < 466; gy += 35) line(74, gy, 769, gy, [0.947, 0.935, 0.915], 0.24);
  rect(34, 29, 774, 530, PAPER, {borderColor: c(INK), borderWidth: 1.2});
  rect(42, 37, 758, 514, PAPER, {borderColor: c([0.76, 0.70, 0.60]), borderWidth: 0.45});
  // Corner registration marks, understated and print friendly.
  for (const x of [49, 793]) for (const y of [44, 544]) {
    line(x - 7, y, x + 7, y, GOLD, 0.7);
    line(x, y - 7, x, y + 7, GOLD, 0.7);
  }
  // Geometry inspired by coding brackets and folded-paper editorial seals.
  rect(67, 492, 37, 37, INK);
  draw('E', 78, 501, 23, titleFont, PAPER);
  rect(110, 504, 2.2, 25, RED);
  draw('ESORIA', 125, 512, 20, titleFont);
  draw('CODEFEST  /  DIGITAL COMPETITION', 126, 494, 8.2, bodyBold, MUTED);
  const stamp = 'OFFICIAL DIGITAL CERTIFICATE';
  draw(stamp, 780 - textWidth(stamp, 8, bodyBold), 508, 8, bodyBold, MUTED);
  draw('DOCUMENT SERIES  /  2026', 780 - textWidth('DOCUMENT SERIES  /  2026', 7.6), 492, 7.6, font, GOLD);
  line(64, 478, 778, 478, INK, 1.1);
  rect(64, 474, 112, 4, RED);
  // Medal made of vector primitives rather than an unverifiable, decorative fake stamp.
  rect(705, 405, 38, 64, RED);
  rect(710, 409, 28, 58, [0.545, 0.137, 0.151]);
  disc(724, 431, 33, PAPER, GOLD, 2.5);
  disc(724, 431, 26, [0.949, 0.907, 0.821], [0.788, 0.634, 0.354], 0.9);
  disc(724, 431, 21, PAPER, GOLD, 0.7);
  draw('E', 715, 419, 31, titleFont, RED);
  for (const [px, py] of [[678,430],[770,430],[724,386],[724,475]]) {
    line(px - 3, py, px + 3, py, GOLD, 0.9);
    line(px, py - 3, px, py + 3, GOLD, 0.9);
  }

  // Distinct title hierarchy - generous whitespace and no stock graphics.
  centered('PENGHARGAAN RESMI', 421, 448, 10.4, bodyBold, RED);
  centered('E-SERTIFIKAT', 421, 392, 47, titleFont, INK);
  line(319, 376, 523, 376, GOLD, 1.2);
  centered('DIBERIKAN KEPADA', 421, 347, 10, bodyBold, MUTED);

  const recipient = safe(data.recipientName) || 'Peserta ESORIA';
  const name = fitted(recipient, 672, 31.5, 15, font);
  const firstY = name.lines.length === 1 ? 297 : 315;
  name.lines.forEach((item, index) => centered(item, 421, firstY - (index * (name.size + 8)), name.size, font, INK));
  const finalNameBottom = firstY - (name.lines.length - 1) * (name.size + 8);
  line(170, Math.min(finalNameBottom - 12, 283), 672, Math.min(finalNameBottom - 12, 283), GOLD, 0.65);

  const rank = Number(data.rank);
  const isWinner = Number.isInteger(rank) && rank >= 1 && rank <= 3;
  const award = isWinner ? `PENGHARGAAN JUARA ${['I', 'II', 'III'][rank - 1]}` : 'PARTISIPASI TERVALIDASI';
  const badge = isWinner && rank === 1 ? GOLD : isWinner && rank === 2 ? MUTED : isWinner ? RED : GREEN;
  const badgeWidth = Math.max(240, textWidth(award, 11, bodyBold) + 40);
  line(252, 236, 421 - badgeWidth / 2 - 12, 236, GOLD, 0.9);
  line(421 + badgeWidth / 2 + 12, 236, 590, 236, GOLD, 0.9);
  rect(421 - badgeWidth / 2, 221, badgeWidth, 30, badge);
  centered(award, 421, 230.5, 11, bodyBold, PAPER);
  const descriptor = isWinner
    ? 'Atas prestasi pada kompetisi ESORIA CodeFest yang telah disahkan.'
    : 'Atas karya yang dikirim dan dinyatakan memenuhi syarat kompetisi.';
  centered(descriptor, 421, 197, 10, font, MUTED);

  // Bottom dossier: certificate identity is canonical and QR remains verifiable.
  line(65, 178, 778, 178, INK, 0.85);
  draw('KATEGORI / CATEGORY', 68, 160, 7.7, bodyBold, RED);
  draw(compact(safe(data.packageLabel || 'Kompetisi'), 540, 13, bodyBold), 68, 140, 13, bodyBold, INK);
  draw('PERIODE & GELOMBANG', 68, 119, 7.7, bodyBold, MUTED);
  draw(compact(safe([data.periodLabel, data.waveLabel].filter(Boolean).join('  /  ')), 540, 10.4), 68, 104, 10.4, font, INK);
  line(65, 90, 613, 90, GOLD, 0.8);
  draw(`CERTIFICATE ID  ${certificateId}`, 68, 74, 9, font, INK);
  draw(`RESULT REVISION  ${safe(data.resultRevision)}`, 68, 59, 8.2, font, MUTED);
  draw('Status berlaku diverifikasi melalui QR / situs resmi ESORIA', 68, 44, 8.2, font, MUTED);
  rect(631, 59, 149, 111, PAPER, {borderColor: c(GOLD), borderWidth: 0.9});
  const qr = await pdf.embedPng(await QRCode.toBuffer(verificationUrl, {width: 272, margin: 1, errorCorrectionLevel: 'M'}));
  page.drawImage(qr, {x: 660, y: 73, width: 93, height: 93});
  draw('SCAN TO VERIFY', 651, 63, 7.4, bodyBold, INK);
  return page;
}
