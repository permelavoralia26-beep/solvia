'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

// In produzione impostare SOLVIA_SECRET come variabile d'ambiente.
// In sviluppo generiamo un segreto casuale ad ogni avvio (le sessioni scadono al riavvio).
const SECRET = process.env.SOLVIA_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = '7d';
const COOKIE = 'solvia_token';

/**
 * La sessione porta con sé la "versione" dell'account al momento in cui è nata.
 * Al cambio password la versione viene incrementata: tutti i token emessi prima
 * smettono di valere, quindi le sessioni aperte altrove si chiudono da sole.
 */
function issueToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, tv: user.token_version || 0 },
    SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

function readUserFromRequest(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.[COOKIE] || bearer;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) return null;
    // Token emesso prima dell'ultimo cambio password: non vale più.
    if ((payload.tv || 0) !== (user.token_version || 0)) return null;
    return user;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  if (!user.is_admin) return res.status(403).json({ error: 'Sezione riservata all\'amministratore' });
  req.user = user;
  next();
}

/* ------------------------------------------------------------------ */
/* Protezione dai tentativi di accesso ripetuti                        */
/* ------------------------------------------------------------------ */

/**
 * Conteggio in memoria dei tentativi falliti, per coppia email+IP.
 * Dopo MAX_TENTATIVI errori l'accesso è bloccato per BLOCCO_MS.
 *
 * È volutamente in memoria: si azzera al riavvio del server e non tocca il
 * database. Serve a fermare chi prova migliaia di password una dopo l'altra,
 * non a punire chi sbaglia a digitare — bastano pochi minuti di attesa.
 */
const MAX_TENTATIVI = 5;
const FINESTRA_MS = 15 * 60 * 1000;
const BLOCCO_MS = 15 * 60 * 1000;
const tentativi = new Map();

const chiaveTentativi = (email, ip) => `${String(email || '').toLowerCase()}|${ip || ''}`;

/** Secondi di attesa rimanenti, o 0 se l'accesso è consentito. */
function attesaResidua(email, ip) {
  const voce = tentativi.get(chiaveTentativi(email, ip));
  if (!voce || !voce.bloccatoFino) return 0;
  const residuo = voce.bloccatoFino - Date.now();
  return residuo > 0 ? Math.ceil(residuo / 1000) : 0;
}

function registraFallimento(email, ip) {
  const chiave = chiaveTentativi(email, ip);
  const ora = Date.now();
  const voce = tentativi.get(chiave);
  // Tentativi vecchi oltre la finestra: si riparte da capo.
  const conteggio = voce && ora - voce.primo < FINESTRA_MS ? voce.conteggio + 1 : 1;
  tentativi.set(chiave, {
    conteggio,
    primo: conteggio === 1 ? ora : voce.primo,
    bloccatoFino: conteggio >= MAX_TENTATIVI ? ora + BLOCCO_MS : null,
  });
  // Pulizia opportunistica: evita che la mappa cresca all'infinito.
  if (tentativi.size > 5000) {
    for (const [k, v] of tentativi) {
      if (ora - v.primo > FINESTRA_MS && (!v.bloccatoFino || v.bloccatoFino < ora)) tentativi.delete(k);
    }
  }
}

const azzeraTentativi = (email, ip) => tentativi.delete(chiaveTentativi(email, ip));

module.exports = {
  issueToken, setAuthCookie, clearAuthCookie, readUserFromRequest,
  requireAuth, requireAdmin, COOKIE,
  attesaResidua, registraFallimento, azzeraTentativi, MAX_TENTATIVI,
};
