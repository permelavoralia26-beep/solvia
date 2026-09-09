'use strict';

/**
 * Fatture ricorrenti.
 *
 * Un abbonamento definisce voci, cliente e cadenza; alla scadenza genera la
 * fattura da solo. Viene creata come BOZZA: resti tu a decidere quando inviarla,
 * a meno che tu non attivi esplicitamente l'invio automatico.
 */

const { db, logActivity } = require('./db');
const { computeTotals } = require('./totals');

const MONTHS_BY_FREQUENCY = {
  mensile: 1, bimestrale: 2, trimestrale: 3, semestrale: 6, annuale: 12,
};

const FREQUENCY_LABEL = {
  mensile: 'Ogni mese', bimestrale: 'Ogni 2 mesi', trimestrale: 'Ogni 3 mesi',
  semestrale: 'Ogni 6 mesi', annuale: 'Una volta l\'anno',
};

const iso = (d) => d.toISOString().slice(0, 10);

function advance(dateStr, frequency) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + (MONTHS_BY_FREQUENCY[frequency] || 1));
  // Se il giorno non esiste nel mese di arrivo (es. 31 → febbraio),
  // si sposta all'ultimo giorno disponibile invece di sbordare nel mese dopo.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return iso(d);
}

function itemsOf(recurringId) {
  return db.prepare(
    'SELECT description, quantity, unit_price FROM recurring_items WHERE recurring_id = ? ORDER BY position',
  ).all(recurringId);
}

function list(userId) {
  const rows = db.prepare(`
    SELECT r.*, c.name AS client_name
    FROM recurring r LEFT JOIN clients c ON c.id = r.client_id
    WHERE r.user_id = ? ORDER BY r.active DESC, r.next_run
  `).all(userId);

  return rows.map((r) => {
    const items = itemsOf(r.id);
    const { total } = computeTotals(items, r.vat_rate, r.withholding);
    return {
      ...r,
      items,
      total,
      frequencyLabel: FREQUENCY_LABEL[r.frequency] || r.frequency,
      // Ricavo annuo che questo abbonamento vale
      yearlyValue: Math.round(total * (12 / (MONTHS_BY_FREQUENCY[r.frequency] || 1)) * 100) / 100,
    };
  });
}

function create(userId, data) {
  const items = Array.isArray(data.items) ? data.items.filter((i) => i.description?.trim()) : [];
  if (!data.name?.trim()) return { ok: false, error: 'Dai un nome all\'abbonamento' };
  if (!items.length) return { ok: false, error: 'Aggiungi almeno una voce' };
  if (!MONTHS_BY_FREQUENCY[data.frequency]) return { ok: false, error: 'Cadenza non valida' };

  const info = db.prepare(`
    INSERT INTO recurring (user_id, client_id, name, frequency, next_run,
                           vat_rate, withholding, notes, auto_send)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(userId, data.client_id || null, data.name.trim(), data.frequency,
    data.next_run || iso(new Date()),
    Number.isFinite(Number(data.vat_rate)) ? Number(data.vat_rate) : 22,
    Number(data.withholding) || 0,
    data.notes?.trim() || null,
    data.auto_send ? 1 : 0);

  saveItems(info.lastInsertRowid, items);
  return { ok: true, id: info.lastInsertRowid };
}

function saveItems(recurringId, items) {
  db.prepare('DELETE FROM recurring_items WHERE recurring_id = ?').run(recurringId);
  const stmt = db.prepare(
    'INSERT INTO recurring_items (recurring_id, description, quantity, unit_price, position) VALUES (?,?,?,?,?)',
  );
  items.forEach((i, idx) => stmt.run(recurringId,
    String(i.description).trim(), Number(i.quantity) || 1, Number(i.unit_price) || 0, idx));
}

function update(userId, id, data) {
  const existing = db.prepare('SELECT * FROM recurring WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return { ok: false, error: 'Abbonamento non trovato' };

  db.prepare(`
    UPDATE recurring SET client_id = ?, name = ?, frequency = ?, next_run = ?,
      vat_rate = ?, withholding = ?, notes = ?, active = ?, auto_send = ?
    WHERE id = ? AND user_id = ?
  `).run(
    data.client_id ?? existing.client_id,
    data.name?.trim() || existing.name,
    MONTHS_BY_FREQUENCY[data.frequency] ? data.frequency : existing.frequency,
    data.next_run || existing.next_run,
    Number.isFinite(Number(data.vat_rate)) ? Number(data.vat_rate) : existing.vat_rate,
    Number.isFinite(Number(data.withholding)) ? Number(data.withholding) : existing.withholding,
    data.notes !== undefined ? (data.notes?.trim() || null) : existing.notes,
    data.active === undefined ? existing.active : (data.active ? 1 : 0),
    data.auto_send === undefined ? existing.auto_send : (data.auto_send ? 1 : 0),
    id, userId,
  );

  if (Array.isArray(data.items)) {
    const items = data.items.filter((i) => i.description?.trim());
    if (items.length) saveItems(id, items);
  }
  return { ok: true };
}

const remove = (userId, id) => ({
  ok: db.prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').run(id, userId).changes > 0,
});

/** Numerazione progressiva, coerente con quella dei documenti creati a mano. */
function nextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const prefix = `${year}/`;
  const rows = db.prepare(
    "SELECT number FROM documents WHERE user_id = ? AND kind = 'fattura' AND number LIKE ?",
  ).all(userId, `${prefix}%`);
  const max = rows.reduce((acc, r) => {
    const n = parseInt(r.number.slice(prefix.length), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Genera la fattura di un abbonamento e sposta la scadenza successiva. */
function generate(recurringId) {
  const r = db.prepare('SELECT * FROM recurring WHERE id = ?').get(recurringId);
  if (!r) return { ok: false, error: 'Abbonamento non trovato' };

  const items = itemsOf(r.id);
  if (!items.length) return { ok: false, error: 'Nessuna voce da fatturare' };

  const { subtotal, vatAmount, total } = computeTotals(items, r.vat_rate, r.withholding);
  const issue = r.next_run;
  const dueDate = new Date(`${issue}T00:00:00Z`);
  dueDate.setUTCDate(dueDate.getUTCDate() + 30);

  const info = db.prepare(`
    INSERT INTO documents (user_id, client_id, kind, number, issue_date, due_date, status,
                           vat_rate, withholding, notes, subtotal, vat_amount, total, recurring_id)
    VALUES (?,?,'fattura',?,?,?,?,?,?,?,?,?,?,?)
  `).run(r.user_id, r.client_id, nextInvoiceNumber(r.user_id), issue, iso(dueDate),
    r.auto_send ? 'inviata' : 'bozza',
    r.vat_rate, r.withholding, r.notes, subtotal, vatAmount, total, r.id);

  const stmt = db.prepare(
    'INSERT INTO line_items (document_id, description, quantity, unit_price, position) VALUES (?,?,?,?,?)',
  );
  items.forEach((i, idx) => stmt.run(info.lastInsertRowid, i.description, i.quantity, i.unit_price, idx));

  db.prepare(`
    UPDATE recurring SET next_run = ?, last_run = ?, runs = runs + 1 WHERE id = ?
  `).run(advance(issue, r.frequency), issue, r.id);

  const doc = db.prepare('SELECT number FROM documents WHERE id = ?').get(info.lastInsertRowid);
  logActivity(r.user_id, `Fattura ${doc.number} generata da "${r.name}"`, 'euro');

  return { ok: true, documentId: info.lastInsertRowid, number: doc.number };
}

/** Genera tutte le fatture in scadenza (di un utente o di tutti). */
function runDue(userId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const due = userId
    ? db.prepare('SELECT id FROM recurring WHERE active = 1 AND next_run <= ? AND user_id = ?')
      .all(today, userId)
    : db.prepare('SELECT id FROM recurring WHERE active = 1 AND next_run <= ?').all(today);

  const created = [];
  for (const r of due) {
    const result = generate(r.id);
    if (result.ok) created.push(result.number);
  }
  return { generated: created.length, numbers: created };
}

module.exports = {
  list, create, update, remove, generate, runDue, advance,
  FREQUENCY_LABEL, MONTHS_BY_FREQUENCY,
};
