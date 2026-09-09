'use strict';

/**
 * Newsletter con doppia conferma (double opt-in).
 *
 * Perché la doppia conferma non è facoltativa: in Italia il Garante richiede un
 * consenso dimostrabile. Con la sola casella spuntata sul sito chiunque potrebbe
 * iscrivere l'indirizzo di un altro, e non avresti prova del consenso. Con la
 * conferma via email, l'iscrizione è valida solo dopo che il titolare della
 * casella ha cliccato: la prova esiste ed è registrata (data, IP, testo del consenso).
 */

const crypto = require('crypto');
const { db } = require('./db');
const { sendMail } = require('./mailer');

const token = () => crypto.randomBytes(24).toString('hex');
const normalize = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email);

const CONSENT_TEXT =
  'Acconsento a ricevere la newsletter di Solvia (aggiornamenti sul progetto e '
  + 'consigli sulla gestione amministrativa). Posso disiscrivermi in qualsiasi '
  + 'momento dal link presente in ogni email.';

/* ------------------------------------------------------------------ */
/* Iscrizione                                                          */
/* ------------------------------------------------------------------ */

/**
 * Registra la richiesta di iscrizione e invia l'email di conferma.
 * Restituisce sempre lo stesso esito verso l'esterno per non rivelare
 * se un indirizzo è già iscritto (evita di usare il modulo come sonda).
 */
async function subscribe({ email, name, consent, ip, agent, origin, source = 'sito' }) {
  const address = normalize(email);

  if (!isValidEmail(address)) {
    return { ok: false, error: 'Inserisci un indirizzo email valido' };
  }
  if (!consent) {
    return { ok: false, error: 'Per iscriverti devi accettare l\'informativa privacy' };
  }

  const existing = db.prepare('SELECT * FROM newsletter_subscribers WHERE email = ?').get(address);

  // Già confermato: non reinviamo nulla, ma rispondiamo come se fosse tutto ok.
  if (existing && existing.status === 'confermato') {
    return { ok: true, alreadyConfirmed: true };
  }

  let record;
  if (existing) {
    // In attesa o disiscritto che torna: nuovo token e nuovo consenso registrato.
    db.prepare(`
      UPDATE newsletter_subscribers
      SET name = ?, status = 'in_attesa', confirm_token = ?, consent_text = ?,
          signup_ip = ?, signup_agent = ?, created_at = datetime('now'),
          confirmed_at = NULL, unsubscribed_at = NULL
      WHERE id = ?
    `).run(name?.trim() || existing.name, token(), CONSENT_TEXT, ip, agent, existing.id);
    record = db.prepare('SELECT * FROM newsletter_subscribers WHERE id = ?').get(existing.id);
  } else {
    const info = db.prepare(`
      INSERT INTO newsletter_subscribers
        (email, name, confirm_token, unsubscribe_token, consent_text, signup_ip, signup_agent, source)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(address, name?.trim() || null, token(), token(), CONSENT_TEXT, ip, agent, source);
    record = db.prepare('SELECT * FROM newsletter_subscribers WHERE id = ?').get(info.lastInsertRowid);
  }

  require('./analytics').registra('newsletter_iscrizione', { label: source });

  const link = `${origin}/newsletter/conferma?t=${record.confirm_token}`;
  await sendMail({
    to: address,
    subject: 'Conferma la tua iscrizione alla newsletter di Solvia',
    text:
`Ciao${record.name ? ` ${record.name}` : ''},

hai chiesto di iscriverti alla newsletter di Solvia.

Per completare l'iscrizione conferma che questo indirizzo è tuo:

${link}

Se non sei stato tu, ignora questa email: senza la conferma non riceverai nulla
e l'indirizzo verrà rimosso.

—
Solvia — progetto personale, non commerciale
Ti abbiamo scritto solo per confermare l'iscrizione richiesta da questo indirizzo.`,
  });

  return { ok: true, alreadyConfirmed: false };
}

/** Conferma l'iscrizione tramite il token ricevuto per email. */
function confirm(confirmToken) {
  const sub = db.prepare('SELECT * FROM newsletter_subscribers WHERE confirm_token = ?')
    .get(String(confirmToken || ''));
  if (!sub) return { ok: false, error: 'Link di conferma non valido o già utilizzato' };

  if (sub.status === 'confermato') {
    return { ok: true, already: true, unsubscribeToken: sub.unsubscribe_token };
  }

  db.prepare(`
    UPDATE newsletter_subscribers
    SET status = 'confermato', confirmed_at = datetime('now'), confirm_token = ?
    WHERE id = ?
  `).run(token(), sub.id);   // token rigenerato: il link usato non è riutilizzabile

  require('./analytics').registra('newsletter_conferma', { label: 'sito' });

  return { ok: true, already: false, unsubscribeToken: sub.unsubscribe_token };
}

/** Disiscrizione con un solo clic, senza login. */
function unsubscribe(unsubToken) {
  const sub = db.prepare('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token = ?')
    .get(String(unsubToken || ''));
  if (!sub) return { ok: false, error: 'Link di disiscrizione non valido' };

  if (sub.status !== 'disiscritto') {
    db.prepare(`
      UPDATE newsletter_subscribers
      SET status = 'disiscritto', unsubscribed_at = datetime('now') WHERE id = ?
    `).run(sub.id);
  }
  return { ok: true, email: sub.email };
}

/** Cancellazione definitiva dell'indirizzo (diritto all'oblio, art. 17 GDPR). */
function erase(unsubToken) {
  const info = db.prepare('DELETE FROM newsletter_subscribers WHERE unsubscribe_token = ?')
    .run(String(unsubToken || ''));
  return { ok: info.changes > 0 };
}

/* ------------------------------------------------------------------ */
/* Campagne                                                            */
/* ------------------------------------------------------------------ */

const stats = () => db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'confermato' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN status = 'in_attesa' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status = 'disiscritto' THEN 1 ELSE 0 END) AS unsubscribed
  FROM newsletter_subscribers
`).get();

const listSubscribers = (limit = 200) => db.prepare(`
  SELECT id, email, name, status, source, created_at, confirmed_at, unsubscribed_at
  FROM newsletter_subscribers ORDER BY created_at DESC LIMIT ?
`).all(limit);

const listCampaigns = () => db.prepare(
  'SELECT * FROM newsletter_campaigns ORDER BY created_at DESC',
).all();

function createCampaign(subject, body) {
  if (!subject?.trim()) return { ok: false, error: 'Inserisci l\'oggetto' };
  if (!body?.trim()) return { ok: false, error: 'Inserisci il testo della newsletter' };
  const info = db.prepare('INSERT INTO newsletter_campaigns (subject, body) VALUES (?,?)')
    .run(subject.trim(), body.trim());
  return { ok: true, campaign: db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(info.lastInsertRowid) };
}

function updateCampaign(id, subject, body) {
  const campaign = db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id);
  if (!campaign) return { ok: false, error: 'Campagna non trovata' };
  if (campaign.status === 'inviata') return { ok: false, error: 'Una campagna già inviata non si modifica' };

  db.prepare('UPDATE newsletter_campaigns SET subject = ?, body = ? WHERE id = ?')
    .run(subject?.trim() || campaign.subject, body?.trim() || campaign.body, id);
  return { ok: true, campaign: db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id) };
}

function deleteCampaign(id) {
  const info = db.prepare("DELETE FROM newsletter_campaigns WHERE id = ? AND status = 'bozza'").run(id);
  return { ok: info.changes > 0 };
}

/**
 * Invia una campagna a tutti gli iscritti confermati.
 * Ogni email include il link di disiscrizione personale e l'intestazione
 * List-Unsubscribe, che i client di posta usano per mostrare il pulsante
 * "Annulla iscrizione" — riduce molto le segnalazioni di spam.
 */
async function sendCampaign(id, origin, { testTo = null } = {}) {
  const campaign = db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id);
  if (!campaign) return { ok: false, error: 'Campagna non trovata' };
  if (!testTo && campaign.status === 'inviata') {
    return { ok: false, error: 'Campagna già inviata' };
  }

  const recipients = testTo
    ? [{ email: testTo, name: null, unsubscribe_token: 'anteprima' }]
    : db.prepare("SELECT * FROM newsletter_subscribers WHERE status = 'confermato'").all();

  if (!recipients.length) return { ok: false, error: 'Nessun iscritto confermato a cui inviare' };

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const unsubLink = `${origin}/newsletter/disiscriviti?t=${r.unsubscribe_token}`;
    try {
      await sendMail({
        to: r.email,
        subject: campaign.subject,
        headers: { 'List-Unsubscribe': `<${unsubLink}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        text:
`${r.name ? `Ciao ${r.name},\n\n` : ''}${campaign.body}

—
Ricevi questa email perché ti sei iscritto alla newsletter di Solvia e hai
confermato il tuo indirizzo.

Non vuoi più riceverla? Disiscriviti qui:
${unsubLink}

Solvia — progetto personale, non commerciale`,
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  if (!testTo) {
    db.prepare(`
      UPDATE newsletter_campaigns
      SET status = 'inviata', sent_count = ?, failed_count = ?, sent_at = datetime('now')
      WHERE id = ?
    `).run(sent, failed, id);
  }

  return { ok: true, sent, failed, test: Boolean(testTo) };
}

module.exports = {
  subscribe, confirm, unsubscribe, erase, stats, listSubscribers,
  listCampaigns, createCampaign, updateCampaign, deleteCampaign, sendCampaign,
  CONSENT_TEXT,
};
