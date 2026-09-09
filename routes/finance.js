'use strict';

/**
 * Spese, abbonamenti ricorrenti, solleciti, stima tasse e ricerca globale.
 * Tutto ciò che riguarda "quanto entra, quanto esce, quanto resta".
 */

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const recurring = require('../lib/recurring');
const reminders = require('../lib/reminders');
const tax = require('../lib/tax');
const { checkLimit } = require('../lib/billing');
const { renderAnnualReport } = require('../lib/report');

/** Blocca le funzioni riservate al piano Pro. */
function proOnly(feature) {
  return (req, res, next) => {
    const check = checkLimit(req.user, feature);
    if (!check.allowed) return res.status(402).json({ error: check.reason, upgrade: true, ...check });
    next();
  };
}

const router = express.Router();
router.use(requireAuth, studioCondiviso);

const today = () => new Date().toISOString().slice(0, 10);

/* ========================== SPESE ========================== */

const CATEGORIES = [
  'software', 'attrezzatura', 'formazione', 'trasferte',
  'consulenze', 'marketing', 'ufficio', 'altro',
];

router.get('/expenses', (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const expenses = db.prepare(`
    SELECT * FROM expenses WHERE user_id = ? AND spent_on LIKE ?
    ORDER BY spent_on DESC, id DESC
  `).all(req.user.id, `${year}%`);

  const byCategory = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n
    FROM expenses WHERE user_id = ? AND spent_on LIKE ?
    GROUP BY category ORDER BY total DESC
  `).all(req.user.id, `${year}%`);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  res.json({ expenses, byCategory, total, categories: CATEGORIES, year });
});

router.post('/expenses', (req, res) => {
  const { description, amount, category, spent_on, supplier, notes } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'Descrivi la spesa' });
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'Inserisci un importo maggiore di zero' });

  const info = db.prepare(`
    INSERT INTO expenses (user_id, description, amount, category, spent_on, supplier, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.id, description.trim(), Number(amount),
    CATEGORIES.includes(category) ? category : 'altro',
    spent_on || today(), supplier?.trim() || null, notes?.trim() || null);

  res.status(201).json({ expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/expenses/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!e) return res.status(404).json({ error: 'Spesa non trovata' });

  const b = req.body || {};
  db.prepare(`
    UPDATE expenses SET description = ?, amount = ?, category = ?, spent_on = ?, supplier = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `).run(b.description?.trim() || e.description,
    Number(b.amount) > 0 ? Number(b.amount) : e.amount,
    CATEGORIES.includes(b.category) ? b.category : e.category,
    b.spent_on || e.spent_on, b.supplier?.trim() || null, b.notes?.trim() || null,
    e.id, req.user.id);

  res.json({ expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(e.id) });
});

router.delete('/expenses/:id', (req, res) => {
  const info = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Spesa non trovata' });
  res.json({ ok: true });
});

/* ====================== ABBONAMENTI ====================== */

router.get('/recurring', proOnly('recurring'), (req, res) => {
  const items = recurring.list(req.user.id);
  res.json({
    recurring: items,
    monthlyValue: items.filter((r) => r.active)
      .reduce((s, r) => s + r.yearlyValue / 12, 0),
    frequencies: recurring.FREQUENCY_LABEL,
  });
});

router.post('/recurring', proOnly('recurring'), (req, res) => {
  const result = recurring.create(req.user.id, req.body || {});
  if (!result.ok) return res.status(400).json(result);
  logActivity(req.user.id, `Nuovo abbonamento ricorrente: ${req.body.name}`, 'euro');
  res.status(201).json(result);
});

router.put('/recurring/:id', (req, res) => {
  const result = recurring.update(req.user.id, req.params.id, req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

router.delete('/recurring/:id', (req, res) => {
  const result = recurring.remove(req.user.id, req.params.id);
  res.status(result.ok ? 200 : 404).json(result);
});

/** Genera subito la fattura, senza aspettare la scadenza. */
router.post('/recurring/:id/genera', (req, res) => {
  const owned = db.prepare('SELECT id FROM recurring WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!owned) return res.status(404).json({ error: 'Abbonamento non trovato' });
  res.json(recurring.generate(owned.id));
});

/** Esegue tutti gli abbonamenti scaduti dell'utente. */
router.post('/recurring/esegui', (req, res) => res.json(recurring.runDue(req.user.id)));

/* ====================== SOLLECITI ====================== */

router.get('/reminders', proOnly('reminders'), (req, res) => {
  reminders.prepareForUser(req.user.id);   // aggiorna prima di mostrare
  res.json({
    reminders: reminders.list(req.user.id),
    pending: reminders.list(req.user.id, 'da_approvare').length,
  });
});

router.put('/reminders/:id', (req, res) => {
  const result = reminders.updateText(req.user.id, req.params.id, req.body?.subject, req.body?.body);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/reminders/:id/invia', async (req, res) => {
  try {
    const result = await reminders.send(req.user.id, req.params.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    console.error('Invio sollecito non riuscito:', e.message);
    res.status(500).json({ ok: false, error: 'Invio non riuscito' });
  }
});

router.post('/reminders/:id/annulla', (req, res) => {
  const result = reminders.dismiss(req.user.id, req.params.id);
  res.status(result.ok ? 200 : 400).json(result);
});

/* ====================== TASSE ====================== */

router.get('/tax', (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());

  // Base di calcolo: l'imponibile delle fatture incassate, non il totale con IVA.
  const collected = db.prepare(`
    SELECT COALESCE(SUM(subtotal),0) AS v FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'pagata' AND paid_at LIKE ?
  `).get(req.user.id, `${year}%`).v;

  const invoiced = db.prepare(`
    SELECT COALESCE(SUM(subtotal),0) AS v FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status IN ('inviata','pagata') AND issue_date LIKE ?
  `).get(req.user.id, `${year}%`).v;

  const expenses = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE user_id = ? AND spent_on LIKE ?',
  ).get(req.user.id, `${year}%`).v;

  const settings = {
    tax_regime: req.user.tax_regime,
    tax_coefficient: req.user.tax_coefficient,
    tax_rate: req.user.tax_rate,
    inps_type: req.user.inps_type,
    inps_reduction: req.user.inps_reduction,
  };

  res.json({
    year,
    collected,
    invoiced,
    expenses,
    // Stima su quanto già incassato e proiezione su tutto il fatturato emesso
    onCollected: tax.estimate(collected, settings),
    onInvoiced: tax.estimate(invoiced, settings),
    settings,
    options: tax.options(),
    profit: Math.round((collected - expenses - tax.estimate(collected, settings).total) * 100) / 100,
  });
});

router.put('/tax/settings', (req, res) => {
  const b = req.body || {};
  const valid = tax.options().map((o) => o.id);
  // tax_configured distingue "ha scelto il regime" da "ha i valori predefiniti":
  // serve alla checklist dei primi passi, che altrimenti darebbe il passo per
  // fatto senza che l'utente abbia deciso nulla.
  db.prepare(`
    UPDATE users SET tax_regime = ?, tax_coefficient = ?, tax_rate = ?,
      inps_type = ?, inps_reduction = ?, tax_configured = 1 WHERE id = ?
  `).run(
    ['forfettario', 'ordinario'].includes(b.tax_regime) ? b.tax_regime : req.user.tax_regime,
    Number(b.tax_coefficient) >= 0 ? Number(b.tax_coefficient) : req.user.tax_coefficient,
    Number(b.tax_rate) >= 0 ? Number(b.tax_rate) : req.user.tax_rate,
    valid.includes(b.inps_type) ? b.inps_type : req.user.inps_type,
    b.inps_reduction ? 1 : 0,
    req.user.id,
  );
  res.json({ ok: true });
});

/* ====================== RIEPILOGO ANNUALE ====================== */

/** PDF con il quadro dell'anno, pronto da inoltrare al commercialista. */
router.get('/riepilogo/:year', (req, res) => {
  const year = String(req.params.year).match(/^\d{4}$/) ? req.params.year : String(new Date().getFullYear());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `${req.query.inline ? 'inline' : 'attachment'}; filename="riepilogo-${year}.pdf"`);
  renderAnnualReport(req.user, year, res);
});

/* ====================== RICERCA GLOBALE ====================== */

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const uid = req.user.id;

  const results = [];

  db.prepare(`
    SELECT id, name, email FROM clients
    WHERE user_id = ? AND (lower(name) LIKE ? OR lower(COALESCE(email,'')) LIKE ?)
    LIMIT 5
  `).all(uid, like, like).forEach((c) => results.push({
    type: 'cliente', id: c.id, title: c.name, subtitle: c.email || 'Nessuna email', view: 'clients',
  }));

  db.prepare(`
    SELECT d.id, d.number, d.kind, d.total, d.status, c.name AS client_name
    FROM documents d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.user_id = ? AND (lower(d.number) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?)
    ORDER BY d.issue_date DESC LIMIT 6
  `).all(uid, like, like).forEach((d) => results.push({
    type: d.kind, id: d.id, title: `${d.kind === 'fattura' ? 'Fattura' : 'Preventivo'} ${d.number}`,
    subtitle: `${d.client_name || 'Senza cliente'} · ${d.status}`,
    view: d.kind === 'fattura' ? 'invoices' : 'quotes',
  }));

  db.prepare(`
    SELECT id, title, due_date FROM tasks
    WHERE user_id = ? AND done = 0 AND lower(title) LIKE ? LIMIT 4
  `).all(uid, like).forEach((t) => results.push({
    type: 'attività', id: t.id, title: t.title,
    subtitle: t.due_date ? `Scade il ${t.due_date}` : 'Senza scadenza', view: 'tasks',
  }));

  db.prepare(`
    SELECT id, subject, from_name FROM emails
    WHERE user_id = ? AND (lower(subject) LIKE ? OR lower(from_name) LIKE ?) LIMIT 4
  `).all(uid, like, like).forEach((e) => results.push({
    type: 'email', id: e.id, title: e.subject, subtitle: `Da ${e.from_name}`, view: 'inbox',
  }));

  db.prepare(`
    SELECT id, description, amount FROM expenses
    WHERE user_id = ? AND lower(description) LIKE ? LIMIT 4
  `).all(uid, like).forEach((e) => results.push({
    type: 'spesa', id: e.id, title: e.description, subtitle: `€ ${e.amount}`, view: 'expenses',
  }));

  res.json({ results });
});

module.exports = router;
