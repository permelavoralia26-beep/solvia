'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Driver SQLite.
 *
 * Usa better-sqlite3 se è stato compilato correttamente, altrimenti ricade sul
 * modulo `node:sqlite` incluso in Node 22+. Così l'applicazione parte anche
 * quando l'installazione del modulo nativo fallisce (assenza di toolchain di
 * compilazione, architettura senza binari precompilati, ecc.).
 *
 * I due driver espongono la stessa interfaccia per ciò che usiamo qui:
 * `exec(sql)` e `prepare(sql).run/get/all(...parametri)`.
 */
let Database;
let driver;
try {
  Database = require('better-sqlite3');
  driver = 'better-sqlite3';
} catch {
  ({ DatabaseSync: Database } = require('node:sqlite'));
  driver = 'node:sqlite';
}

const DATA_DIR = process.env.SOLVIA_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'solvia.db'));
// PRAGMA via exec: funziona su entrambi i driver (node:sqlite non ha .pragma()).
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  business_name TEXT,
  vat_number    TEXT,
  address       TEXT,
  default_vat   REAL NOT NULL DEFAULT 22,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  vat_number TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('preventivo','fattura')),
  number      TEXT NOT NULL,
  issue_date  TEXT NOT NULL,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'bozza'
              CHECK (status IN ('bozza','inviata','accettata','rifiutata','pagata')),
  vat_rate    REAL NOT NULL DEFAULT 22,
  withholding REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  subtotal    REAL NOT NULL DEFAULT 0,
  vat_amount  REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  paid_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, kind);

CREATE TABLE IF NOT EXISTS line_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_doc ON line_items(document_id);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  due_date     TEXT,
  priority     TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta','media','bassa')),
  done         INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'manuale',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);

CREATE TABLE IF NOT EXISTS emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_name   TEXT NOT NULL,
  from_email  TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  category    TEXT NOT NULL DEFAULT 'da_smistare',
  priority    TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta','media','bassa')),
  summary     TEXT,
  draft_reply TEXT,
  status      TEXT NOT NULL DEFAULT 'da_leggere'
              CHECK (status IN ('da_leggere','bozza_pronta','approvata','archiviata'))
);
CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id, status);

-- Ore lavorate. Il cronometro salva qui: started_at valorizzato e ended_at
-- vuoto significa "sta correndo adesso".
CREATE TABLE IF NOT EXISTS time_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  work_date   TEXT NOT NULL,
  minutes     INTEGER NOT NULL DEFAULT 0,
  hourly_rate REAL NOT NULL DEFAULT 0,
  billable    INTEGER NOT NULL DEFAULT 1,
  billed_on   INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  started_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, work_date);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'altro',
  spent_on    TEXT NOT NULL,
  supplier    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, spent_on);

-- Abbonamenti: generano una fattura da soli alla scadenza indicata.
CREATE TABLE IF NOT EXISTS recurring (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  frequency   TEXT NOT NULL DEFAULT 'mensile'
              CHECK (frequency IN ('mensile','bimestrale','trimestrale','semestrale','annuale')),
  next_run    TEXT NOT NULL,
  vat_rate    REAL NOT NULL DEFAULT 22,
  withholding REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  auto_send   INTEGER NOT NULL DEFAULT 0,
  last_run    TEXT,
  runs        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring(user_id, active);

CREATE TABLE IF NOT EXISTS recurring_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  quantity     REAL NOT NULL DEFAULT 1,
  unit_price   REAL NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rec_items ON recurring_items(recurring_id);

-- Solleciti: uno per livello, così non se ne mandano due uguali.
CREATE TABLE IF NOT EXISTS reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'da_approvare'
              CHECK (status IN ('da_approvare','inviato','annullato')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT,
  UNIQUE (document_id, level)
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, status);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE,
  name             TEXT,
  status           TEXT NOT NULL DEFAULT 'in_attesa'
                   CHECK (status IN ('in_attesa','confermato','disiscritto')),
  confirm_token    TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  -- Registro del consenso: richiesto dal GDPR per dimostrare quando e come
  -- è stato prestato. Si conserva anche dopo la disiscrizione.
  consent_text     TEXT NOT NULL,
  signup_ip        TEXT,
  signup_agent     TEXT,
  source           TEXT NOT NULL DEFAULT 'sito',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at     TEXT,
  unsubscribed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON newsletter_subscribers(status);

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza','inviata')),
  sent_count   INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT 'dot',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, created_at);
`);

/**
 * Migrazioni additive: aggiunge le colonne mancanti ai database già esistenti,
 * così un aggiornamento dell'applicazione non richiede di ricreare i dati.
 */
function addColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumn('users', 'plan', "TEXT NOT NULL DEFAULT 'free'");
addColumn('users', 'subscription_status', "TEXT NOT NULL DEFAULT 'inattivo'");
addColumn('users', 'stripe_customer_id', 'TEXT');
addColumn('users', 'stripe_subscription_id', 'TEXT');
addColumn('users', 'plan_renews_at', 'TEXT');
addColumn('emails', 'triaged_at', 'TEXT');
addColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');

// Preventivo condivisibile: il cliente lo apre da un link e lo accetta online.
addColumn('documents', 'public_token', 'TEXT');
addColumn('documents', 'shared_at', 'TEXT');
addColumn('documents', 'viewed_at', 'TEXT');
addColumn('documents', 'decided_at', 'TEXT');
addColumn('documents', 'decided_ip', 'TEXT');
addColumn('documents', 'client_note', 'TEXT');
addColumn('documents', 'recurring_id', 'INTEGER');

// Impostazioni fiscali per il calcolo di quanto accantonare.
addColumn('users', 'tax_regime', "TEXT NOT NULL DEFAULT 'forfettario'");
addColumn('users', 'tax_coefficient', 'REAL NOT NULL DEFAULT 78');
addColumn('users', 'tax_rate', 'REAL NOT NULL DEFAULT 5');
addColumn('users', 'inps_type', "TEXT NOT NULL DEFAULT 'gestione_separata'");
addColumn('users', 'inps_reduction', 'INTEGER NOT NULL DEFAULT 0');

addColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'chiaro'");
addColumn('users', 'hourly_rate', 'REAL NOT NULL DEFAULT 0');

// Firma del cliente sul preventivo accettato (immagine PNG in base64)
addColumn('documents', 'signature', 'TEXT');
addColumn('documents', 'signed_name', 'TEXT');

// Portale cliente: un link per vedere tutti i propri documenti
addColumn('clients', 'portal_token', 'TEXT');
addColumn('clients', 'portal_opened_at', 'TEXT');
addColumn('users', 'reminders_enabled', 'INTEGER NOT NULL DEFAULT 1');

/**
 * Primo accesso e sicurezza dell'account.
 *
 * onboarded_at  NULL finché l'utente non ha completato la configurazione
 *               iniziale: finché è NULL vede la schermata di benvenuto invece
 *               della dashboard.
 * token_version viene incrementato a ogni cambio password. Le sessioni portano
 *               la versione con cui sono nate, quindi cambiando password si
 *               disconnettono da sole tutte le altre sessioni aperte.
 */
addColumn('users', 'onboarded_at', 'TEXT');
addColumn('users', 'tax_configured', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'demo_data', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'last_login_at', 'TEXT');
addColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');

/**
 * Richieste di reimpostazione password.
 * In tabella finisce solo l'impronta SHA-256 del token: chi leggesse il
 * database non potrebbe comunque usarlo per entrare in un account.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_resets(user_id);
`);

/**
 * Studio condiviso (piano Team).
 *
 * Non esiste una tabella "studi": lo studio È l'account del titolare.
 * `studio_id` punta all'id del titolare — che per il titolare stesso è il
 * proprio id. Così i dati restano dove sono sempre stati (chiave `user_id`
 * uguale all'id del titolare) e un collaboratore, entrando, lavora sugli
 * stessi identici record senza che nulla vada spostato o duplicato.
 *
 * `studio_role` vale 'titolare' oppure 'collaboratore'.
 */
addColumn('users', 'studio_id', 'INTEGER');
addColumn('users', 'studio_role', "TEXT NOT NULL DEFAULT 'titolare'");
db.prepare('UPDATE users SET studio_id = id WHERE studio_id IS NULL').run();

/**
 * Chi si registra normalmente è titolare del proprio studio, da solo.
 * Il valore dipende dall'id appena assegnato, che una DEFAULT non può leggere:
 * lo mette un trigger, così vale per qualunque via di inserimento e non c'è
 * modo di dimenticarsene aggiungendone una nuova.
 * Chi entra su invito ha già `studio_id` valorizzato e il trigger lo salta.
 */
db.exec(`
CREATE TRIGGER IF NOT EXISTS users_studio_default AFTER INSERT ON users
WHEN NEW.studio_id IS NULL
BEGIN
  UPDATE users SET studio_id = NEW.id WHERE id = NEW.id;
END;
`);

/**
 * Inviti a entrare in uno studio.
 * Come per il recupero password, in tabella finisce solo l'impronta del token.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS studio_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  studio_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_studio ON studio_invites(studio_id);
`);

/* Chi ha fatto l'azione, quando lo studio ha più persone dentro. */
addColumn('activity', 'actor_name', 'TEXT');

/* Gli account già esistenti hanno superato da un pezzo il primo accesso. */
db.prepare(`
  UPDATE users SET onboarded_at = datetime('now'), demo_data = 1, tax_configured = 1
  WHERE onboarded_at IS NULL AND created_at < datetime('now', '-1 minute')
`).run();

/**
 * Contesto della richiesta in corso.
 *
 * Serve a una cosa sola: sapere QUALE persona ha compiuto l'azione quando in
 * uno studio condiviso lavorano più utenti sugli stessi dati. Senza, ogni voce
 * del registro attività risulterebbe fatta dal titolare, anche quando l'ha
 * scritta un collaboratore.
 *
 * L'alternativa era passare il nome dell'autore a mano in tutte le chiamate a
 * logActivity sparse per le rotte: più righe da toccare, più occasioni di
 * dimenticarsene proprio dove serve. AsyncLocalStorage è il meccanismo che
 * Node mette a disposizione esattamente per il contesto di richiesta.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const contesto = new AsyncLocalStorage();

/** Esegue `fn` con un contesto di richiesta associato. */
const conContesto = (dati, fn) => contesto.run(dati, fn);

function logActivity(userId, message, icon = 'dot') {
  // Fuori da una richiesta (script, scheduler) il contesto non c'è: nessun autore.
  const attore = contesto.getStore()?.attore || null;
  db.prepare('INSERT INTO activity (user_id, message, icon, actor_name) VALUES (?,?,?,?)')
    .run(userId, message, icon, attore);
}

module.exports = { db, logActivity, conContesto, DATA_DIR, driver };
