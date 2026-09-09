'use strict';

/**
 * "Quanto pagheresti?" — il sondaggio sul prezzo.
 *
 * Serve quando il prodotto è online ma **non si può ancora vendere**: niente
 * piani, niente carrello, niente promesse. In quella situazione la domanda che
 * conta non è "quanti mi pagano" — è "quanti *pagherebbero*, e quanto".
 *
 * È la stessa informazione che darebbe un listino vero, ottenuta senza incassare
 * un euro e senza dire una bugia a nessuno. Chi risponde sa esattamente cosa sta
 * facendo: sta dando un'opinione, non sta comprando.
 *
 * Perché non un pulsante "sostieni il progetto": raccogliere soldi è un'altra
 * cosa, con altre regole. Qui non entra denaro, quindi non c'è niente da
 * aggirare — e per capire se un prodotto vale, dieci risposte a questa domanda
 * valgono più di cento euro raccolti a caso.
 */

const { db } = require('./db');

/** Fasce usate per leggere i risultati: sotto, il numero esatto resta salvato. */
const FASCE = [
  { chiave: '0', min: 0, max: 0, etichetta: 'Non pagherei' },
  { chiave: '1-9', min: 1, max: 9, etichetta: 'Fino a 9 €' },
  { chiave: '10-19', min: 10, max: 19, etichetta: '10-19 €' },
  { chiave: '20-29', min: 20, max: 29, etichetta: '20-29 €' },
  { chiave: '30-49', min: 30, max: 49, etichetta: '30-49 €' },
  { chiave: '50+', min: 50, max: Infinity, etichetta: '50 € e oltre' },
];

const MASSIMO = 500;

db.exec(`
CREATE TABLE IF NOT EXISTS sondaggio_prezzo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  importo    INTEGER NOT NULL,
  mestiere   TEXT,
  email      TEXT,
  visitatore TEXT NOT NULL,
  giorno     TEXT NOT NULL DEFAULT (date('now')),
  origine    TEXT NOT NULL DEFAULT 'sito',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (visitatore, giorno)
);
CREATE INDEX IF NOT EXISTS idx_sondaggio_data ON sondaggio_prezzo(created_at);
`);

const fasciaDi = (importo) =>
  FASCE.find((f) => importo >= f.min && importo <= f.max)?.chiave || '50+';

const emailValida = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/**
 * Registra una risposta.
 *
 * L'impronta del visitatore vale per un giorno solo (cambia col sale
 * giornaliero delle statistiche): ripensarci e rispondere di nuovo **sostituisce**
 * la risposta precedente invece di contarne due. Non si può quindi gonfiare il
 * risultato ricaricando la pagina, ma nemmeno si perde chi si corregge.
 */
function rispondi({ importo, mestiere = null, email = null, visitatore, origine = 'sito' }) {
  const valore = Number(importo);
  if (!Number.isFinite(valore) || !Number.isInteger(valore) || valore < 0 || valore > MASSIMO) {
    return { ok: false, error: `Indica una cifra fra 0 e ${MASSIMO} €` };
  }
  if (!visitatore) return { ok: false, error: 'Risposta non valida' };

  const lavoro = mestiere ? String(mestiere).trim().slice(0, 60) || null : null;
  const indirizzo = email && emailValida(email) ? String(email).toLowerCase().trim() : null;
  if (email && !indirizzo) return { ok: false, error: 'Quell\'indirizzo email non sembra valido' };

  const gia = db.prepare(
    "SELECT id FROM sondaggio_prezzo WHERE visitatore = ? AND giorno = date('now')",
  ).get(visitatore);

  if (gia) {
    db.prepare(
      'UPDATE sondaggio_prezzo SET importo = ?, mestiere = ?, email = COALESCE(?, email) WHERE id = ?',
    ).run(valore, lavoro, indirizzo, gia.id);
  } else {
    db.prepare(`
      INSERT INTO sondaggio_prezzo (importo, mestiere, email, visitatore, origine)
      VALUES (?,?,?,?,?)
    `).run(valore, lavoro, indirizzo, visitatore, String(origine).slice(0, 40));
  }

  require('./analytics').registra('sondaggio_prezzo', { label: fasciaDi(valore) });

  return {
    ok: true,
    aggiornata: Boolean(gia),
    message: valore === 0
      ? 'Grazie: sapere che non lo pagheresti è utile quanto il contrario.'
      : 'Grazie. Una risposta come la tua vale più di cento visite.',
  };
}

/** La mediana dice più della media: un singolo scherzoso da 500 € non la sposta. */
function mediana(valori) {
  if (!valori.length) return 0;
  const meta = Math.floor(valori.length / 2);
  return valori.length % 2 ? valori[meta] : Math.round((valori[meta - 1] + valori[meta]) / 2);
}

/** Quadro per la console: quante risposte, a che cifra, e chi ha lasciato l'email. */
function quadro() {
  const righe = db.prepare('SELECT importo FROM sondaggio_prezzo ORDER BY importo').all();
  const valori = righe.map((r) => r.importo);
  const paganti = valori.filter((v) => v > 0);

  const perFascia = FASCE.map((f) => ({
    etichetta: f.etichetta,
    n: valori.filter((v) => v >= f.min && v <= f.max).length,
  }));

  return {
    totale: valori.length,
    // Quanti direbbero sì a *qualunque* cifra: è il primo numero da guardare.
    disposti: paganti.length,
    media: paganti.length ? Math.round(paganti.reduce((s, v) => s + v, 0) / paganti.length) : 0,
    mediana: mediana(paganti),
    massimo: valori.length ? Math.max(...valori) : 0,
    perFascia,
    // Chi lascia l'email dopo aver detto una cifra è la persona più calda che hai.
    conEmail: db.prepare('SELECT COUNT(*) AS n FROM sondaggio_prezzo WHERE email IS NOT NULL').get().n,
    ultime: db.prepare(`
      SELECT importo, mestiere, email, origine, created_at
      FROM sondaggio_prezzo ORDER BY id DESC LIMIT 30
    `).all(),
  };
}

/** Tutti gli indirizzi di chi ha risposto e vuole essere ricontattato. */
const elenco = () => db.prepare(`
  SELECT email, importo, mestiere, created_at FROM sondaggio_prezzo
  WHERE email IS NOT NULL ORDER BY importo DESC, created_at
`).all();

module.exports = { FASCE, MASSIMO, rispondi, quadro, elenco, fasciaDi };
