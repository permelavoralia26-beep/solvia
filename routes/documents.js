'use strict';

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const { computeTotals } = require('../lib/totals');
const { renderDocumentPDF } = require('../lib/pdf');
const { draftQuote } = require('../lib/assistant');
const { checkLimit } = require('../lib/billing');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Numerazione progressiva per anno: 2026/001, P-2026/001 */
function nextNumber(userId, kind) {
  const year = new Date().getFullYear();
  const prefix = kind === 'fattura' ? `${year}/` : `P-${year}/`;
  const rows = db.prepare(
    'SELECT number FROM documents WHERE user_id = ? AND kind = ? AND number LIKE ?',
  ).all(userId, kind, `${prefix}%`);

  const max = rows.reduce((acc, r) => {
    const n = parseInt(r.number.slice(prefix.length), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function loadDocument(userId, id) {
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(id, userId);
  if (!document) return null;
  const items = db.prepare('SELECT * FROM line_items WHERE document_id = ? ORDER BY position').all(id);
  const client = document.client_id
    ? db.prepare('SELECT * FROM clients WHERE id = ?').get(document.client_id)
    : null;
  return { document, items, client };
}

function saveItems(documentId, items) {
  db.prepare('DELETE FROM line_items WHERE document_id = ?').run(documentId);
  const stmt = db.prepare(
    'INSERT INTO line_items (document_id, description, quantity, unit_price, position) VALUES (?,?,?,?,?)',
  );
  items.forEach((item, i) => stmt.run(
    documentId,
    String(item.description || '').trim() || 'Voce',
    Number(item.quantity) || 0,
    Number(item.unit_price) || 0,
    i,
  ));
}

/* --------------------------- Lettura --------------------------- */

router.get('/', (req, res) => {
  const kind = req.query.kind === 'preventivo' ? 'preventivo' : 'fattura';
  const status = req.query.status;

  const documents = db.prepare(`
    SELECT d.*, c.name AS client_name
    FROM documents d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.user_id = ? AND d.kind = ? AND (? IS NULL OR d.status = ?)
    ORDER BY d.issue_date DESC, d.id DESC
  `).all(req.user.id, kind, status || null, status || null);

  // Marca come scadute (a livello di presentazione) le fatture non pagate oltre la scadenza
  const now = today();
  for (const d of documents) {
    d.overdue = d.kind === 'fattura' && d.status === 'inviata' && d.due_date && d.due_date < now;
  }
  res.json({ documents });
});

router.get('/:id', (req, res) => {
  const loaded = loadDocument(req.user.id, req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Documento non trovato' });
  res.json(loaded);
});

/* --------------------------- Scrittura --------------------------- */

router.post('/', (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'preventivo' ? 'preventivo' : 'fattura';

  if (kind === 'preventivo') {
    const check = checkLimit(req.user, 'quote');
    if (!check.allowed) {
      return res.status(402).json({ error: check.reason, upgrade: true, ...check });
    }
  }
  const items = Array.isArray(b.items) && b.items.length
    ? b.items
    : [{ description: 'Prestazione professionale', quantity: 1, unit_price: 0 }];

  const vatRate = Number.isFinite(Number(b.vat_rate)) ? Number(b.vat_rate) : req.user.default_vat;
  const withholding = Number(b.withholding) || 0;
  const { subtotal, vatAmount, total } = computeTotals(items, vatRate, withholding);

  const info = db.prepare(`
    INSERT INTO documents (user_id, client_id, kind, number, issue_date, due_date, status,
                           vat_rate, withholding, notes, subtotal, vat_amount, total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id,
    b.client_id || null,
    kind,
    b.number?.trim() || nextNumber(req.user.id, kind),
    b.issue_date || today(),
    b.due_date || addDays(kind === 'fattura' ? 30 : 30),
    'bozza',
    vatRate, withholding, b.notes?.trim() || null,
    subtotal, vatAmount, total,
  );

  saveItems(info.lastInsertRowid, items);
  const loaded = loadDocument(req.user.id, info.lastInsertRowid);
  logActivity(req.user.id, `${kind === 'fattura' ? 'Fattura' : 'Preventivo'} ${loaded.document.number} creato`, 'doc');
  res.status(201).json(loaded);
});

router.put('/:id', (req, res) => {
  const existing = loadDocument(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Documento non trovato' });

  const b = req.body || {};
  const items = Array.isArray(b.items) && b.items.length ? b.items : existing.items;
  const vatRate = Number.isFinite(Number(b.vat_rate)) ? Number(b.vat_rate) : existing.document.vat_rate;
  const withholding = Number.isFinite(Number(b.withholding)) ? Number(b.withholding) : existing.document.withholding;
  const { subtotal, vatAmount, total } = computeTotals(items, vatRate, withholding);

  db.prepare(`
    UPDATE documents SET client_id = ?, issue_date = ?, due_date = ?, vat_rate = ?,
      withholding = ?, notes = ?, subtotal = ?, vat_amount = ?, total = ?
    WHERE id = ? AND user_id = ?
  `).run(
    b.client_id ?? existing.document.client_id,
    b.issue_date || existing.document.issue_date,
    b.due_date || existing.document.due_date,
    vatRate, withholding,
    b.notes !== undefined ? (b.notes?.trim() || null) : existing.document.notes,
    subtotal, vatAmount, total,
    existing.document.id, req.user.id,
  );

  saveItems(existing.document.id, items);
  res.json(loadDocument(req.user.id, existing.document.id));
});

router.patch('/:id/status', (req, res) => {
  const allowed = ['bozza', 'inviata', 'accettata', 'rifiutata', 'pagata'];
  const status = req.body?.status;
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Stato non valido' });

  const existing = loadDocument(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Documento non trovato' });

  db.prepare('UPDATE documents SET status = ?, paid_at = ? WHERE id = ? AND user_id = ?')
    .run(status, status === 'pagata' ? today() : null, existing.document.id, req.user.id);

  logActivity(req.user.id, `${existing.document.number} → ${status}`, status === 'pagata' ? 'euro' : 'doc');
  res.json(loadDocument(req.user.id, existing.document.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Documento non trovato' });
  res.json({ ok: true });
});

/* ------------------- Preventivo → Fattura ------------------- */

router.post('/:id/convert', (req, res) => {
  const src = loadDocument(req.user.id, req.params.id);
  if (!src) return res.status(404).json({ error: 'Documento non trovato' });
  if (src.document.kind !== 'preventivo') {
    return res.status(400).json({ error: 'Solo i preventivi possono essere convertiti in fattura' });
  }

  const { subtotal, vatAmount, total } = computeTotals(
    src.items, src.document.vat_rate, src.document.withholding,
  );
  const info = db.prepare(`
    INSERT INTO documents (user_id, client_id, kind, number, issue_date, due_date, status,
                           vat_rate, withholding, notes, subtotal, vat_amount, total)
    VALUES (?,?,'fattura',?,?,?,'bozza',?,?,?,?,?,?)
  `).run(
    req.user.id, src.document.client_id, nextNumber(req.user.id, 'fattura'),
    today(), addDays(30), src.document.vat_rate, src.document.withholding,
    src.document.notes, subtotal, vatAmount, total,
  );

  saveItems(info.lastInsertRowid, src.items);
  db.prepare('UPDATE documents SET status = ? WHERE id = ?').run('accettata', src.document.id);

  const created = loadDocument(req.user.id, info.lastInsertRowid);
  logActivity(req.user.id, `Preventivo ${src.document.number} convertito in fattura ${created.document.number}`, 'euro');
  res.status(201).json(created);
});

/* --------------------------- PDF --------------------------- */

router.get('/:id/pdf', (req, res) => {
  const loaded = loadDocument(req.user.id, req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Documento non trovato' });

  const filename = `${loaded.document.kind}-${loaded.document.number.replace(/\//g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  renderDocumentPDF({ ...loaded, user: req.user }, res);
});

/* ------------- Condivisione con il cliente ------------- */

/** Genera (o rigenera) il link pubblico da mandare al cliente. */
router.post('/:id/condividi', (req, res) => {
  const check = checkLimit(req.user, 'sharedQuotes');
  if (!check.allowed) return res.status(402).json({ error: check.reason, upgrade: true, ...check });

  const loaded = loadDocument(req.user.id, req.params.id);
  if (!loaded) return res.status(404).json({ error: 'Documento non trovato' });
  if (loaded.document.kind !== 'preventivo') {
    return res.status(400).json({ error: 'Solo i preventivi si possono condividere' });
  }

  // 32 byte casuali: il token è l'unica credenziale per aprire il preventivo,
  // quindi dev'essere impossibile da indovinare.
  const token = require('crypto').randomBytes(32).toString('hex');
  db.prepare(`
    UPDATE documents SET public_token = ?, shared_at = datetime('now'),
      status = CASE WHEN status = 'bozza' THEN 'inviata' ELSE status END
    WHERE id = ? AND user_id = ?
  `).run(token, loaded.document.id, req.user.id);

  logActivity(req.user.id, `Preventivo ${loaded.document.number} condiviso con il cliente`, 'doc');
  res.json({
    token,
    url: `${req.protocol}://${req.get('host')}/p/${token}`,
    document: loadDocument(req.user.id, loaded.document.id).document,
  });
});

/** Revoca il link: chi ce l'ha non vede più nulla. */
router.delete('/:id/condividi', (req, res) => {
  const info = db.prepare(
    'UPDATE documents SET public_token = NULL WHERE id = ? AND user_id = ?',
  ).run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Documento non trovato' });
  res.json({ ok: true });
});

/* ------------- Bozza voci da descrizione libera ------------- */

router.post('/draft', async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Descrivi il lavoro da preventivare' });
  try {
    res.json({ items: await draftQuote(description) });
  } catch {
    res.status(500).json({ error: 'Non è stato possibile generare la bozza' });
  }
});

module.exports = router;
