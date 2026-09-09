'use strict';

/**
 * Fatturazione e abbonamenti.
 *
 * Due modalità:
 *  - "stripe": attiva quando STRIPE_SECRET_KEY è impostata. Usa Stripe Checkout
 *    per l'incasso e i webhook per tenere allineato lo stato dell'abbonamento.
 *  - "demo":   nessuna chiave configurata. Il flusso di pagamento è simulato in
 *    locale, così l'intera esperienza (scelta piano → pagamento → sblocco
 *    funzioni → disdetta) è testabile prima di avere un account Stripe reale.
 *
 * Passare da demo a reale non richiede modifiche al codice: si impostano le
 * variabili d'ambiente e si riavvia.
 */

const { db, logActivity } = require('./db');

/**
 * La parte commerciale (piani, limiti, pagine prezzi) è ACCESA di default.
 * Si spegne con SOLVIA_COMMERCIAL=false, che riporta l'app a progetto gratuito
 * senza limiti d'uso e senza nessun riferimento ai prezzi.
 *
 * Accesa ma senza chiavi Stripe l'app gira in modalità "demo": il flusso di
 * pagamento funziona per intero ma non incassa nulla. Vedi STRIPE.md.
 */
const COMMERCIAL = process.env.SOLVIA_COMMERCIAL !== 'false';

/**
 * Pre-lancio: i piani si vedono e i prezzi sono scritti, ma non si incassa
 * ancora. Chi vuole pagare lascia l'email e viene avvisato all'apertura.
 * Serve nel periodo fra "il prodotto è pronto" e "posso emettere fattura".
 */
const PRELANCIO = COMMERCIAL && process.env.SOLVIA_PRELANCIO === 'true';

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const MODE = !COMMERCIAL ? 'disattivato' : (SECRET_KEY ? 'stripe' : 'demo');

let stripe = null;
if (COMMERCIAL && SECRET_KEY) {
  // eslint-disable-next-line global-require
  stripe = require('stripe')(SECRET_KEY);
}

/* ------------------------------------------------------------------ */
/* Definizione dei piani                                               */
/* ------------------------------------------------------------------ */

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: '€0',
    audience: 'Per iniziare a provare',
    priceId: null,
    limits: {
      quotesPerMonth: 3, triagePerMonth: 10, clients: 5,
      recurring: 0, sharedQuotes: 0, reminders: 0,
      seats: 1,
    },
    features: [
      '3 preventivi al mese',
      '10 email analizzate al mese',
      'Fino a 5 clienti',
      'Fatture illimitate ed export PDF',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 19,
    priceLabel: '€19/mese',
    audience: 'Per freelance e consulenti',
    priceId: process.env.STRIPE_PRICE_PRO || null,
    limits: {
      quotesPerMonth: Infinity, triagePerMonth: Infinity, clients: Infinity,
      recurring: Infinity, sharedQuotes: Infinity, reminders: Infinity,
      seats: 1,
    },
    features: [
      'Preventivi con link e accettazione online',
      'Solleciti automatici per le fatture scadute',
      'Fatture ricorrenti che si generano da sole',
      'Calcolo delle tasse da accantonare',
      'Spese, margine reale e tema scuro',
      'Tutto illimitato',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    price: 49,
    priceLabel: '€49/mese',
    audience: 'Per studi fino a 5 persone',
    priceId: process.env.STRIPE_PRICE_TEAM || null,
    limits: {
      quotesPerMonth: Infinity, triagePerMonth: Infinity, clients: Infinity,
      recurring: Infinity, sharedQuotes: Infinity, reminders: Infinity,
      // I posti dello studio condiviso: il titolare più quattro collaboratori.
      seats: 5,
    },
    features: [
      'Tutto il piano Pro, per tutti',
      'Fino a 5 persone nello stesso studio',
      'Clienti, preventivi e fatture condivisi davvero',
      'Ogni azione firmata da chi l\'ha fatta',
      'Il titolare invita e revoca in un clic',
      'Un solo abbonamento, non uno a testa',
    ],
  },
};

/** Funzioni riservate al piano a pagamento. */
const PRO_FEATURES = {
  recurring: 'Le fatture ricorrenti sono una funzione del piano Pro.',
  sharedQuotes: 'I preventivi con link e accettazione online sono una funzione del piano Pro.',
  reminders: 'I solleciti automatici sono una funzione del piano Pro.',
};

const isPaid = (planId) => planId === 'pro' || planId === 'team';
const getPlan = (planId) => PLANS[planId] || PLANS.free;

/* ------------------------------------------------------------------ */
/* Consumo del piano                                                   */
/* ------------------------------------------------------------------ */

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

function getUsage(userId) {
  const start = monthStart();
  const one = (sql, ...p) => db.prepare(sql).get(userId, ...p).n;
  return {
    quotesThisMonth: one(
      "SELECT COUNT(*) AS n FROM documents WHERE user_id = ? AND kind = 'preventivo' AND created_at >= ?",
      start),
    triageThisMonth: one(
      'SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND triaged_at IS NOT NULL AND triaged_at >= ?',
      start),
    clients: one('SELECT COUNT(*) AS n FROM clients WHERE user_id = ?'),
  };
}

/**
 * Verifica se l'utente può compiere un'azione soggetta a limite.
 * Restituisce { allowed, reason, limit, used }.
 */
function checkLimit(user, action) {
  // Progetto gratuito: nessun limite, per nessuno.
  if (!COMMERCIAL) return { allowed: true };

  const plan = getPlan(user.plan);
  const usage = getUsage(user.id);

  const rules = {
    quote: { used: usage.quotesThisMonth, limit: plan.limits.quotesPerMonth,
      reason: `Hai raggiunto il limite di ${plan.limits.quotesPerMonth} preventivi al mese del piano ${plan.name}.` },
    triage: { used: usage.triageThisMonth, limit: plan.limits.triagePerMonth,
      reason: `Hai raggiunto il limite di ${plan.limits.triagePerMonth} email analizzate al mese del piano ${plan.name}.` },
    client: { used: usage.clients, limit: plan.limits.clients,
      reason: `Hai raggiunto il limite di ${plan.limits.clients} clienti del piano ${plan.name}.` },
  };

  // Funzioni interamente riservate al piano Pro: o ce l'hai, o non ci accedi.
  if (PRO_FEATURES[action]) {
    return plan.limits[action] === Infinity
      ? { allowed: true }
      : { allowed: false, reason: PRO_FEATURES[action], proOnly: true, prelancio: PRELANCIO };
  }

  const rule = rules[action];
  if (!rule) return { allowed: true };
  if (rule.used < rule.limit) return { allowed: true, used: rule.used, limit: rule.limit };
  // `prelancio` viaggia col rifiuto: l'interfaccia deve sapere se proporre un
  // pagamento o la lista d'attesa, e lo deve sapere senza una seconda chiamata.
  return {
    allowed: false, reason: rule.reason, used: rule.used, limit: rule.limit,
    prelancio: PRELANCIO,
  };
}

/* ------------------------------------------------------------------ */
/* Stato abbonamento                                                   */
/* ------------------------------------------------------------------ */

function setPlan(userId, { plan, status, customerId, subscriptionId, renewsAt }) {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  db.prepare(`
    UPDATE users SET plan = ?, subscription_status = ?, stripe_customer_id = ?,
      stripe_subscription_id = ?, plan_renews_at = ? WHERE id = ?
  `).run(
    plan ?? current.plan,
    status ?? current.subscription_status,
    customerId ?? current.stripe_customer_id,
    subscriptionId ?? current.stripe_subscription_id,
    renewsAt ?? current.plan_renews_at,
    userId,
  );
}

function billingState(user) {
  if (!COMMERCIAL) {
    return {
      mode: 'disattivato',
      plan: 'libero',
      planName: 'Libero',
      status: 'gratuito',
      renewsAt: null,
      usage: getUsage(user.id),
      limits: { quotesPerMonth: null, triagePerMonth: null, clients: null },
      plans: [],
    };
  }

  const plan = getPlan(user.plan);
  return {
    mode: MODE,
    prelancio: PRELANCIO,
    plan: plan.id,
    planName: plan.name,
    status: user.subscription_status,
    renewsAt: user.plan_renews_at,
    usage: getUsage(user.id),
    limits: {
      quotesPerMonth: plan.limits.quotesPerMonth === Infinity ? null : plan.limits.quotesPerMonth,
      triagePerMonth: plan.limits.triagePerMonth === Infinity ? null : plan.limits.triagePerMonth,
      clients: plan.limits.clients === Infinity ? null : plan.limits.clients,
    },
    plans: Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, price: p.price, priceLabel: p.priceLabel,
      audience: p.audience, features: p.features,
      configured: p.id === 'free' || Boolean(p.priceId) || MODE === 'demo',
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

async function createCheckout(user, planId, origin) {
  if (!COMMERCIAL) throw new Error('Solvia è un progetto gratuito: non ci sono piani a pagamento');
  // In pre-lancio non esiste nessun pagamento da avviare: chi ci arriva deve
  // ricevere un no chiaro, non una pagina di pagamento che non incassa.
  if (PRELANCIO) {
    throw new Error('I pagamenti non sono ancora aperti. Lascia la tua email e ti avviso.');
  }

  const plan = getPlan(planId);
  if (!isPaid(plan.id)) throw new Error('Il piano Free non richiede pagamento');

  // Modalità demo: pagina di pagamento simulata, nessun addebito reale.
  if (MODE === 'demo') {
    return { url: `${origin}/pagamento-demo?piano=${plan.id}`, demo: true };
  }

  if (!plan.priceId) {
    throw new Error(`Prezzo Stripe non configurato per il piano ${plan.name}. Imposta STRIPE_PRICE_${plan.id.toUpperCase()}.`);
  }

  // Riusa il cliente Stripe esistente, così lo storico pagamenti resta unito.
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.business_name || user.name,
      metadata: { solvia_user_id: String(user.id) },
    });
    customerId = customer.id;
    setPlan(user.id, { customerId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${origin}/app#settings&pagamento=ok`,
    cancel_url: `${origin}/app#settings&pagamento=annullato`,
    locale: 'it',
    allow_promotion_codes: true,
    subscription_data: { metadata: { solvia_user_id: String(user.id), plan: plan.id } },
    metadata: { solvia_user_id: String(user.id), plan: plan.id },
  });

  return { url: session.url, demo: false };
}

/** Portale Stripe per gestire metodo di pagamento e disdetta. */
async function createPortal(user, origin) {
  if (MODE === 'demo') return { url: `${origin}/app#settings`, demo: true };
  if (!user.stripe_customer_id) throw new Error('Nessun abbonamento attivo da gestire');

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}/app#settings`,
  });
  return { url: session.url, demo: false };
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

/** Verifica la firma del webhook: senza, chiunque potrebbe attivare abbonamenti. */
function verifyWebhook(rawBody, signature) {
  if (!stripe) throw new Error('Stripe non configurato');
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET non impostata');
  return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

const userFromCustomer = (customerId) =>
  db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId);

const isoFromUnix = (seconds) =>
  (seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : null);

/**
 * Applica un evento Stripe allo stato locale.
 * Gestisce attivazione, rinnovo, pagamento fallito e disdetta.
 */
function applyWebhookEvent(event) {
  const object = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(object.metadata?.solvia_user_id);
      const plan = object.metadata?.plan;
      if (!userId || !plan) return { handled: false, reason: 'metadati mancanti' };
      setPlan(userId, {
        plan, status: 'attivo',
        customerId: object.customer, subscriptionId: object.subscription,
      });
      logActivity(userId, `Abbonamento ${getPlan(plan).name} attivato`, 'star');
      require('./analytics').registra('abbonamento_attivato', {
        userId, label: plan, value: getPlan(plan).price,
      });
      return { handled: true, userId, plan };
    }

    case 'customer.subscription.updated': {
      const user = userFromCustomer(object.customer);
      if (!user) return { handled: false, reason: 'cliente sconosciuto' };
      const plan = object.metadata?.plan || user.plan;
      // Stripe usa "active" e "trialing" per gli abbonamenti in regola.
      const active = ['active', 'trialing'].includes(object.status);
      setPlan(user.id, {
        plan: active ? plan : 'free',
        status: active ? 'attivo' : 'sospeso',
        subscriptionId: object.id,
        renewsAt: isoFromUnix(object.current_period_end),
      });
      return { handled: true, userId: user.id, status: object.status };
    }

    case 'customer.subscription.deleted': {
      const user = userFromCustomer(object.customer);
      if (!user) return { handled: false, reason: 'cliente sconosciuto' };
      setPlan(user.id, { plan: 'free', status: 'disdetto', subscriptionId: null, renewsAt: null });
      logActivity(user.id, 'Abbonamento disdetto — sei tornato al piano Free', 'dot');
      require('./analytics').registra('abbonamento_disdetto', { userId: user.id });
      return { handled: true, userId: user.id };
    }

    case 'invoice.payment_failed': {
      const user = userFromCustomer(object.customer);
      if (!user) return { handled: false, reason: 'cliente sconosciuto' };
      setPlan(user.id, { status: 'pagamento_fallito' });
      logActivity(user.id, 'Pagamento non riuscito — aggiorna il metodo di pagamento', 'dot');
      return { handled: true, userId: user.id };
    }

    case 'invoice.paid': {
      const user = userFromCustomer(object.customer);
      if (!user) return { handled: false, reason: 'cliente sconosciuto' };
      setPlan(user.id, {
        status: 'attivo',
        renewsAt: isoFromUnix(object.lines?.data?.[0]?.period?.end),
      });
      return { handled: true, userId: user.id };
    }

    default:
      return { handled: false, reason: `evento ignorato: ${event.type}` };
  }
}

module.exports = {
  PLANS, MODE, COMMERCIAL, PRELANCIO, getPlan, isPaid, checkLimit, getUsage, billingState,
  setPlan, createCheckout, createPortal, verifyWebhook, applyWebhookEvent,
};
