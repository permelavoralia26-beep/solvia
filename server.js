'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { readUserFromRequest } = require('./lib/auth');
const { MODE } = require('./lib/assistant');
const { driver } = require('./lib/db');
const { MODE: MAIL_MODE } = require('./lib/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

const { router: billingRouter, webhookHandler } = require('./routes/billing');
const { MODE: BILLING_MODE } = require('./lib/billing');

/* Il webhook Stripe va montato PRIMA di express.json(): la verifica della
   firma richiede il corpo grezzo, non l'oggetto già interpretato. */
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.disable('x-powered-by');

/* Dietro il proxy di Render/Fly l'IP del visitatore arriva in X-Forwarded-For.
   Senza questo, ogni richiesta sembrerebbe venire dal proxy: i cookie "secure"
   e il limite ai tentativi di accesso ragionerebbero su un IP solo. */
app.set('trust proxy', 1);

/* API */
app.use('/api/billing', billingRouter);
app.use('/api/newsletter', require('./routes/newsletter'));
app.use('/api/gdpr', require('./routes/gdpr'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/time', require('./routes/time'));
app.use('/api/pubblico', require('./routes/public'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/studio', require('./routes/studio'));
/* Console di direzione: piattaforma separata su un indirizzo suo, invisibile
   ai clienti. Vedi routes/direzione.js. */
const { router: consoleRouter, PERCORSO: CONSOLE_PATH } = require('./routes/direzione');
app.use(consoleRouter);
app.use('/api/clients', require('./routes/clients'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/emails', require('./routes/emails'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/dashboard', require('./routes/dashboard'));

/**
 * Stato pubblico del sito: quel poco che la landing deve sapere per non
 * raccontare bugie ai visitatori. Nessun dato riservato.
 */
app.get('/api/stato-pubblico', (req, res) => {
  const { PRELANCIO, COMMERCIAL } = require('./lib/billing');
  res.json({
    prelancio: PRELANCIO,
    commerciale: COMMERCIAL,
    sostegno: require('./lib/sostegno').statoPubblico(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true, assistantMode: MODE, billingMode: BILLING_MODE, mailMode: MAIL_MODE, driver,
    version: require('./package.json').version,
  });
});

/* File statici */
app.use(express.static(path.join(__dirname, 'public')));

/* L'applicazione richiede login: /app reindirizza a /accedi se non autenticato */
app.get('/app', (req, res) => {
  if (!readUserFromRequest(req)) return res.redirect('/accedi');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/accedi', (req, res) => {
  if (readUserFromRequest(req)) return res.redirect('/app');
  res.sendFile(path.join(__dirname, 'public', 'accedi.html'));
});

/* Pagina di pagamento simulata, attiva solo finché Stripe non è configurato */
app.get('/pagamento-demo', (req, res) => {
  if (BILLING_MODE !== 'demo') return res.redirect('/app#settings');
  if (!readUserFromRequest(req)) return res.redirect('/accedi');
  res.sendFile(path.join(__dirname, 'public', 'pagamento-demo.html'));
});

/* Preventivo condiviso: il cliente lo apre senza account */
app.get('/p/:token', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'preventivo.html')));

/* Portale cliente: tutti i suoi documenti dietro un link */
app.get('/c/:token', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'portale.html')));

/* Pagine newsletter raggiungibili dai link nelle email (senza login) */
app.get('/newsletter/conferma', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'newsletter-conferma.html')));
app.get('/newsletter/disiscriviti', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'newsletter-disiscrizione.html')));

/* Pannello newsletter, riservato all'amministratore */
app.get('/newsletter-admin', (req, res) => {
  const user = readUserFromRequest(req);
  if (!user) return res.redirect('/accedi');
  if (!user.is_admin) return res.redirect('/app');
  res.sendFile(path.join(__dirname, 'public', 'newsletter-admin.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint non trovato' });
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Errore interno del server' });
});

if (require.main === module) {
  // In produzione il controllo prima del volo parla da solo: gli errori peggiori
  // di una messa online sono silenziosi, e questo è il momento in cui si vedono.
  if (process.env.NODE_ENV === 'production') {
    try {
      require('./controllo').stampa(undefined, true);
    } catch (e) {
      console.error('Controllo non riuscito:', e.message);
    }
  }

  // Lavori periodici: fatture ricorrenti in scadenza e solleciti da preparare.
  require('./lib/scheduler').start();

  app.listen(PORT, () => {
    console.log(`\n  Solvia è in ascolto su http://localhost:${PORT}`);
    console.log(`  Database: ${driver}`);
    console.log(`  Assistente: ${MODE}${MODE === 'regole' ? ' (imposta ANTHROPIC_API_KEY per il modello)' : ''}`);
    console.log(`  Email: ${MAIL_MODE}${MAIL_MODE === 'outbox' ? ' (nessun invio reale — le email finiscono in data/outbox/)' : ''}`);
    console.log(`  Pagamenti: ${BILLING_MODE}${BILLING_MODE === 'disattivato' ? ' (progetto gratuito)' : ''}`);
    console.log(`  Console di direzione: http://localhost:${PORT}${CONSOLE_PATH} (solo amministratore)\n`);
  });
}

module.exports = app;
