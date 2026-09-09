'use strict';

const PDFDocument = require('pdfkit');
const { computeTotals, formatEUR } = require('./totals');

const INDIGO = '#4F46E5';
const DARK = '#1E293B';
const GRAY = '#64748B';
const LINE = '#E2E8F0';

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Genera il PDF di un documento (preventivo o fattura) e lo scrive sullo stream `out`.
 */
function renderDocumentPDF({ document: doc, items, client, user }, out) {
  const pdf = new PDFDocument({ size: 'A4', margin: 50 });
  pdf.pipe(out);

  const { subtotal, vatAmount, withholdingAmount, total } = computeTotals(
    items, doc.vat_rate, doc.withholding,
  );
  const isInvoice = doc.kind === 'fattura';
  const pageRight = 545;

  /* Intestazione */
  pdf.roundedRect(50, 50, 34, 34, 9).fill(INDIGO);
  pdf.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('S', 60, 57);

  pdf.fillColor(DARK).fontSize(17).font('Helvetica-Bold')
    .text(user.business_name || user.name, 94, 55);
  pdf.fillColor(GRAY).fontSize(9).font('Helvetica');
  let y = 74;
  if (user.vat_number) { pdf.text(`P. IVA ${user.vat_number}`, 94, y); y += 12; }
  if (user.address) { pdf.text(user.address, 94, y, { width: 220 }); }

  pdf.fillColor(INDIGO).fontSize(24).font('Helvetica-Bold')
    .text(isInvoice ? 'FATTURA' : 'PREVENTIVO', 330, 52, { width: 215, align: 'right' });
  pdf.fillColor(DARK).fontSize(11).font('Helvetica')
    .text(`N. ${doc.number}`, 330, 82, { width: 215, align: 'right' });
  pdf.fillColor(GRAY).fontSize(9)
    .text(`Data: ${formatDate(doc.issue_date)}`, 330, 97, { width: 215, align: 'right' });
  if (doc.due_date) {
    pdf.text(`${isInvoice ? 'Scadenza' : 'Valido fino al'}: ${formatDate(doc.due_date)}`,
      330, 109, { width: 215, align: 'right' });
  }

  /* Destinatario */
  pdf.moveTo(50, 140).lineTo(pageRight, 140).strokeColor(LINE).lineWidth(1).stroke();
  pdf.fillColor(GRAY).fontSize(8).font('Helvetica-Bold').text('DESTINATARIO', 50, 155);
  pdf.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
    .text(client?.name || 'Cliente non specificato', 50, 169);
  pdf.fillColor(GRAY).fontSize(9).font('Helvetica');
  let cy = 186;
  for (const line of [client?.address, client?.vat_number ? `P. IVA ${client.vat_number}` : null, client?.email]) {
    if (line) { pdf.text(line, 50, cy, { width: 260 }); cy += 12; }
  }

  /* Tabella voci */
  let ty = Math.max(cy + 22, 235);
  pdf.rect(50, ty, pageRight - 50, 24).fill(INDIGO);
  pdf.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
  pdf.text('DESCRIZIONE', 60, ty + 8, { width: 250 });
  pdf.text('QTÀ', 320, ty + 8, { width: 45, align: 'right' });
  pdf.text('PREZZO', 375, ty + 8, { width: 75, align: 'right' });
  pdf.text('TOTALE', 460, ty + 8, { width: 75, align: 'right' });
  ty += 24;

  pdf.font('Helvetica').fontSize(9.5);
  for (const item of items) {
    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    const height = pdf.heightOfString(item.description, { width: 250 });
    const rowHeight = Math.max(height + 14, 26);

    if (ty + rowHeight > 700) { pdf.addPage(); ty = 60; }

    pdf.fillColor(DARK).text(item.description, 60, ty + 7, { width: 250 });
    pdf.fillColor(GRAY);
    pdf.text(String(item.quantity), 320, ty + 7, { width: 45, align: 'right' });
    pdf.text(formatEUR(item.unit_price), 375, ty + 7, { width: 75, align: 'right' });
    pdf.fillColor(DARK).text(formatEUR(lineTotal), 460, ty + 7, { width: 75, align: 'right' });

    ty += rowHeight;
    pdf.moveTo(50, ty).lineTo(pageRight, ty).strokeColor(LINE).lineWidth(0.5).stroke();
  }

  /* Totali */
  ty += 16;
  if (ty > 660) { pdf.addPage(); ty = 60; }

  const totalRow = (label, value, opts = {}) => {
    pdf.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 12 : 10);
    pdf.fillColor(opts.bold ? DARK : GRAY).text(label, 320, ty, { width: 130, align: 'right' });
    pdf.fillColor(opts.color || DARK).text(value, 455, ty, { width: 80, align: 'right' });
    ty += opts.bold ? 22 : 17;
  };

  totalRow('Imponibile', formatEUR(subtotal));
  totalRow(`IVA ${doc.vat_rate}%`, formatEUR(vatAmount));
  if (withholdingAmount > 0) {
    totalRow(`Ritenuta d'acconto ${doc.withholding}%`, `− ${formatEUR(withholdingAmount)}`);
  }
  pdf.moveTo(320, ty).lineTo(pageRight, ty).strokeColor(LINE).lineWidth(1).stroke();
  ty += 10;
  totalRow(isInvoice ? 'Totale da pagare' : 'Totale', formatEUR(total), { bold: true, color: INDIGO });

  /* Note e piè di pagina */
  if (doc.notes) {
    ty += 14;
    pdf.fillColor(GRAY).fontSize(8).font('Helvetica-Bold').text('NOTE', 50, ty);
    pdf.fillColor(DARK).fontSize(9).font('Helvetica')
      .text(doc.notes, 50, ty + 13, { width: 400 });
  }

  pdf.fontSize(8).fillColor(GRAY).font('Helvetica')
    .text(`Documento generato con Solvia · ${user.business_name || user.name}`,
      50, 780, { width: pageRight - 50, align: 'center' });

  pdf.end();
}

module.exports = { renderDocumentPDF };
