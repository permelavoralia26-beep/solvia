'use strict';

/**
 * Recupero della password.
 *
 * Il token viaggia per email in chiaro, ma nel database ne resta solo
 * l'impronta SHA-256: se qualcuno leggesse la tabella non potrebbe comunque
 * usarla per entrare in un account.
 *
 * Il token vale un'ora e una volta sola. Dopo l'uso viene marcato come
 * consumato e tutte le altre richieste pendenti dello stesso utente vengono
 * annullate, così un vecchio messaggio nella casella non resta utilizzabile.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, logActivity } = require('./db');
const { sendMail } = require('./mailer');

const DURATA_MINUTI = 60;

const impronta = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Crea una richiesta e invia l'email. Non rivela mai se l'indirizzo esiste:
 * chi chiama riceve sempre lo stesso esito.
 */
async function richiediReimpostazione(email, origin) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email || '').toLowerCase().trim());
  if (!user) return { inviata: false };

  const token = crypto.randomBytes(32).toString('hex');
  const scadenza = new Date(Date.now() + DURATA_MINUTI * 60 * 1000).toISOString();

  db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
    .run(user.id, impronta(token), scadenza);

  const link = `${origin}/reimposta.html?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reimposta la password di Solvia',
    text: [
      `Ciao ${user.name},`,
      '',
      'hai chiesto di reimpostare la password del tuo account Solvia.',
      `Apri questo link entro ${DURATA_MINUTI} minuti:`,
      '',
      link,
      '',
      'Se non sei stato tu, ignora questo messaggio: la password resta quella di prima',
      'e nessuno può entrare nel tuo account con questa email.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6;color:#0F172A">
        <p>Ciao ${user.name},</p>
        <p>hai chiesto di reimpostare la password del tuo account Solvia.</p>
        <p style="margin:26px 0">
          <a href="${link}" style="background:#4F46E5;color:#fff;padding:12px 22px;
             border-radius:9px;text-decoration:none;font-weight:600">Scegli una nuova password</a>
        </p>
        <p style="font-size:13px;color:#64748B">Il link vale ${DURATA_MINUTI} minuti e una volta sola.</p>
        <p style="font-size:13px;color:#64748B">Se non sei stato tu, ignora questo messaggio:
        la password resta quella di prima.</p>
      </div>`,
  });

  return { inviata: true, token };
}

/** Verifica un token senza consumarlo. Serve alla pagina, prima di mostrare il modulo. */
function verificaToken(token) {
  if (!token) return null;
  const riga = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(impronta(token));
  if (!riga || riga.used_at) return null;
  if (new Date(riga.expires_at).getTime() < Date.now()) return null;
  return riga;
}

/**
 * Consuma il token e imposta la nuova password.
 * Incrementa token_version: tutte le sessioni aperte decadono, anche quelle di
 * chi eventualmente fosse entrato senza permesso.
 */
function reimpostaPassword(token, nuova) {
  const riga = verificaToken(token);
  if (!riga) return { ok: false, error: 'Link non valido o scaduto. Chiedine uno nuovo.' };
  if (!nuova || nuova.length < 8) {
    return { ok: false, error: 'La password deve avere almeno 8 caratteri' };
  }

  db.prepare(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
  ).run(bcrypt.hashSync(nuova, 10), riga.user_id);

  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(riga.id);
  // Annulla le altre richieste pendenti dello stesso utente.
  db.prepare(
    "UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL",
  ).run(riga.user_id);

  logActivity(riga.user_id, 'Password reimpostata dal link via email', 'star');
  return { ok: true };
}

module.exports = { richiediReimpostazione, verificaToken, reimpostaPassword, DURATA_MINUTI };
