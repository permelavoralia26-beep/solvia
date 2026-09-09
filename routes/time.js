'use strict';

/**
 * Ore lavorate.
 *
 * Due modi di registrarle: cronometro (parti, ti dimentichi, fermi) oppure
 * inserimento a mano se te ne sei accorto dopo. Le ore fatturabili si
 * trasformano in voci di fattura in un colpo solo, e restano marcate come
 * già fatturate per non riproporle due volte.
 */

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const { computeTotals } = require('../lib/totals');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Minuti trascorsi da un cronometro ancora in corso. */
const runningMinutes = (startedAt) =>
  Math.max(0, Math.floor((Date.now() - new Date(`${startedAt}Z`.replace(' ', 'T')).getTime()) / 60000));

function decorate(entry) {
  const minutes = entry.started_at && !entry.minutes
    ? runningMinutes(entry.started_at)
    : entry.minutes;
  return {
    ...entry,
    minutes,
    hours: round2(minutes / 60),
    amount: round2((minutes / 60) * entry.hourly_rate),
    running: Boolean(entry.started_at),
  };
}

/* --------------------------- Lettura --------------------------- */

router.get('/', (req, res) => {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));

  const entries = db.prepare(`
    SELECT t.*, c.name AS client_name
    FROM time_entries t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.user_id = ? AND (t.work_date LIKE ? OR t.started_at IS NOT NULL)
    ORDER BY t.started_at IS NULL, t.work_date DESC, t.id DESC
  `).all(req.user.id, `${month}%`).map(decorate);

  const billable = entries.filter((e) => e.billable && !e.billed_on && !e.running);

  // Riepilogo per cliente, utile per capire dove se ne va il tempo
  const byClient = {};
  for (const e of entries.filter((x) => !x.running)) {
    const key = e.client_name || 'Senza cliente';
    byClient[key] = byClient[key] || { name: key, minutes: 0, amount: 0 };
    byClient[key].minutes += e.minutes;
    byClient[key].amount += e.amount;
  }

  res.json({
    month,
    entries,
    running: entries.find((e) => e.running) || null,
    totals: {
      minutes: entries.filter((e) => !e.running).reduce((s, e) => s + e.minutes, 0),
      billableMinutes: billable.reduce((s, e) => s + e.minutes, 0),
      billableAmount: round2(billable.reduce((s, e) => s + e.amount, 0)),
      billableCount: billable.length,
    },
    byClient: Object.values(byClient).sort((a, b) => b.minutes - a.minutes)
      .map((c) => ({ ...c, hours: round2(c.minutes / 60), amount: round2(c.amount) })),
    defaultRate: req.user.hourly_rate,
  });
});

/* --------------------------- Cronometro --------------------------- */

router.post('/start', (req, res) => {
  const already = db.prepare(
    'SELECT id FROM time_entries WHERE user_id = ? AND started_at IS NOT NULL',
  ).get(req.user.id);
  if (already) return res.status(409).json({ error: 'Hai già un cronometro in corso' });

  const info = db.prepare(`
    INSERT INTO time_entries (user_id, client_id, description, work_date, hourly_rate, started_at)
    VALUES (?,?,?,?,?,datetime('now'))
  `).run(req.user.id, req.body?.client_id || null,
    req.body?.description?.trim() || 'Lavoro in corso', today(),
    Number(req.body?.hourly_rate) || req.user.hourly_rate || 0);

  res.status(201).json({ entry: decorate(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid)) });
});

router.post('/stop', (req, res) => {
  const running = db.prepare(
    'SELECT * FROM time_entries WHERE user_id = ? AND started_at IS NOT NULL',
  ).get(req.user.id);
  if (!running) return res.status(404).json({ error: 'Nessun cronometro in corso' });

  // Almeno un minuto: sotto non ha senso registrare nulla.
  const minutes = Math.max(1, runningMinutes(running.started_at));
  db.prepare('UPDATE time_entries SET minutes = ?, started_at = NULL WHERE id = ?')
    .run(minutes, running.id);

  logActivity(req.user.id, `Registrati ${round2(minutes / 60)} h: ${running.description}`, 'dot');
  res.json({ entry: decorate(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(running.id)) });
});

/** Annulla il cronometro senza registrare nulla. */
router.post('/cancel', (req, res) => {
  const info = db.prepare(
    'DELETE FROM time_entries WHERE user_id = ? AND started_at IS NOT NULL',
  ).run(req.user.id);
  res.json({ ok: info.changes > 0 });
});

/* --------------------------- Inserimento a mano --------------------------- */

router.post('/', (req, res) => {
  const { description, client_id, work_date, hours, minutes, hourly_rate, billable } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'Descrivi cosa hai fatto' });

  const total = Math.round((Number(hours) || 0) * 60 + (Number(minutes) || 0));
  if (total <= 0) return res.status(400).json({ error: 'Inserisci un tempo maggiore di zero' });

  const info = db.prepare(`
    INSERT INTO time_entries (user_id, client_id, description, work_date, minutes, hourly_rate, billable)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.id, client_id || null, description.trim(), work_date || today(), total,
    Number(hourly_rate) || req.user.hourly_rate || 0, billable === false ? 0 : 1);

  res.status(201).json({ entry: decorate(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid)) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM time_entries WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Voce non trovata' });
  res.json({ ok: true });
});

/* --------------------------- Ore → fattura --------------------------- */

/**
 * Trasforma le ore fatturabili di un cliente in una fattura.
 * Le voci vengono raggruppate per descrizione, così una settimana di lavoro
 * non diventa venti righe identiche.
 */
router.post('/fattura', (req, res) => {
  const clientId = req.body?.client_id || null;

  const entries = db.prepare(`
    SELECT * FROM time_entries
    WHERE user_id = ? AND billable = 1 AND billed_on IS NULL AND started_at IS NULL
      AND (? IS NULL OR client_id = ?)
  `).all(req.user.id, clientId, clientId);

  if (!entries.length) return res.status(400).json({ error: 'Nessuna ora da fatturare' });

  const grouped = new Map();
  for (const e of entries) {
    const key = `${e.description}|${e.hourly_rate}`;
    const g = grouped.get(key) || { description: e.description, minutes: 0, unit_price: e.hourly_rate };
    g.minutes += e.minutes;
    grouped.set(key, g);
  }

  const items = [...grouped.values()].map((g) => ({
    description: g.description,
    quantity: round2(g.minutes / 60),
    unit_price: g.unit_price,
  }));

  const vatRate = req.user.default_vat;
  const { subtotal, vatAmount, total } = computeTotals(items, vatRate, 0);

  const year = new Date().getFullYear();
  const rows = db.prepare(
    "SELECT number FROM documents WHERE user_id = ? AND kind = 'fattura' AND number LIKE ?",
  ).all(req.user.id, `${year}/%`);
  const max = rows.reduce((acc, r) => {
    const n = parseInt(r.number.slice(`${year}/`.length), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  const number = `${year}/${String(max + 1).padStart(3, '0')}`;

  const due = new Date();
  due.setDate(due.getDate() + 30);

  const info = db.prepare(`
    INSERT INTO documents (user_id, client_id, kind, number, issue_date, due_date, status,
                           vat_rate, withholding, subtotal, vat_amount, total)
    VALUES (?,?,'fattura',?,?,?,'bozza',?,0,?,?,?)
  `).run(req.user.id, clientId, number, today(), due.toISOString().slice(0, 10),
    vatRate, subtotal, vatAmount, total);

  const stmt = db.prepare(
    'INSERT INTO line_items (document_id, description, quantity, unit_price, position) VALUES (?,?,?,?,?)',
  );
  items.forEach((i, idx) => stmt.run(info.lastInsertRowid, i.description, i.quantity, i.unit_price, idx));

  // Marcate come fatturate: non torneranno nella prossima fattura.
  const mark = db.prepare('UPDATE time_entries SET billed_on = ? WHERE id = ?');
  entries.forEach((e) => mark.run(info.lastInsertRowid, e.id));

  logActivity(req.user.id, `Fattura ${number} creata da ${entries.length} voci di lavoro`, 'euro');
  res.status(201).json({ ok: true, documentId: info.lastInsertRowid, number, items: items.length });
});

module.exports = router;
