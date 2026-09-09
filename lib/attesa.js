'use strict';

/**
 * Lista d'attesa — la modalità pre-lancio.
 *
 * Serve a una situazione precisa: il prodotto è pronto e il sito è online, ma
 * non puoi ancora incassare (in Italia serve la partita IVA, e finché non ce
 * l'hai nessun servizio di pagamento la aggira).
 *
 * L'alternativa sbagliata sarebbe lasciare i pulsanti "Passa a Pro" che portano
 * a un pagamento finto: chi ci clicca capisce in tre secondi che è una scena, e
 * quella persona non torna più. L'alternativa peggiore è togliere i prezzi:
 * così non sai se qualcuno avrebbe pagato.
 *
 * Con il pre-lancio i prezzi restano scritti — servono a qualificare — ma il
 * pulsante dice la verità: "sto aprendo i pagamenti, lasciami l'email e ti
 * avviso". Il piano gratuito resta pienamente usabile, quindi la gente entra
 * davvero e prova il prodotto.
 *
 * Il giorno in cui apri gli incassi hai due cose che oggi non hai: un prodotto
 * già usato da persone vere, e un elenco di chi voleva pagarlo.
 */

const { db, logActivity } = require('./db');

const ATTIVO = process.env.SOLVIA_PRELANCIO === 'true';

db.exec(`
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'pro',
  source     TEXT NOT NULL DEFAULT 'sito',
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT,
  avvisato_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (email, plan)
);
CREATE INDEX IF NOT EXISTS idx_waitlist_plan ON waitlist(plan, created_at);
`);

const valida = (email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());

/**
 * Registra un'intenzione d'acquisto.
 * Ripetere la stessa email per lo stesso piano non è un errore: è una persona
 * che ci riprova, e va trattata come già in lista.
 */
function iscrivi({ email, plan = 'pro', source = 'sito', userId = null, note = null }) {
  if (!ATTIVO) return { ok: false, error: 'I pagamenti sono già aperti' };

  const indirizzo = String(email || '').toLowerCase().trim();
  if (!valida(indirizzo)) return { ok: false, error: 'Inserisci un indirizzo email valido' };

  const piano = ['pro', 'team'].includes(plan) ? plan : 'pro';
  const gia = db.prepare('SELECT id FROM waitlist WHERE email = ? AND plan = ?')
    .get(indirizzo, piano);

  if (gia) return { ok: true, gia: true, message: 'Sei già in lista: ti avviso appena apro.' };

  db.prepare(`
    INSERT INTO waitlist (email, plan, source, user_id, note) VALUES (?,?,?,?,?)
  `).run(indirizzo, piano, String(source).slice(0, 40), userId, note ? String(note).slice(0, 300) : null);

  if (userId) logActivity(userId, `In lista d'attesa per il piano ${piano}`, 'star');
  require('./analytics').registra('lista_attesa', { userId, label: piano });

  return { ok: true, gia: false, message: 'Ci sei. Ti scrivo appena apro i pagamenti.' };
}

/** Quadro per la console: quanti, per quale piano, e gli ultimi arrivati. */
function quadro() {
  const perPiano = db.prepare(
    'SELECT plan, COUNT(*) AS n FROM waitlist GROUP BY plan ORDER BY n DESC',
  ).all();

  return {
    attivo: ATTIVO,
    totale: perPiano.reduce((s, r) => s + r.n, 0),
    perPiano,
    // Quanto varrebbe al mese se pagassero tutti: non è una previsione, è la
    // dimensione del bacino. Serve a decidere se vale la pena sbrigarsi.
    potenziale: perPiano.reduce((s, r) => {
      const { PLANS } = require('./billing');
      return s + (PLANS[r.plan]?.price || 0) * r.n;
    }, 0),
    ultimi: db.prepare(`
      SELECT w.email, w.plan, w.source, w.created_at, u.name AS utente
      FROM waitlist w LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.id DESC LIMIT 30
    `).all(),
  };
}

/** Tutti gli indirizzi, per il giorno in cui devi scrivere a tutti. */
const elenco = () => db.prepare(
  'SELECT email, plan, created_at FROM waitlist ORDER BY created_at',
).all();

module.exports = { ATTIVO, iscrivi, quadro, elenco };
