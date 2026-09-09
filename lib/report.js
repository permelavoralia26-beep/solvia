'use strict';

/**
 * Riepilogo annuale in PDF.
 *
 * Serve a rispondere alla domanda che il commercialista fa ogni anno:
 * "mandami il quadro della situazione". Un foglio solo, con fatturato,
 * incassato, spese per categoria e la stima delle imposte.
 */

const PDFDocument = require('pdfkit');
const { db } = require('./db');
const { formatEUR } = require('./totals');
const tax = require('./tax');

const INDIGO = '#4F46E5';
const DARK = '#1E293B';
const GRAY = '#64748B';
const LINE = '#E2E8F0';

const dmy = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const CATEGORY_LABEL = {
  software: 'Software', attrezzatura: 'Attrezzatura', formazione: 'Formazione',
  trasferte: 'Trasferte', consulenze: 'Consulenze', marketing: 'Marketing',
  ufficio: 'Ufficio', altro: 'Altro',
};

/** Raccoglie tutti i dati dell'anno per un utente. */
function collect(user, year) {
  const like = `${year}%`;
  const one = (sql, ...p) => db.prepare(sql).get(user.id, ...p);

  const invoiced = one(`
    SELECT COALESCE(SUM(subtotal),0) AS imponibile, COALESCE(SUM(vat_amount),0) AS iva,
           COALESCE(SUM(total),0) AS totale, COUNT(*) AS n
    FROM documents WHERE user_id = ? AND kind = 'fattura'
      AND status IN ('inviata','pagata') AND issue_date LIKE ?
  `, like);

  const collected = one(`
    SELECT COALESCE(SUM(subtotal),0) AS imponibile, COALESCE(SUM(total),0) AS totale, COUNT(*) AS n
    FROM documents WHERE user_id = ? AND kind = 'fattura' AND status = 'pagata' AND paid_at LIKE ?
  `, like);

  const outstanding = one(`
    SELECT COALESCE(SUM(total),0) AS totale, COUNT(*) AS n
    FROM documents WHERE user_id = ? AND kind = 'fattura' AND status = 'inviata' AND issue_date LIKE ?
  `, like);

  const expenses = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS totale, COUNT(*) AS n
    FROM expenses WHERE user_id = ? AND spent_on LIKE ?
    GROUP BY category ORDER BY totale DESC
  `).all(user.id, like);

  const byClient = db.prepare(`
    SELECT c.name, COALESCE(SUM(d.total),0) AS totale, COUNT(*) AS n
    FROM documents d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.user_id = ? AND d.kind = 'fattura' AND d.status IN ('inviata','pagata')
      AND d.issue_date LIKE ?
    GROUP BY d.client_id ORDER BY totale DESC LIMIT 12
  `).all(user.id, like);

  const byMonth = db.prepare(`
    SELECT substr(issue_date,1,7) AS mese, COALESCE(SUM(subtotal),0) AS imponibile
    FROM documents WHERE user_id = ? AND kind = 'fattura'
      AND status IN ('inviata','pagata') AND issue_date LIKE ?
    GROUP BY mese ORDER BY mese
  `).all(user.id, like);

  const estimate = tax.estimate(collected.imponibile, {
    tax_regime: user.tax_regime,
    tax_coefficient: user.tax_coefficient,
    tax_rate: user.tax_rate,
    inps_type: user.inps_type,
    inps_reduction: user.inps_reduction,
  });

  const expensesTotal = expenses.reduce((s, e) => s + e.totale, 0);

  return { invoiced, collected, outstanding, expenses, expensesTotal, byClient, byMonth, estimate };
}

function renderAnnualReport(user, year, out) {
  const d = collect(user, year);
  const pdf = new PDFDocument({ size: 'A4', margin: 46 });
  pdf.pipe(out);

  const R = 549;
  let y = 46;

  /* Intestazione */
  pdf.roundedRect(46, y, 30, 30, 8).fill(INDIGO);
  pdf.fillColor('#FFFFFF').fontSize(17).font('Helvetica-Bold').text('S', 55, y + 6);
  pdf.fillColor(DARK).fontSize(18).font('Helvetica-Bold')
    .text(`Riepilogo ${year}`, 86, y + 2);
  pdf.fillColor(GRAY).fontSize(9.5).font('Helvetica')
    .text(user.business_name || user.name, 86, y + 21);
  pdf.fontSize(8.5).text(`Generato il ${dmy(new Date().toISOString())}`, 330, y + 6,
    { width: 219, align: 'right' });
  if (user.vat_number) {
    pdf.text(`P. IVA ${user.vat_number}`, 330, y + 20, { width: 219, align: 'right' });
  }
  y += 46;
  pdf.moveTo(46, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 20;

  /* Riquadri principali */
  const box = (x, w, label, value, note, color) => {
    pdf.roundedRect(x, y, w, 62, 8).fillAndStroke('#F8FAFC', LINE);
    pdf.fillColor(GRAY).fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x + 12, y + 11);
    pdf.fillColor(color || DARK).fontSize(16).font('Helvetica-Bold')
      .text(value, x + 12, y + 25, { width: w - 24 });
    pdf.fillColor(GRAY).fontSize(8).font('Helvetica').text(note, x + 12, y + 46, { width: w - 24 });
  };

  const w = (R - 46 - 16) / 3;
  box(46, w, 'Fatturato (imponibile)', formatEUR(d.invoiced.imponibile), `${d.invoiced.n} fatture emesse`);
  box(46 + w + 8, w, 'Incassato', formatEUR(d.collected.imponibile), `${d.collected.n} fatture saldate`, '#0D9488');
  box(46 + (w + 8) * 2, w, 'Ancora da incassare', formatEUR(d.outstanding.totale),
    `${d.outstanding.n} fatture aperte`, d.outstanding.n ? '#B45309' : DARK);
  y += 80;

  /* Andamento mensile */
  if (d.byMonth.length) {
    pdf.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Andamento mensile', 46, y);
    y += 18;
    const max = Math.max(...d.byMonth.map((m) => m.imponibile), 1);
    const chartH = 70;
    const slot = (R - 46) / 12;
    const MESI = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];

    for (let i = 0; i < 12; i += 1) {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const row = d.byMonth.find((m) => m.mese === key);
      const value = row ? row.imponibile : 0;
      const h = Math.max((value / max) * chartH, value > 0 ? 2 : 0);
      const x = 46 + slot * i + slot * 0.2;
      const bw = slot * 0.6;

      if (h > 0) pdf.roundedRect(x, y + chartH - h, bw, h, 2).fill(INDIGO);
      pdf.fillColor(GRAY).fontSize(7).font('Helvetica')
        .text(MESI[i], x, y + chartH + 4, { width: bw, align: 'center' });
    }
    y += chartH + 22;
    pdf.moveTo(46, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
    y += 16;
  }

  /* Tabelle affiancate: clienti e spese */
  const colW = (R - 46 - 20) / 2;
  const startY = y;

  pdf.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Fatturato per cliente', 46, y);
  let ly = y + 18;
  if (d.byClient.length) {
    for (const c of d.byClient.slice(0, 10)) {
      pdf.fillColor(DARK).fontSize(9).font('Helvetica')
        .text(c.name || 'Senza cliente', 46, ly, { width: colW - 75, ellipsis: true });
      pdf.fillColor(DARK).font('Helvetica-Bold')
        .text(formatEUR(c.totale), 46 + colW - 72, ly, { width: 72, align: 'right' });
      ly += 15;
    }
  } else {
    pdf.fillColor(GRAY).fontSize(9).font('Helvetica').text('Nessuna fattura emessa.', 46, ly);
    ly += 15;
  }

  const x2 = 46 + colW + 20;
  pdf.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Spese per categoria', x2, startY);
  let ry = startY + 18;
  if (d.expenses.length) {
    for (const e of d.expenses) {
      pdf.fillColor(DARK).fontSize(9).font('Helvetica')
        .text(CATEGORY_LABEL[e.category] || e.category, x2, ry, { width: colW - 75, ellipsis: true });
      pdf.font('Helvetica-Bold').text(formatEUR(e.totale), x2 + colW - 72, ry, { width: 72, align: 'right' });
      ry += 15;
    }
    ry += 4;
    pdf.moveTo(x2, ry).lineTo(x2 + colW, ry).strokeColor(LINE).lineWidth(0.5).stroke();
    ry += 7;
    pdf.fillColor(GRAY).fontSize(9).font('Helvetica-Bold').text('Totale spese', x2, ry);
    pdf.fillColor(DARK).text(formatEUR(d.expensesTotal), x2 + colW - 72, ry, { width: 72, align: 'right' });
    ry += 15;
  } else {
    pdf.fillColor(GRAY).fontSize(9).font('Helvetica').text('Nessuna spesa registrata.', x2, ry);
    ry += 15;
  }

  y = Math.max(ly, ry) + 14;
  pdf.moveTo(46, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
  y += 16;

  /* Stima fiscale */
  if (y > 640) { pdf.addPage(); y = 46; }

  pdf.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
    .text('Stima imposte e contributi sull\'incassato', 46, y);
  y += 20;

  const line = (label, value, opts = {}) => {
    pdf.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 9.5);
    pdf.fillColor(opts.bold ? DARK : GRAY).text(label, 46, y, { width: 340 });
    pdf.fillColor(opts.color || DARK).text(value, 386, y, { width: R - 386, align: 'right' });
    y += opts.bold ? 20 : 15;
  };

  const e = d.estimate;
  line(`Incassato (imponibile) ${year}`, formatEUR(e.revenue));
  line(`Coefficiente di redditività ${e.coefficient}%`, formatEUR(e.taxable));
  line(`Contributi — ${e.inpsLabel}${e.inpsReduced ? ' (ridotti del 35%)' : ''}`, formatEUR(e.inps));
  line(`Imposta sostitutiva ${e.taxRate}%`, formatEUR(e.tax));
  pdf.moveTo(46, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 10;
  line('Totale stimato da versare', formatEUR(e.total), { bold: true, color: INDIGO });
  line('Resta al netto di imposte e spese',
    formatEUR(Math.round((e.revenue - e.total - d.expensesTotal) * 100) / 100),
    { bold: true, color: '#0D9488' });

  /* Avvertenza */
  y += 12;
  pdf.roundedRect(46, y, R - 46, 52, 8).fillAndStroke('#FEF3C7', '#FDE68A');
  pdf.fillColor('#B45309').fontSize(8.5).font('Helvetica-Bold')
    .text('Documento di supporto, non una dichiarazione fiscale.', 58, y + 11);
  pdf.font('Helvetica').fillColor('#78350F').fontSize(8)
    .text('I dati provengono da quanto registrato nell\'applicazione. La stima di imposte e '
      + 'contributi usa parametri impostati dall\'utente: aliquote e minimali cambiano ogni anno '
      + 'e il coefficiente dipende dal codice ATECO. Il calcolo definitivo spetta al commercialista.',
      58, y + 25, { width: R - 70 });

  pdf.fontSize(7.5).fillColor(GRAY).font('Helvetica')
    .text('Generato con Solvia', 46, 800, { width: R - 46, align: 'center' });

  pdf.end();
}

module.exports = { renderAnnualReport, collect };
