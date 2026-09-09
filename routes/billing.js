'use strict';

const express = require('express');
const { db, logActivity } = require('../lib/db');
const analytics = require('../lib/analytics');
const { requireAuth, requireAdmin, readUserFromRequest } = require('../lib/auth');
const attesa = require('../lib/attesa');
const billing = require('../lib/billing');

const router = express.Router();

/**
 * Chi lavora in uno studio altrui non ha un abbonamento proprio: usa quello
 * del titolare. Vede lo stato reale — a che piano lavora e quando si rinnova —
 * ma in sola lettura, e le rotte che muovono soldi lo fermano più sotto.
 */
const inStudioAltrui = (user) => user.studio_role === 'collaboratore';

function soloTitolarePagamenti(req, res, next) {
  if (inStudioAltrui(req.user)) {
    return res.status(403).json({
      error: 'L\'abbonamento è gestito dal titolare dello studio.',
    });
  }
  next();
}

/**
 * Lista d'attesa (modalità pre-lancio) — pubblica di proposito.
 *
 * Ci arriva sia chi preme il pulsante del prezzo sul sito senza avere un
 * account, sia chi è già dentro e sbatte contro un limite del piano gratuito.
 * Nel secondo caso l'evento porta con sé l'id, così poi si sa chi era.
 */
router.post('/attesa', (req, res) => {
  const user = readUserFromRequest(req);
  const esito = attesa.iscrivi({
    email: req.body?.email || user?.email,
    plan: req.body?.plan,
    source: req.body?.source || (user ? 'app' : 'sito'),
    userId: user?.id || null,
    note: req.body?.note,
  });
  res.status(esito.ok ? 200 : 400).json(esito);
});

/* Stato del piano, consumo e listino */
router.get('/', requireAuth, (req, res) => {
  if (inStudioAltrui(req.user)) {
    const titolare = require('../lib/studio').titolareDi(req.user);
    return res.json({
      ...billing.billingState(titolare),
      readOnly: true,
      studio: titolare.business_name || titolare.name,
    });
  }
  res.json(billing.billingState(req.user));
});

/* Avvia il pagamento: restituisce l'URL a cui mandare l'utente */
router.post('/checkout', requireAuth, soloTitolarePagamenti, async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    res.json(await billing.createCheckout(req.user, req.body?.plan, origin));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Diagnostica della configurazione Stripe.
 * Riservata all'amministratore: rivela dettagli dell'account e degli endpoint,
 * che non devono essere visibili agli utenti normali.
 */
router.get('/diagnostica', requireAdmin, async (req, res) => {
  try {
    res.json(await require('../lib/diagnostica').esegui());
  } catch (e) {
    console.error('Diagnostica non riuscita:', e.message);
    res.status(500).json({ error: 'Diagnostica non riuscita', dettaglio: e.message });
  }
});

/* Portale per gestire pagamento e disdetta */
router.post('/portal', requireAuth, soloTitolarePagamenti, async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    res.json(await billing.createPortal(req.user, origin));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Attivazione simulata — disponibile SOLO in modalità demo.
 * Serve a provare l'intero flusso senza un account Stripe reale.
 */
router.post('/demo-attiva', requireAuth, soloTitolarePagamenti, (req, res) => {
  if (billing.MODE !== 'demo') {
    return res.status(403).json({ error: 'Disponibile solo in modalità demo' });
  }
  // In pre-lancio nemmeno l'attivazione simulata: il sito è online e davanti
  // c'è gente vera, che non deve poter "attivare" un piano che non esiste.
  if (billing.PRELANCIO) {
    return res.status(409).json({
      error: 'I pagamenti non sono ancora aperti.', prelancio: true,
    });
  }
  const plan = req.body?.plan;
  if (!billing.isPaid(plan)) return res.status(400).json({ error: 'Piano non valido' });

  const renews = new Date();
  renews.setMonth(renews.getMonth() + 1);
  billing.setPlan(req.user.id, {
    plan, status: 'attivo_demo', renewsAt: renews.toISOString().slice(0, 10),
  });
  logActivity(req.user.id, `Piano ${billing.getPlan(plan).name} attivato (simulazione)`, 'star');
  analytics.registra('abbonamento_attivato', {
    userId: req.user.id, label: plan, value: billing.getPlan(plan).price, req,
  });

  res.json({ ok: true, ...billing.billingState(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

/* Disdetta in modalità demo */
router.post('/demo-disdici', requireAuth, soloTitolarePagamenti, (req, res) => {
  if (billing.MODE !== 'demo') {
    return res.status(403).json({ error: 'Disponibile solo in modalità demo' });
  }
  billing.setPlan(req.user.id, { plan: 'free', status: 'disdetto', renewsAt: null });
  logActivity(req.user.id, 'Abbonamento disdetto (simulazione)', 'dot');
  analytics.registra('abbonamento_disdetto', {
    userId: req.user.id, label: req.user.plan, req,
  });
  res.json({ ok: true });
});

/**
 * Webhook Stripe.
 * Richiede il corpo grezzo per verificare la firma: viene montato in server.js
 * PRIMA di express.json(), con express.raw().
 */
function webhookHandler(req, res) {
  if (billing.MODE !== 'stripe') return res.status(404).json({ error: 'Stripe non configurato' });

  let event;
  try {
    event = billing.verifyWebhook(req.body, req.headers['stripe-signature']);
  } catch (e) {
    // Firma non valida: rifiuta, non fidarti mai del corpo non verificato.
    return res.status(400).json({ error: `Firma non valida: ${e.message}` });
  }

  try {
    const result = billing.applyWebhookEvent(event);
    res.json({ received: true, ...result });
  } catch (e) {
    console.error('Errore nel webhook:', e);
    res.status(500).json({ error: 'Errore interno' });
  }
}

module.exports = { router, webhookHandler };
