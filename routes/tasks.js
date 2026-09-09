'use strict';

const express = require('express');
const { db } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

const PRIORITY_ORDER = "CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END";

router.get('/', (req, res) => {
  const includeDone = req.query.all === '1';
  const tasks = db.prepare(`
    SELECT t.*, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.user_id = ? AND (? = 1 OR t.done = 0)
    ORDER BY t.done, (t.due_date IS NULL), t.due_date, ${PRIORITY_ORDER}
  `).all(req.user.id, includeDone ? 1 : 0);
  res.json({ tasks });
});

router.post('/', (req, res) => {
  const { title, due_date, priority, client_id } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: "Il titolo dell'attività è obbligatorio" });

  const info = db.prepare(`
    INSERT INTO tasks (user_id, client_id, title, due_date, priority) VALUES (?,?,?,?,?)
  `).run(req.user.id, client_id || null, title.trim(), due_date || null,
    ['alta', 'media', 'bassa'].includes(priority) ? priority : 'media');

  res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Attività non trovata' });

  const b = req.body || {};
  db.prepare(`
    UPDATE tasks SET title = ?, due_date = ?, priority = ?, done = ? WHERE id = ? AND user_id = ?
  `).run(
    b.title?.trim() || task.title,
    b.due_date !== undefined ? (b.due_date || null) : task.due_date,
    ['alta', 'media', 'bassa'].includes(b.priority) ? b.priority : task.priority,
    b.done === undefined ? task.done : (b.done ? 1 : 0),
    task.id, req.user.id,
  );

  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Attività non trovata' });
  res.json({ ok: true });
});

module.exports = router;
