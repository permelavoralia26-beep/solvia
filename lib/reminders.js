'use strict';

/**
 * Solleciti di pagamento.
 *
 * Il tono cresce con il ritardo, ma resta sempre professionale: un cliente che
 * paga in ritardo spesso è un cliente che vuoi tenere. Nessun sollecito parte
 * da solo — vengono preparati e restano in attesa della tua approvazione,
 * coerentemente con il resto dell'applicazione.
 */

const { db, logActivity } = require('./db');
const { sendMail } = require('./mailer');
const { formatEUR } = require('./totals');

/** Livelli di sollecito: giorni di ritardo → tono. */
const LEVELS = [
  {
    level: 1,
    afterDays: 3,
    label: 'Promemoria gentile',
    subject: (d) => `Promemoria: fattura ${d.number}`,
    body: (d, client, user) =>
`Gentile ${client?.name || 'cliente'},

le scrivo per un semplice promemoria: la fattura ${d.number} del ${dmy(d.issue_date)},
di ${formatEUR(d.total)}, risultava in scadenza il ${dmy(d.due_date)}.

Se il pagamento è già stato disposto, la ringrazio e la preghiamo di ignorare
questo messaggio: i tempi bancari a volte non coincidono.

Se invece le serve una copia del documento o un chiarimento, me lo faccia sapere:
sono a disposizione.

Cordiali saluti,
${user.name}${user.business_name ? `\n${user.business_name}` : ''}`,
  },
  {
    level: 2,
    afterDays: 14,
    label: 'Secondo sollecito',
    subject: (d) => `Sollecito: fattura ${d.number} scaduta`,
    body: (d, client, user) =>
`Gentile ${client?.name || 'cliente'},

torno a scriverle riguardo alla fattura ${d.number} di ${formatEUR(d.total)},
scaduta il ${dmy(d.due_date)} e a oggi non ancora saldata.

Le chiedo cortesemente di verificare la posizione e, se possibile, di indicarmi
una data indicativa per il pagamento. Se ci fossero problemi con il documento o
difficoltà momentanee, mi faccia un cenno: troviamo una soluzione insieme.

Cordiali saluti,
${user.name}${user.business_name ? `\n${user.business_name}` : ''}`,
  },
  {
    level: 3,
    afterDays: 30,
    label: 'Sollecito formale',
    subject: (d) => `Sollecito formale: fattura ${d.number}`,
    body: (d, client, user) =>
`Gentile ${client?.name || 'cliente'},

la fattura ${d.number}, di ${formatEUR(d.total)}, risulta scaduta da oltre 30 giorni
(termine di pagamento: ${dmy(d.due_date)}) e non ancora saldata, nonostante i
precedenti solleciti.

La invito a provvedere al pagamento entro 7 giorni dal ricevimento di questa
comunicazione, o in alternativa a contattarmi per concordare un piano di rientro.

Resto in attesa di un suo riscontro.

Cordiali saluti,
${user.name}${user.business_name ? `\n${user.business_name}` : ''}`,
  },
];

function dmy(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const daysOverdue = (dueDate) =>
  Math.floor((Date.now() - new Date(`${dueDate}T00:00:00Z`).getTime()) / 86400000);

/**
 * Prepara i solleciti mancanti per le fatture scadute di un utente.
 * Non invia nulla: crea le bozze in stato "da_approvare".
 */
function prepareForUser(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.reminders_enabled) return { prepared: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const overdue = db.prepare(`
    SELECT d.*, c.name AS client_name, c.email AS client_email
    FROM documents d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.user_id = ? AND d.kind = 'fattura' AND d.status = 'inviata'
      AND d.due_date IS NOT NULL AND d.due_date < ?
  `).all(userId, today);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO reminders (user_id, document_id, level, subject, body)
    VALUES (?,?,?,?,?)
  `);

  let prepared = 0;
  for (const doc of overdue) {
    const late = daysOverdue(doc.due_date);
    // Si prepara solo il livello più alto raggiunto: niente raffiche di email.
    const due = [...LEVELS].reverse().find((l) => late >= l.afterDays);
    if (!due) continue;

    const client = { name: doc.client_name, email: doc.client_email };
    const info = insert.run(userId, doc.id, due.level,
      due.subject(doc), due.body(doc, client, user));
    if (info.changes) prepared += 1;
  }

  if (prepared) {
    logActivity(userId, `${prepared} solleciti pronti da approvare`, 'mail');
  }
  return { prepared };
}

/** Elenco dei solleciti con i dati della fattura collegata. */
const list = (userId, status = null) => db.prepare(`
  SELECT r.*, d.number, d.total, d.due_date, c.name AS client_name, c.email AS client_email
  FROM reminders r
  JOIN documents d ON d.id = r.document_id
  LEFT JOIN clients c ON c.id = d.client_id
  WHERE r.user_id = ? AND (? IS NULL OR r.status = ?)
  ORDER BY r.level DESC, r.created_at DESC
`).all(userId, status, status);

/** Approva e invia un sollecito. */
async function send(userId, reminderId) {
  const r = db.prepare(`
    SELECT r.*, c.email AS client_email, c.name AS client_name, d.number
    FROM reminders r
    JOIN documents d ON d.id = r.document_id
    LEFT JOIN clients c ON c.id = d.client_id
    WHERE r.id = ? AND r.user_id = ?
  `).get(reminderId, userId);

  if (!r) return { ok: false, error: 'Sollecito non trovato' };
  if (r.status === 'inviato') return { ok: false, error: 'Sollecito già inviato' };
  if (!r.client_email) {
    return { ok: false, error: 'Il cliente non ha un indirizzo email: aggiungilo in anagrafica' };
  }

  await sendMail({ to: r.client_email, subject: r.subject, text: r.body });
  db.prepare("UPDATE reminders SET status = 'inviato', sent_at = datetime('now') WHERE id = ?")
    .run(r.id);
  logActivity(userId, `Sollecito inviato a ${r.client_name} per ${r.number}`, 'mail');

  return { ok: true };
}

function dismiss(userId, reminderId) {
  const info = db.prepare(
    "UPDATE reminders SET status = 'annullato' WHERE id = ? AND user_id = ? AND status = 'da_approvare'",
  ).run(reminderId, userId);
  return { ok: info.changes > 0 };
}

function updateText(userId, reminderId, subject, body) {
  const info = db.prepare(`
    UPDATE reminders SET subject = COALESCE(?, subject), body = COALESCE(?, body)
    WHERE id = ? AND user_id = ? AND status = 'da_approvare'
  `).run(subject?.trim() || null, body?.trim() || null, reminderId, userId);
  return { ok: info.changes > 0 };
}

module.exports = { prepareForUser, list, send, dismiss, updateText, LEVELS, daysOverdue };
