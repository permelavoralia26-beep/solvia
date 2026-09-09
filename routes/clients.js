'use strict';

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const { checkLimit } = require('../lib/billing');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

router.get('/', (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const clients = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id AND d.kind = 'fattura') AS invoice_count,
      (SELECT COALESCE(SUM(d.total),0) FROM documents d
         WHERE d.client_id = c.id AND d.kind = 'fattura' AND d.status = 'pagata') AS revenue
    FROM clients c
    WHERE c.user_id = ?
      AND (? = '%%' OR lower(c.name) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ?)
    ORDER BY c.name COLLATE NOCASE
  `).all(req.user.id, q, q, q);
  res.json({ clients });
});

router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Cliente non trovato' });

  const documents = db.prepare(
    'SELECT * FROM documents WHERE client_id = ? AND user_id = ? ORDER BY issue_date DESC',
  ).all(client.id, req.user.id);
  res.json({ client, documents });
});

router.post('/', (req, res) => {
  const { name, email, phone, vat_number, address, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Il nome del cliente è obbligatorio' });

  const check = checkLimit(req.user, 'client');
  if (!check.allowed) return res.status(402).json({ error: check.reason, upgrade: true, ...check });

  const info = db.prepare(`
    INSERT INTO clients (user_id, name, email, phone, vat_number, address, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.id, name.trim(), email?.trim() || null, phone?.trim() || null,
    vat_number?.trim() || null, address?.trim() || null, notes?.trim() || null);

  logActivity(req.user.id, `Nuovo cliente aggiunto: ${name.trim()}`, 'user');
  res.status(201).json({ client: db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Cliente non trovato' });

  const { name, email, phone, vat_number, address, notes } = req.body || {};
  db.prepare(`
    UPDATE clients SET name = ?, email = ?, phone = ?, vat_number = ?, address = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `).run(name?.trim() || client.name, email?.trim() || null, phone?.trim() || null,
    vat_number?.trim() || null, address?.trim() || null, notes?.trim() || null,
    client.id, req.user.id);

  res.json({ client: db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Cliente non trovato' });
  res.json({ ok: true });
});

/** Genera il link del portale: il cliente vede lì tutti i suoi documenti. */
router.post('/:id/portale', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Cliente non trovato' });

  const token = require('crypto').randomBytes(32).toString('hex');
  db.prepare('UPDATE clients SET portal_token = ? WHERE id = ? AND user_id = ?')
    .run(token, client.id, req.user.id);

  logActivity(req.user.id, `Portale attivato per ${client.name}`, 'user');
  res.json({ token, url: `${req.protocol}://${req.get('host')}/c/${token}` });
});

router.delete('/:id/portale', (req, res) => {
  const info = db.prepare('UPDATE clients SET portal_token = NULL WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Cliente non trovato' });
  res.json({ ok: true });
});

module.exports = router;
