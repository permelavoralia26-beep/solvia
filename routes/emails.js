'use strict';

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const { triageEmail, draftReply, MODE } = require('../lib/assistant');
const { checkLimit } = require('../lib/billing');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

const get = (userId, id) =>
  db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(id, userId);

router.get('/', (req, res) => {
  const status = req.query.status;
  const emails = db.prepare(`
    SELECT * FROM emails
    WHERE user_id = ? AND (? IS NULL OR status = ?)
    ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, received_at DESC
  `).all(req.user.id, status || null, status || null);
  res.json({ emails, mode: MODE });
});

router.get('/:id', (req, res) => {
  const email = get(req.user.id, req.params.id);
  if (!email) return res.status(404).json({ error: 'Email non trovata' });
  res.json({ email });
});

/** Aggiunge un'email in arrivo (usato dalla simulazione e da eventuali integrazioni). */
router.post('/', (req, res) => {
  const { from_name, from_email, subject, body } = req.body || {};
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Oggetto e testo sono obbligatori' });
  }
  const info = db.prepare(`
    INSERT INTO emails (user_id, from_name, from_email, subject, body)
    VALUES (?,?,?,?,?)
  `).run(req.user.id, from_name?.trim() || 'Mittente sconosciuto',
    from_email?.trim() || 'sconosciuto@example.com', subject.trim(), body.trim());

  res.status(201).json({ email: get(req.user.id, info.lastInsertRowid) });
});

/** Analizza l'email: categoria, priorità, riassunto e bozza di risposta. */
router.post('/:id/triage', async (req, res) => {
  const email = get(req.user.id, req.params.id);
  if (!email) return res.status(404).json({ error: 'Email non trovata' });

  const check = checkLimit(req.user, 'triage');
  if (!check.allowed) return res.status(402).json({ error: check.reason, upgrade: true, ...check });

  try {
    const analysis = await triageEmail(email);
    const reply = await draftReply(email, req.user, analysis.category);

    db.prepare(`
      UPDATE emails SET category = ?, priority = ?, summary = ?, draft_reply = ?,
        status = 'bozza_pronta', triaged_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(analysis.category, analysis.priority, analysis.summary, reply, email.id, req.user.id);

    logActivity(req.user.id, `Bozza di risposta pronta per "${email.subject}"`, 'mail');
    res.json({ email: get(req.user.id, email.id), analysis });
  } catch {
    res.status(500).json({ error: 'Analisi non riuscita' });
  }
});

/** Analizza in blocco tutte le email non ancora processate. */
router.post('/triage-all', async (req, res) => {
  const pending = db.prepare(
    "SELECT * FROM emails WHERE user_id = ? AND status = 'da_leggere'",
  ).all(req.user.id);

  const update = db.prepare(`
    UPDATE emails SET category = ?, priority = ?, summary = ?, draft_reply = ?,
      status = 'bozza_pronta', triaged_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `);

  let processed = 0;
  let blocked = null;
  for (const email of pending) {
    // Il limite si ricontrolla a ogni giro: si ferma esattamente alla soglia
    // invece di sforare tutto il blocco in una volta.
    const check = checkLimit(req.user, 'triage');
    if (!check.allowed) { blocked = check.reason; break; }
    try {
      const analysis = await triageEmail(email);
      const reply = await draftReply(email, req.user, analysis.category);
      update.run(analysis.category, analysis.priority, analysis.summary, reply, email.id, req.user.id);
      processed += 1;
    } catch { /* salta l'email problematica e continua */ }
  }

  if (processed) logActivity(req.user.id, `${processed} email analizzate e bozze pronte`, 'mail');
  res.json({ processed, blocked, upgrade: Boolean(blocked) });
});

/** Modifica la bozza scritta dall'assistente. */
router.put('/:id/draft', (req, res) => {
  const email = get(req.user.id, req.params.id);
  if (!email) return res.status(404).json({ error: 'Email non trovata' });

  db.prepare('UPDATE emails SET draft_reply = ? WHERE id = ? AND user_id = ?')
    .run(String(req.body?.draft_reply || ''), email.id, req.user.id);
  res.json({ email: get(req.user.id, email.id) });
});

/**
 * Approva la bozza. In questa versione l'invio SMTP non è collegato:
 * l'email viene marcata come approvata e registrata nell'attività.
 */
router.post('/:id/approve', (req, res) => {
  const email = get(req.user.id, req.params.id);
  if (!email) return res.status(404).json({ error: 'Email non trovata' });
  if (!email.draft_reply) return res.status(400).json({ error: 'Nessuna bozza da approvare' });

  db.prepare("UPDATE emails SET status = 'approvata' WHERE id = ? AND user_id = ?")
    .run(email.id, req.user.id);
  logActivity(req.user.id, `Risposta approvata per ${email.from_name}`, 'check');
  res.json({ email: get(req.user.id, email.id), sent: false, note: 'Invio SMTP non configurato in questa versione' });
});

router.post('/:id/archive', (req, res) => {
  const info = db.prepare("UPDATE emails SET status = 'archiviata' WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Email non trovata' });
  res.json({ ok: true });
});

/** Crea un'attività a partire da un'email. */
router.post('/:id/to-task', (req, res) => {
  const email = get(req.user.id, req.params.id);
  if (!email) return res.status(404).json({ error: 'Email non trovata' });

  const due = new Date();
  due.setDate(due.getDate() + (email.priority === 'alta' ? 1 : 4));

  const info = db.prepare(`
    INSERT INTO tasks (user_id, title, due_date, priority, source) VALUES (?,?,?,?,'email')
  `).run(req.user.id, `Rispondere a ${email.from_name}: ${email.subject}`,
    due.toISOString().slice(0, 10), email.priority);

  res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) });
});

module.exports = router;
