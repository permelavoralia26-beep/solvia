'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, logActivity } = require('../lib/db');
const analytics = require('../lib/analytics');
const {
  issueToken, setAuthCookie, clearAuthCookie, requireAuth,
  attesaResidua, registraFallimento, azzeraTentativi,
} = require('../lib/auth');
const account = require('../lib/account');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, business_name: u.business_name,
  vat_number: u.vat_number, address: u.address, default_vat: u.default_vat,
  is_admin: Boolean(u.is_admin), theme: u.theme,
  reminders_enabled: Boolean(u.reminders_enabled), hourly_rate: u.hourly_rate,
  onboarded: Boolean(u.onboarded_at), demo_data: Boolean(u.demo_data),
  last_login_at: u.last_login_at, created_at: u.created_at,
  studio_role: u.studio_role, studio_id: u.studio_id,
});

router.post('/register', (req, res) => {
  const { email, password, name, business_name } = req.body || {};

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Inserisci un indirizzo email valido' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Inserisci il tuo nome' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Esiste già un account con questa email' });

  // Il primo account registrato è l'amministratore (gestisce la newsletter).
  // In alternativa si può fissare l'indirizzo con SOLVIA_ADMIN_EMAIL.
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const adminEmail = (process.env.SOLVIA_ADMIN_EMAIL || '').toLowerCase();
  const isAdmin = (adminEmail ? email.toLowerCase() === adminEmail : isFirstUser) ? 1 : 0;

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, name, business_name, is_admin) VALUES (?,?,?,?,?)',
  ).run(email.toLowerCase(), hash, name.trim(), business_name?.trim() || null, isAdmin);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  // Nessun dato di esempio automatico: la scelta è del nuovo utente, nella
  // schermata di benvenuto (onboarded_at resta NULL finché non la completa).
  logActivity(user.id, 'Account creato — benvenuto in Solvia', 'star');
  analytics.registra('registrazione', { userId: user.id, req });

  setAuthCookie(res, issueToken(user));
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const ip = req.ip;

  const attesa = attesaResidua(email, ip);
  if (attesa > 0) {
    return res.status(429).json({
      error: `Troppi tentativi. Riprova tra ${Math.ceil(attesa / 60)} minuti.`,
      retryAfter: attesa,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    registraFallimento(email, ip);
    // Stesso messaggio in entrambi i casi: non si rivela quali email esistono.
    return res.status(401).json({ error: 'Email o password non corretti' });
  }

  azzeraTentativi(email, ip);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  setAuthCookie(res, issueToken(user));
  res.json({ user: publicUser(user) });
});

/* ---------------------------------------------------------------- */
/* Password                                                          */
/* ---------------------------------------------------------------- */

/**
 * Cambio password da dentro l'app.
 * Risponde 403 (non 401) se la password attuale è sbagliata: un 401 verrebbe
 * interpretato dal client come sessione scaduta e butterebbe fuori l'utente
 * per un semplice errore di battitura.
 */
router.post('/password', requireAuth, (req, res) => {
  const { current, password } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) {
    return res.status(403).json({ error: 'La password attuale non è corretta' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
  }
  if (bcrypt.compareSync(password, req.user.password_hash)) {
    return res.status(400).json({ error: 'La nuova password è uguale a quella attuale' });
  }

  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), req.user.id);
  logActivity(req.user.id, 'Password modificata', 'star');

  // La sessione corrente viene riemessa con la nuova versione: chi ha cambiato
  // la password resta dentro, tutte le altre sessioni aperte decadono.
  const aggiornato = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  setAuthCookie(res, issueToken(aggiornato));
  res.json({ ok: true, message: 'Password aggiornata. Le altre sessioni sono state disconnesse.' });
});

/* Richiesta del link di recupero. Risponde sempre allo stesso modo. */
router.post('/password/richiesta', async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    await account.richiediReimpostazione(req.body?.email, origin);
  } catch (e) {
    console.error('Invio email di recupero non riuscito:', e.message);
  }
  res.json({
    ok: true,
    message: 'Se esiste un account con questa email, riceverai il link tra pochi istanti.',
  });
});

/* Il modulo di reimpostazione chiede prima se il link è ancora buono. */
router.get('/password/verifica', (req, res) => {
  res.json({ valido: Boolean(account.verificaToken(req.query.token)) });
});

router.post('/password/reimposta', (req, res) => {
  const esito = account.reimpostaPassword(req.body?.token, req.body?.password);
  if (!esito.ok) return res.status(400).json({ error: esito.error });
  res.json({ ok: true, message: 'Password aggiornata. Ora puoi accedere.' });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put('/me', requireAuth, (req, res) => {
  const { name, business_name, vat_number, address, default_vat, theme, reminders_enabled, hourly_rate } = req.body || {};
  db.prepare(`
    UPDATE users SET name = ?, business_name = ?, vat_number = ?, address = ?, default_vat = ?,
      theme = ?, reminders_enabled = ?, hourly_rate = ?
    WHERE id = ?
  `).run(
    name?.trim() || req.user.name,
    business_name !== undefined ? (business_name?.trim() || null) : req.user.business_name,
    vat_number !== undefined ? (vat_number?.trim() || null) : req.user.vat_number,
    address !== undefined ? (address?.trim() || null) : req.user.address,
    Number.isFinite(Number(default_vat)) ? Number(default_vat) : req.user.default_vat,
    ['chiaro', 'scuro'].includes(theme) ? theme : req.user.theme,
    reminders_enabled === undefined ? req.user.reminders_enabled : (reminders_enabled ? 1 : 0),
    Number.isFinite(Number(hourly_rate)) ? Number(hourly_rate) : req.user.hourly_rate,
    req.user.id,
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;
