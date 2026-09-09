/**
 * Test del webhook Stripe con firme reali.
 *
 * Non serve un account Stripe: la libreria ufficiale genera intestazioni firmate
 * di prova, quindi si verifica per intero il percorso di produzione — verifica
 * della firma compresa — e l'effetto degli eventi sullo stato dell'abbonamento.
 *
 * Avvia un server dedicato con chiavi finte, quindi non tocca l'istanza di sviluppo.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4310;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_testsegretoperfirmalocale';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-wh-'));

const stripe = require('stripe')('sk_test_chiavefintaperfirmalocale');

let pass = 0; let fail = 0;
const check = (label, ok) => {
  if (ok) { pass += 1; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail += 1; console.log(`  \x1b[31m✗\x1b[0m ${label}`); }
};

const send = async (payloadObject, { signed = true } = {}) => {
  const payload = JSON.stringify(payloadObject);
  const headers = { 'Content-Type': 'application/json' };
  if (signed) {
    headers['stripe-signature'] = stripe.webhooks.generateTestHeaderString({
      payload, secret: WEBHOOK_SECRET,
    });
  }
  const res = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('il server non è partito');
};

(async () => {
  const server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SOLVIA_DATA_DIR: DATA_DIR,
      // La parte commerciale è spenta di default: qui va accesa, altrimenti
      // Stripe non viene nemmeno inizializzato e i webhook non esistono.
      SOLVIA_COMMERCIAL: 'true',
      STRIPE_SECRET_KEY: 'sk_test_chiavefintaperfirmalocale',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_PRICE_PRO: 'price_finto_pro',
      STRIPE_PRICE_TEAM: 'price_finto_team',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stop = () => { try { server.kill('SIGKILL'); } catch { /* già chiuso */ } };
  process.on('exit', stop);

  console.log('\nTest webhook Stripe (firme reali, chiavi di prova)');
  console.log('────────────────────────────────────────');

  try {
    const health = await waitForServer();
    check('il server parte in modalità pagamenti "stripe"', health.billingMode === 'stripe');

    // Account su cui applicare gli eventi
    const jar = [];
    const register = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `wh${Date.now()}@example.com`, password: 'passwordsicura', name: 'Utente Webhook',
      }),
    });
    (register.headers.getSetCookie?.() || []).forEach((c) => jar.push(c.split(';')[0]));
    const cookie = jar.join('; ');
    const userId = (await register.json()).user.id;

    const billing = async () =>
      (await fetch(`${BASE}/api/billing`, { headers: { cookie } })).json();

    check('nuovo account parte dal piano Free', (await billing()).plan === 'free');

    console.log('\nVerifica della firma');
    check('firma assente → rifiutato con 400',
      (await send({ type: 'invoice.paid', data: { object: {} } }, { signed: false })).status === 400);

    const tampered = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    const badSig = await fetch(`${BASE}/api/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': stripe.webhooks.generateTestHeaderString({
          payload: tampered, secret: 'whsec_segreto_sbagliato',
        }),
      },
      body: tampered,
    });
    check('firma con segreto errato → rifiutato con 400', badSig.status === 400);
    check('il piano non cambia dopo eventi non firmati', (await billing()).plan === 'free');

    console.log('\nCiclo di vita dell\'abbonamento');
    let r = await send({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { customer: 'cus_test123', subscription: 'sub_test123',
        metadata: { solvia_user_id: String(userId), plan: 'pro' } } },
    });
    check('checkout completato → accettato', r.status === 200 && r.body.handled === true);
    let b = await billing();
    check('il piano passa a Pro', b.plan === 'pro');
    check('lo stato diventa attivo', b.status === 'attivo');
    check('i limiti spariscono', b.limits.quotesPerMonth === null);

    r = await send({
      id: 'evt_2', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test123', customer: 'cus_test123', status: 'active',
        current_period_end: 1798761600, metadata: { plan: 'pro' } } },
    });
    b = await billing();
    check('rinnovo → resta attivo con nuova scadenza', b.status === 'attivo' && Boolean(b.renewsAt));

    r = await send({
      id: 'evt_3', type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_test123' } },
    });
    b = await billing();
    check('pagamento fallito → stato segnalato', b.status === 'pagamento_fallito');

    r = await send({
      id: 'evt_4', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test123', customer: 'cus_test123', status: 'unpaid',
        current_period_end: 1798761600, metadata: { plan: 'pro' } } },
    });
    b = await billing();
    check('abbonamento non pagato → funzioni Pro revocate', b.plan === 'free' && b.status === 'sospeso');

    r = await send({
      id: 'evt_5', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test123', customer: 'cus_test123', status: 'active',
        current_period_end: 1798761600, metadata: { plan: 'pro' } } },
    });
    b = await billing();
    check('pagamento recuperato → Pro riattivato', b.plan === 'pro' && b.status === 'attivo');

    r = await send({
      id: 'evt_6', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test123', customer: 'cus_test123' } },
    });
    b = await billing();
    check('disdetta → ritorno al piano Free', b.plan === 'free' && b.status === 'disdetto');

    console.log('\nCasi limite');
    r = await send({ id: 'evt_7', type: 'checkout.session.completed',
      data: { object: { customer: 'cus_ignoto', subscription: 'sub_x', metadata: {} } } });
    check('checkout senza metadati → ignorato senza errore',
      r.status === 200 && r.body.handled === false);

    r = await send({ id: 'evt_8', type: 'invoice.paid',
      data: { object: { customer: 'cus_mai_visto' } } });
    check('evento per cliente sconosciuto → ignorato senza errore',
      r.status === 200 && r.body.handled === false);

    r = await send({ id: 'evt_9', type: 'customer.discount.created', data: { object: {} } });
    check('evento non gestito → risposta 200 (Stripe non riprova)', r.status === 200);

    // Il piano Free non deve essere rimasto sbloccato da eventi malformati
    check('lo stato finale resta coerente', (await billing()).plan === 'free');
  } catch (e) {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m errore imprevisto: ${e.message}`);
  }

  console.log('────────────────────────────────────────');
  console.log(`  ${pass} test superati, ${fail} falliti\n`);
  stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})();
