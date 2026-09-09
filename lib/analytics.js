'use strict';

/**
 * Statistiche del sito, in casa e senza spiare nessuno.
 *
 * Niente Google Analytics, niente cookie di terze parti, niente banner: gli
 * eventi restano sul tuo server, nel tuo database.
 *
 * Come si contano i visitatori senza identificarli:
 *   visitatore = sha256(sale_del_giorno + IP + user-agent) troncato a 16 caratteri
 *
 * Il sale cambia ogni giorno e deriva da SOLVIA_SECRET, che non esce mai dal
 * server. Conseguenze volute:
 *   · l'IP non viene mai scritto da nessuna parte, nemmeno in chiaro per un attimo
 *   · la stessa persona domani è un'altra impronta: non si segue nel tempo
 *   · non essendoci una tabella di corrispondenza, l'impronta non è reversibile
 *     nemmeno da chi amministra il server
 * Si può contare quante persone diverse sono passate oggi, non chi sono né cosa
 * hanno fatto la settimana scorsa. È il compromesso giusto: dice quello che serve
 * per decidere, e non costruisce un profilo di nessuno.
 *
 * Chi manda "Do Not Track" o "Global Privacy Control" non viene contato affatto:
 * il rifiuto lo applica il browser, e il server lo rispetta comunque.
 */

const crypto = require('crypto');
const { db } = require('./db');

const ATTIVO = process.env.SOLVIA_ANALYTICS !== 'false';
const SEGRETO = process.env.SOLVIA_SECRET || 'sale-di-sviluppo';

/**
 * Eventi accettati dall'endpoint pubblico.
 * È un elenco chiuso di proposito: senza, chiunque potrebbe riempire la tabella
 * di nomi inventati e rendere illeggibili le statistiche.
 */
const EVENTI_PUBBLICI = new Set([
  'visita',            // apertura di una pagina pubblica
  'prezzi_visti',      // il listino è entrato davvero nello schermo
  'clic',              // pulsante o link marcato con data-evento
  'faq_aperta',        // una domanda frequente è stata espansa
  'newsletter_vista',  // il modulo di iscrizione è entrato nello schermo
]);

/* Eventi registrati dal server, non dal browser: non passano dall'endpoint. */
const EVENTI_SERVER = new Set([
  'registrazione', 'benvenuto_completato', 'dati_esempio', 'abbonamento_attivato',
  'abbonamento_disdetto', 'newsletter_iscrizione', 'newsletter_conferma',
  'invito_studio', 'invito_accettato', 'lista_attesa', 'sondaggio_prezzo',
]);

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  path       TEXT,
  label      TEXT,
  referrer   TEXT,
  visitor    TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_day  ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_vis  ON events(visitor, created_at);
`);

/* ------------------------------------------------------------------ */
/* Raccolta                                                            */
/* ------------------------------------------------------------------ */

const oggi = () => new Date().toISOString().slice(0, 10);

/** Impronta giornaliera, non reversibile e non riutilizzabile domani. */
function impronta(req) {
  const materiale = `${SEGRETO}|${oggi()}|${req.ip || ''}|${req.headers['user-agent'] || ''}`;
  return crypto.createHash('sha256').update(materiale).digest('hex').slice(0, 16);
}

/** Rispetta il rifiuto espresso dal browser. */
const haRifiutato = (req) =>
  req.headers['dnt'] === '1' || req.headers['sec-gpc'] === '1';

/**
 * Del referrer si tiene solo il dominio: "google.com", non l'indirizzo completo
 * con la ricerca che la persona aveva digitato.
 */
function dominio(referrer, host) {
  if (!referrer) return 'diretto';
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, '');
    return h === String(host || '').replace(/^www\./, '').split(':')[0] ? 'interno' : h;
  } catch { return 'sconosciuto'; }
}

const pulisci = (s, max = 120) =>
  (s === undefined || s === null) ? null : String(s).slice(0, max);

/** Registra un evento dal browser. Restituisce false se è stato ignorato. */
function registraPubblico(req, { name, path, label, referrer }) {
  if (!ATTIVO || haRifiutato(req) || !EVENTI_PUBBLICI.has(name)) return false;

  db.prepare(`
    INSERT INTO events (name, path, label, referrer, visitor, user_id)
    VALUES (?,?,?,?,?,?)
  `).run(name, pulisci(path), pulisci(label, 60),
    dominio(referrer, req.get('host')), impronta(req), req.user?.id || null);
  return true;
}

/**
 * Registra un evento deciso dal server (registrazione, pagamento, disdetta…).
 * Non passa dall'elenco pubblico e non richiede una richiesta HTTP: la chiamano
 * le rotte, che sanno già cosa è successo davvero.
 */
function registra(name, { userId = null, label = null, value = null, req = null } = {}) {
  if (!ATTIVO || !EVENTI_SERVER.has(name)) return false;
  db.prepare(`
    INSERT INTO events (name, label, value, visitor, user_id) VALUES (?,?,?,?,?)
  `).run(name, pulisci(label, 60), value, req ? impronta(req) : null, userId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Lettura                                                            */
/* ------------------------------------------------------------------ */

const PERIODI = { oggi: 1, settimana: 7, mese: 30, trimestre: 90 };

const daQuando = (giorni) => `-${giorni} days`;

const conta = (sql, ...p) => db.prepare(sql).get(...p).n;

/** Numeri principali del periodo, con confronto sul periodo precedente. */
function traffico(giorni) {
  // Il periodo in corso non ha limite superiore: un `< datetime('now')` taglierebbe
  // fuori gli eventi arrivati in questo stesso secondo, che è esattamente quello
  // che succede mentre si guarda la pagina.
  const ora = db.prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT visitor) AS unici FROM events
    WHERE name = 'visita' AND created_at >= datetime('now', ?)
  `).get(daQuando(giorni));

  const prima = db.prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT visitor) AS unici FROM events
    WHERE name = 'visita' AND created_at >= datetime('now', ?)
      AND created_at < datetime('now', ?)
  `).get(daQuando(giorni * 2), daQuando(giorni));

  return {
    visite: ora.n,
    visitatori: ora.unici,
    visitePrecedenti: prima.n,
    visitatoriPrecedenti: prima.unici,
  };
}

/** Quante persone diverse hanno compiuto un dato evento nel periodo. */
const unici = (name, giorni) => conta(
  `SELECT COUNT(DISTINCT visitor) AS n FROM events
   WHERE name = ? AND created_at >= datetime('now', ?)`,
  name, daQuando(giorni),
);

/**
 * L'imbuto: da chi passa sul sito a chi paga.
 *
 * Le prime tre righe contano visitatori anonimi, le ultime tre contano account:
 * è il salto che rende il conto onesto. Un imbuto che fingesse di seguire la
 * stessa persona dall'atterraggio al pagamento sarebbe una bugia, perché
 * l'impronta del visitatore muore a mezzanotte.
 */
function imbuto(giorni) {
  const d = daQuando(giorni);
  const passi = [
    { chiave: 'visite', etichetta: 'Ha aperto il sito', n: unici('visita', giorni),
      nota: 'persone diverse' },
    { chiave: 'prezzi', etichetta: 'È arrivato ai prezzi', n: unici('prezzi_visti', giorni),
      nota: 'il listino è entrato nello schermo' },
    { chiave: 'clic', etichetta: 'Ha premuto "Inizia"', n: conta(
      `SELECT COUNT(DISTINCT visitor) AS n FROM events
       WHERE name = 'clic' AND label LIKE 'inizia%' AND created_at >= datetime('now', ?)`, d),
      nota: 'clic su un pulsante di partenza' },
    { chiave: 'registrati', etichetta: 'Ha creato l\'account', n: conta(
      "SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', ?)", d),
      nota: 'account nuovi' },
    { chiave: 'configurati', etichetta: 'Ha finito la configurazione', n: conta(
      `SELECT COUNT(*) AS n FROM users
       WHERE onboarded_at IS NOT NULL AND created_at >= datetime('now', ?)`, d),
      nota: 'ha superato il benvenuto' },
    { chiave: 'paganti', etichetta: 'Ha attivato un piano', n: conta(
      `SELECT COUNT(DISTINCT user_id) AS n FROM events
       WHERE name = 'abbonamento_attivato' AND created_at >= datetime('now', ?)`, d),
      nota: 'abbonamenti attivati' },
  ];

  const partenza = passi[0].n || 0;
  return passi.map((p, i) => ({
    ...p,
    // Percentuale sul primo passo e sul passo precedente: la seconda dice dove
    // si perde davvero la gente, la prima dà la scala.
    suTotale: partenza ? Math.round((p.n / partenza) * 1000) / 10 : 0,
    suPrecedente: i === 0 || !passi[i - 1].n ? null
      : Math.round((p.n / passi[i - 1].n) * 1000) / 10,
  }));
}

/** Pagine più viste, con quante persone diverse le hanno aperte. */
const pagine = (giorni) => db.prepare(`
  SELECT COALESCE(path,'/') AS path, COUNT(*) AS visite, COUNT(DISTINCT visitor) AS unici
  FROM events WHERE name = 'visita' AND created_at >= datetime('now', ?)
  GROUP BY path ORDER BY visite DESC LIMIT 12
`).all(daQuando(giorni));

/** Da dove arriva la gente. */
const provenienze = (giorni) => db.prepare(`
  SELECT COALESCE(referrer,'diretto') AS fonte, COUNT(*) AS visite,
         COUNT(DISTINCT visitor) AS unici
  FROM events WHERE name = 'visita' AND created_at >= datetime('now', ?)
  GROUP BY fonte ORDER BY visite DESC LIMIT 10
`).all(daQuando(giorni));

/** Cosa è stato premuto: il pezzo "chi ha schiacciato cosa". */
const clic = (giorni) => db.prepare(`
  SELECT label, COUNT(*) AS n, COUNT(DISTINCT visitor) AS unici
  FROM events WHERE name = 'clic' AND label IS NOT NULL
    AND created_at >= datetime('now', ?)
  GROUP BY label ORDER BY n DESC LIMIT 15
`).all(daQuando(giorni));

/** Quali domande frequenti vengono aperte: dice cosa non è chiaro nel sito. */
const faq = (giorni) => db.prepare(`
  SELECT label, COUNT(*) AS n FROM events
  WHERE name = 'faq_aperta' AND created_at >= datetime('now', ?)
  GROUP BY label ORDER BY n DESC LIMIT 10
`).all(daQuando(giorni));

/** Andamento giorno per giorno, per il grafico. */
const perGiorno = (giorni) => db.prepare(`
  SELECT substr(created_at,1,10) AS giorno,
         COUNT(*) AS visite, COUNT(DISTINCT visitor) AS unici
  FROM events WHERE name = 'visita' AND created_at >= datetime('now', ?)
  GROUP BY giorno ORDER BY giorno
`).all(daQuando(giorni));

/* ------------------------------------------------------------------ */
/* Il conto economico                                                  */
/* ------------------------------------------------------------------ */

/**
 * Chi paga, quanto entra al mese, chi ha disdetto.
 * Gli importi vengono da PLANS, non da un numero scritto qui: se cambi il
 * listino, questa pagina cambia con lui.
 */
function economia(giorni) {
  const { PLANS } = require('./billing');
  const d = daQuando(giorni);

  const perPiano = db.prepare(`
    SELECT plan, COUNT(*) AS n FROM users
    WHERE plan != 'free' AND subscription_status NOT IN ('disdetto','scaduto')
    GROUP BY plan
  `).all();

  const mrr = perPiano.reduce((s, r) => s + (PLANS[r.plan]?.price || 0) * r.n, 0);
  const paganti = perPiano.reduce((s, r) => s + r.n, 0);
  const utenti = conta('SELECT COUNT(*) AS n FROM users');

  return {
    utenti,
    nuoviUtenti: conta("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', ?)", d),
    attivi: conta("SELECT COUNT(*) AS n FROM users WHERE last_login_at >= datetime('now', ?)", d),
    paganti,
    perPiano: perPiano.map((r) => ({
      ...r, nome: PLANS[r.plan]?.name || r.plan, prezzo: PLANS[r.plan]?.price || 0,
    })),
    mrr,
    arr: mrr * 12,
    // Ricavo medio per utente pagante: se un giorno diverge dal prezzo del Pro,
    // vuol dire che il Team sta pesando davvero.
    arpu: paganti ? Math.round((mrr / paganti) * 100) / 100 : 0,
    conversione: utenti ? Math.round((paganti / utenti) * 1000) / 10 : 0,
    attivazioni: conta(
      "SELECT COUNT(*) AS n FROM events WHERE name = 'abbonamento_attivato' AND created_at >= datetime('now', ?)", d),
    disdette: conta(
      "SELECT COUNT(*) AS n FROM events WHERE name = 'abbonamento_disdetto' AND created_at >= datetime('now', ?)", d),
  };
}

/** L'elenco di chi paga davvero. Il motivo per cui questa pagina esiste. */
const clientiPaganti = () => db.prepare(`
  SELECT id, name, email, business_name, plan, subscription_status,
         plan_renews_at, created_at, last_login_at
  FROM users WHERE plan != 'free'
  ORDER BY (subscription_status NOT IN ('disdetto','scaduto')) DESC, created_at DESC
  LIMIT 100
`).all();

/** Ultimi account registrati, per vedere se il flusso li porta fino in fondo. */
const ultimiIscritti = () => db.prepare(`
  SELECT id, name, email, plan, created_at, onboarded_at, last_login_at, demo_data
  FROM users ORDER BY created_at DESC LIMIT 15
`).all();

const newsletter = () => ({
  confermati: conta("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'confermato'"),
  inAttesa: conta("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'in_attesa'"),
  disiscritti: conta("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'disiscritto'"),
});

/** Il flusso in diretta: gli ultimi fatti, in ordine. */
const inDiretta = () => db.prepare(`
  SELECT e.name, e.path, e.label, e.referrer, e.created_at, u.name AS utente
  FROM events e LEFT JOIN users u ON u.id = e.user_id
  ORDER BY e.id DESC LIMIT 40
`).all();

/** Tutto insieme, per una sola chiamata dall'interfaccia. */
function quadro(periodo = 'settimana') {
  const giorni = PERIODI[periodo] || PERIODI.settimana;
  return {
    attivo: ATTIVO,
    // Il nome della variabile arriva dal server: nel codice della pagina non
    // deve comparire nulla che permetta di risalire al prodotto.
    variabile: ATTIVO ? null : 'SOLVIA_ANALYTICS=false',
    periodo,
    giorni,
    periodi: Object.keys(PERIODI),
    traffico: traffico(giorni),
    imbuto: imbuto(giorni),
    pagine: pagine(giorni),
    provenienze: provenienze(giorni),
    clic: clic(giorni),
    faq: faq(giorni),
    perGiorno: perGiorno(giorni),
    economia: economia(giorni),
    paganti: clientiPaganti(),
    iscritti: ultimiIscritti(),
    newsletter: newsletter(),
    attesa: require('./attesa').quadro(),
    sondaggio: require('./sondaggio').quadro(),
    diretta: inDiretta(),
    eventiTotali: conta('SELECT COUNT(*) AS n FROM events'),
  };
}

/**
 * Pulizia: gli eventi più vecchi di un anno non servono a decidere niente e
 * occupano spazio. Chiamata dallo scheduler una volta al giorno.
 */
const potaVecchi = () => db.prepare(
  "DELETE FROM events WHERE created_at < datetime('now','-365 days')",
).run().changes;

module.exports = {
  registra, registraPubblico, quadro, potaVecchi,
  ATTIVO, EVENTI_PUBBLICI, EVENTI_SERVER, PERIODI, impronta, dominio,
};
