'use strict';

/**
 * Studio condiviso — la sostanza del piano Team.
 *
 * Più persone lavorano sugli stessi clienti, preventivi e fatture. Chi entra
 * non porta con sé un archivio separato: entra in quello che c'è già.
 *
 * Come sta in piedi senza riscrivere mezzo programma: i dati sono sempre stati
 * legati a `user_id`. In uno studio quel valore è l'id del **titolare**, e
 * basta. Un collaboratore autenticato, quando tocca le rotte dei dati, lavora
 * con l'identità dello studio (`req.user` = riga del titolare), mentre la
 * persona reale resta in `req.attore` per il registro attività e per i
 * controlli sui permessi.
 *
 * Il vantaggio non è la comodità: è che nessuna interrogazione al database è
 * stata modificata per far entrare i collaboratori. L'isolamento fra studi
 * diversi resta esattamente quello di prima, già coperto dai test.
 */

const crypto = require('crypto');
const { db, logActivity, conContesto } = require('./db');
const { getPlan } = require('./billing');

const DURATA_INVITO_ORE = 72;

const impronta = (token) => crypto.createHash('sha256').update(token).digest('hex');

/* ------------------------------------------------------------------ */
/* Lettura                                                             */
/* ------------------------------------------------------------------ */

const studioIdDi = (user) => user.studio_id || user.id;

const titolareDi = (user) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(studioIdDi(user));

const membri = (studioId) => db.prepare(`
  SELECT id, name, email, studio_role, last_login_at, created_at
  FROM users WHERE studio_id = ? ORDER BY (studio_role = 'titolare') DESC, name
`).all(studioId);

const invitiAperti = (studioId) => db.prepare(`
  SELECT id, email, created_at, expires_at FROM studio_invites
  WHERE studio_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
    AND expires_at > datetime('now')
  ORDER BY created_at DESC
`).all(studioId);

/** Quanti posti dà il piano dello studio. Free e Pro: uno solo. */
function posti(titolare) {
  const plan = getPlan(titolare.plan);
  return plan.limits?.seats || 1;
}

/** Fotografia completa dello studio, per l'interfaccia. */
function stato(user) {
  const titolare = titolareDi(user);
  const elenco = membri(titolare.id);
  const inviti = invitiAperti(titolare.id);
  const totale = posti(titolare);

  return {
    studioId: titolare.id,
    nomeStudio: titolare.business_name || titolare.name,
    piano: titolare.plan,
    ruolo: user.studio_role,
    sonoTitolare: user.studio_role === 'titolare',
    posti: { totale, usati: elenco.length + inviti.length, liberi: Math.max(0, totale - elenco.length - inviti.length) },
    condivisibile: totale > 1,
    membri: elenco,
    inviti,
  };
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

/**
 * Da montare SOLO sulle rotte dei dati (clienti, documenti, email, attività,
 * finanze, ore, dashboard).
 *
 * NON va montata su account, pagamenti, privacy e newsletter: lì `req.user`
 * deve restare la persona vera, altrimenti un collaboratore che cambia la
 * propria password cambierebbe quella del titolare.
 */
function studioCondiviso(req, res, next) {
  const titolare = titolareDi(req.user);

  if (titolare.id === req.user.id) return next(); // lavora da solo: nulla cambia

  req.attore = { id: req.user.id, name: req.user.name, role: req.user.studio_role };
  // Da qui in poi i dati sono quelli dello studio: intestazione fattura,
  // partita IVA, impostazioni fiscali e piano sono quelli del titolare.
  req.user = titolare;

  // Il nome dell'autore viaggia nel contesto: logActivity lo raccoglie da solo.
  conContesto({ attore: req.attore.name }, next);
}

/** Alcune azioni restano al titolare anche dentro uno studio condiviso. */
function soloTitolare(req, res, next) {
  const ruolo = req.attore ? req.attore.role : req.user.studio_role;
  if (ruolo !== 'titolare') {
    return res.status(403).json({ error: 'Solo il titolare dello studio può farlo' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Inviti                                                              */
/* ------------------------------------------------------------------ */

/**
 * Crea un invito. Non manda l'email: se ne occupa la rotta, che sa l'indirizzo
 * pubblico del sito. Restituisce il token in chiaro una volta sola.
 */
function creaInvito(titolare, emailGrezza, invitanteId) {
  const email = String(emailGrezza || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { errore: 'Inserisci un indirizzo email valido' };
  }

  const totale = posti(titolare);
  if (totale <= 1) {
    return { errore: 'Lo studio condiviso è una funzione del piano Team.', proOnly: true };
  }

  const occupati = membri(titolare.id).length + invitiAperti(titolare.id).length;
  if (occupati >= totale) {
    return { errore: `Hai esaurito i ${totale} posti del piano Team. Libera un posto o rimuovi un invito in sospeso.` };
  }

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return {
      errore: 'Esiste già un account Solvia con questa email. Per entrare in uno studio '
        + 'serve un indirizzo che non abbia ancora un account: così nessun archivio esistente '
        + 'viene spostato o perso.',
    };
  }

  const gia = db.prepare(`
    SELECT id FROM studio_invites WHERE studio_id = ? AND email = ?
      AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now')
  `).get(titolare.id, email);
  if (gia) return { errore: 'C\'è già un invito in sospeso per questo indirizzo' };

  const token = crypto.randomBytes(32).toString('hex');
  const scadenza = new Date(Date.now() + DURATA_INVITO_ORE * 3600 * 1000).toISOString();
  db.prepare(`
    INSERT INTO studio_invites (studio_id, email, token_hash, invited_by, expires_at)
    VALUES (?,?,?,?,?)
  `).run(titolare.id, email, impronta(token), invitanteId, scadenza);

  logActivity(titolare.id, `Invitato ${email} nello studio`, 'star');
  return { token, email, scadenza };
}

/** Legge un invito valido senza consumarlo. */
function leggiInvito(token) {
  if (!token) return null;
  const riga = db.prepare('SELECT * FROM studio_invites WHERE token_hash = ?').get(impronta(token));
  if (!riga || riga.accepted_at || riga.revoked_at) return null;
  if (new Date(riga.expires_at).getTime() < Date.now()) return null;

  const titolare = db.prepare('SELECT * FROM users WHERE id = ?').get(riga.studio_id);
  if (!titolare) return null;
  return { invito: riga, titolare };
}

/**
 * Accetta l'invito creando l'account del collaboratore.
 * L'account nasce già dentro lo studio: niente configurazione iniziale, niente
 * dati di esempio, vede subito il lavoro vero.
 */
function accettaInvito(token, { name, password }, hashPassword) {
  const letto = leggiInvito(token);
  if (!letto) return { errore: 'Invito non valido o scaduto. Chiedine uno nuovo al titolare.' };
  if (!name || !name.trim()) return { errore: 'Inserisci il tuo nome' };
  if (!password || password.length < 8) {
    return { errore: 'La password deve avere almeno 8 caratteri' };
  }

  const { invito, titolare } = letto;

  // I posti si ricontrollano adesso: fra l'invito e l'accettazione il piano
  // può essere stato disdetto, o i posti riempiti da qualcun altro.
  if (membri(titolare.id).length >= posti(titolare)) {
    return { errore: 'Lo studio non ha più posti liberi. Contatta il titolare.' };
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(invito.email)) {
    return { errore: 'Nel frattempo è stato creato un account con questa email' };
  }

  const info = db.prepare(`
    INSERT INTO users (email, password_hash, name, studio_id, studio_role, onboarded_at, tax_configured)
    VALUES (?,?,?,?,'collaboratore',datetime('now'),1)
  `).run(invito.email, hashPassword(password), name.trim(), titolare.id);

  db.prepare("UPDATE studio_invites SET accepted_at = datetime('now') WHERE id = ?").run(invito.id);
  logActivity(titolare.id, `${name.trim()} fa ora parte dello studio`, 'star');

  return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) };
}

const revocaInvito = (studioId, invitoId) => db.prepare(
  "UPDATE studio_invites SET revoked_at = datetime('now') WHERE id = ? AND studio_id = ? AND accepted_at IS NULL",
).run(invitoId, studioId).changes > 0;

/* ------------------------------------------------------------------ */
/* Uscita                                                              */
/* ------------------------------------------------------------------ */

/**
 * Toglie una persona dallo studio.
 *
 * Il lavoro fatto resta allo studio — era dello studio fin dall'inizio, non
 * suo. Chi esce si ritrova un account proprio e vuoto, non cancellato: se
 * domani vuole usare Solvia per conto suo, l'indirizzo è già suo.
 */
function rimuoviMembro(studioId, membroId) {
  const membro = db.prepare('SELECT * FROM users WHERE id = ? AND studio_id = ?').get(membroId, studioId);
  if (!membro) return { errore: 'Persona non trovata in questo studio' };
  if (membro.studio_role === 'titolare') {
    return { errore: 'Il titolare non può essere rimosso dal proprio studio' };
  }

  db.prepare(`
    UPDATE users SET studio_id = id, studio_role = 'titolare', plan = 'free',
      subscription_status = 'inattivo', onboarded_at = NULL, token_version = token_version + 1
    WHERE id = ?
  `).run(membroId);

  logActivity(studioId, `${membro.name} non fa più parte dello studio`, 'dot');
  return { ok: true, nome: membro.name };
}

module.exports = {
  studioCondiviso, soloTitolare, stato, membri, invitiAperti, posti,
  creaInvito, leggiInvito, accettaInvito, revocaInvito, rimuoviMembro,
  titolareDi, studioIdDi, DURATA_INVITO_ORE,
};
