// Pre-lancio visto dal browser: sul sito i pulsanti dei piani non portano a un
// pagamento che non esiste, ma alla lista d'attesa. Dentro l'app, chi sbatte
// contro un limite riceve la stessa proposta onesta.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4580;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-pre-'));
  server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), SOLVIA_DATA_DIR: dataDir, SOLVIA_PRELANCIO: 'true',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* non ancora pronto */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('il server di prova non è partito');
}

function stopServer() {
  if (server) { try { server.kill('SIGKILL'); } catch { /* già chiuso */ } }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}

(async () => {
  await startServer();
  process.on('exit', stopServer);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest pre-lancio su browser\n────────────────────────────────────────');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));

  await step('sul sito i prezzi ci sono ancora', async () => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    const testo = await p.textContent('#prezzi');
    if (!testo.includes('€19')) throw new Error('il prezzo Pro è sparito');
    if (!testo.includes('€49')) throw new Error('il prezzo Team è sparito');
  });

  await step('ma i pulsanti non promettono un pagamento', async () => {
    await p.waitForFunction(() =>
      document.querySelector('.price .btn[data-piano="pro"]')?.textContent.includes('Avvisami'),
      { timeout: 5000 });
    const testo = await p.textContent('.price .btn[data-piano="team"]');
    if (!/Avvisami/.test(testo)) throw new Error(`pulsante Team inatteso: ${testo}`);
  });

  await step('premendo si apre la lista d\'attesa', async () => {
    await p.click('.price .btn[data-piano="pro"]');
    await p.waitForSelector('#attesa-fondo:not([hidden])');
    const titolo = await p.textContent('#attesa-titolo');
    if (!titolo.includes('pagamenti')) throw new Error(`titolo inatteso: ${titolo}`);
    await shot(p, '62-prelancio-attesa');
  });

  await step('il piano Team apre la sua versione', async () => {
    await p.click('#attesa-chiudi');
    await p.click('.price .btn[data-piano="team"]');
    await p.waitForSelector('#attesa-fondo:not([hidden])');
    const titolo = await p.textContent('#attesa-titolo');
    if (!/Team/.test(titolo)) throw new Error(`non distingue il piano: ${titolo}`);
  });

  await step('l\'iscrizione va a buon fine e lo dice', async () => {
    await p.fill('#attesa-email', 'interessato@example.com');
    await p.click('#attesa-invia');
    await p.waitForSelector('.attesa-msg.ok', { timeout: 8000 });
    const msg = await p.textContent('.attesa-msg');
    if (!/Ti scrivo|già in lista/.test(msg)) throw new Error(`messaggio inatteso: ${msg}`);
  });

  await step('un indirizzo sbagliato non passa', async () => {
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForFunction(() =>
      document.querySelector('.price .btn[data-piano="pro"]')?.textContent.includes('Avvisami'));
    await p.click('.price .btn[data-piano="pro"]');
    await p.waitForSelector('#attesa-fondo:not([hidden])');
    // Il campo è type=email: il browser stesso rifiuta di inviare.
    await p.fill('#attesa-email', 'non-una-email');
    const valido = await p.evaluate(() =>
      document.getElementById('attesa-form').checkValidity());
    if (valido) throw new Error('il modulo si invia con un indirizzo non valido');
    await p.click('#attesa-chiudi');
  });

  await step('chi entra nell\'app può usarla per davvero', async () => {
    await p.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await p.click('.tab[data-tab="register"]');
    await p.fill('#r-name', 'Prova Prelancio');
    await p.fill('#r-email', `pre${Date.now()}@example.com`);
    await p.fill('#r-pass', 'passwordsicura');
    await p.click('#r-submit');
    await p.waitForURL('**/app');
    await completaBenvenuto(p, 'vuoto');
  });

  await step('le impostazioni non mostrano pulsanti di pagamento', async () => {
    await p.click('.nav-item[data-view="settings"]');
    await p.waitForSelector('#b-attesa');
    if (await p.locator('[data-plan-upgrade]').count()) {
      throw new Error('propone comunque un abbonamento che non può incassare');
    }
    const testo = await p.textContent('#content');
    if (!/aprono a breve/.test(testo)) throw new Error('non spiega la situazione');
    await shot(p, '63-prelancio-impostazioni');
  });

  await step('sbattendo contro un limite arriva la proposta onesta', async () => {
    // Il piano Free consente 3 preventivi al mese: si va oltre creandoli davvero.
    await p.click('.nav-item[data-view="quotes"]');
    await p.waitForSelector('[data-action="new-quote"]');
    for (let i = 0; i < 5; i += 1) {
      if (await p.locator('#m-attesa').count()) break;
      await p.click('[data-action="new-quote"]');
      await p.waitForSelector('#d-save');
      await p.fill('[data-field="description"]', `Preventivo ${i + 1}`);
      await p.fill('[data-field="unit_price"]', '100');
      await p.click('#d-save');
      await p.waitForTimeout(700);
    }
    await p.waitForSelector('#m-attesa', { timeout: 10000 });
    const titolo = await p.textContent('#modal-title');
    if (!/non è ancora possibile pagare/i.test(titolo)) throw new Error(`titolo inatteso: ${titolo}`);
    await shot(p, '64-prelancio-limite');
  });

  await step('e l\'email si registra in un tocco', async () => {
    await p.click('#m-attesa');
    await p.waitForSelector('#att-ok.show', { timeout: 8000 });
  });

  await step('in console la lista si vede, con quanto varrebbe', async () => {
    const dati = await p.evaluate(async () =>
      (await (await fetch('/console/dati')).json()).attesa);
    if (dati.totale < 2) throw new Error(`in lista solo ${dati.totale}`);
    if (!dati.potenziale) throw new Error('il valore potenziale non è calcolato');
  });

  console.log('────────────────────────────────────────');
  console.log(errors.length ? `\x1b[31mErrori console: ${errors.join(' | ')}\x1b[0m`
                            : '\x1b[32mNessun errore in console\x1b[0m');
  console.log('');
  await browser.close();

  // Il server di prova è un processo figlio: finché resta acceso, node non esce
  // e la suite "finita" tiene occupato il terminale (e la porta) per sempre.
  stopServer();
  process.exit(process.exitCode || 0);
})();
