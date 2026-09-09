'use strict';

const express = require('express');
const { db } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { studioCondiviso } = require('../lib/studio');
const { MODE } = require('../lib/assistant');
const tax = require('../lib/tax');

const router = express.Router();
router.use(requireAuth, studioCondiviso);

/** Stima delle tasse sull'incassato dell'anno in corso. */
function taxEstimate(user) {
  const year = new Date().getFullYear();
  const collected = db.prepare(`
    SELECT COALESCE(SUM(subtotal),0) AS v FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'pagata' AND paid_at LIKE ?
  `).get(user.id, `${year}%`).v;

  return tax.estimate(collected, {
    tax_regime: user.tax_regime,
    tax_coefficient: user.tax_coefficient,
    tax_rate: user.tax_rate,
    inps_type: user.inps_type,
    inps_reduction: user.inps_reduction,
  });
}

router.get('/', (req, res) => {
  const uid = req.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const one = (sql, ...params) => db.prepare(sql).get(uid, ...params);

  const paidThisMonth = one(`
    SELECT COALESCE(SUM(total),0) AS v FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'pagata' AND paid_at >= ?
  `, monthStart).v;

  const outstanding = one(`
    SELECT COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'inviata'
  `);

  const overdue = one(`
    SELECT COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'inviata' AND due_date < ?
  `, today);

  const openQuotes = one(`
    SELECT COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM documents
    WHERE user_id = ? AND kind = 'preventivo' AND status IN ('bozza','inviata')
  `);

  const clients = one('SELECT COUNT(*) AS n FROM clients WHERE user_id = ?').n;
  const openTasks = one('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND done = 0').n;
  const tasksToday = one(
    'SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND done = 0 AND due_date <= ?', today).n;
  const inboxPending = one(
    "SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND status = 'da_leggere'").n;
  const draftsReady = one(
    "SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND status = 'bozza_pronta'").n;

  // Andamento incassi: sempre gli ultimi 6 mesi, anche quelli senza incassi,
  // così il grafico resta leggibile e confrontabile nel tempo.
  const paidByMonth = new Map(db.prepare(`
    SELECT substr(paid_at,1,7) AS month, COALESCE(SUM(total),0) AS total
    FROM documents
    WHERE user_id = ? AND kind = 'fattura' AND status = 'pagata' AND paid_at IS NOT NULL
    GROUP BY month
  `).all(uid).map((r) => [r.month, r.total]));

  const revenueByMonth = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() - i);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    revenueByMonth.push({ month, total: paidByMonth.get(month) || 0 });
  }

  const topClients = db.prepare(`
    SELECT c.name, COALESCE(SUM(d.total),0) AS total
    FROM clients c JOIN documents d ON d.client_id = c.id
    WHERE c.user_id = ? AND d.kind = 'fattura' AND d.status = 'pagata'
    GROUP BY c.id ORDER BY total DESC LIMIT 5
  `).all(uid);

  const expensesThisYear = one(
    "SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE user_id = ? AND spent_on LIKE ?",
    `${today.slice(0, 4)}%`).v;

  const pendingReminders = one(
    "SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND status = 'da_approvare'").n;

  const recurringMonthly = db.prepare(`
    SELECT COALESCE(SUM(
      (SELECT COALESCE(SUM(ri.quantity * ri.unit_price), 0) * (1 + r.vat_rate / 100.0)
       FROM recurring_items ri WHERE ri.recurring_id = r.id)
      / CASE r.frequency
          WHEN 'mensile' THEN 1 WHEN 'bimestrale' THEN 2 WHEN 'trimestrale' THEN 3
          WHEN 'semestrale' THEN 6 ELSE 12 END
    ), 0) AS v
    FROM recurring r WHERE r.user_id = ? AND r.active = 1
  `).get(uid).v;

  const sharedQuotes = db.prepare(`
    SELECT number, viewed_at, status FROM documents
    WHERE user_id = ? AND kind = 'preventivo' AND public_token IS NOT NULL
    ORDER BY shared_at DESC LIMIT 4
  `).all(uid);

  const activity = db.prepare(
    'SELECT * FROM activity WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 8',
  ).all(uid);

  const upcomingTasks = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND done = 0
    ORDER BY (due_date IS NULL), due_date,
      CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END LIMIT 5
  `).all(uid);

  res.json({
    stats: {
      paidThisMonth,
      outstanding: outstanding.v, outstandingCount: outstanding.n,
      overdue: overdue.v, overdueCount: overdue.n,
      openQuotes: openQuotes.v, openQuotesCount: openQuotes.n,
      clients, openTasks, tasksToday, inboxPending, draftsReady,
      expensesThisYear, pendingReminders, recurringMonthly,
    },
    revenueByMonth, topClients, activity, upcomingTasks, sharedQuotes,
    tax: taxEstimate(req.user),
    assistantMode: MODE,
  });
});

module.exports = router;
