// La console di direzione: piattaforma separata, invisibile ai clienti.
// Si verifica che la misurazione parta dal sito vero, che i numeri arrivino
// fino alla console, e soprattutto che dentro Solvia non ne resti traccia.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWN_SERVER = !process.env.BASE;
const PORT = 4570;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const CONSOLE = `${BASE}/console`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-dir-'));
  server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), SOLVIA_DATA_DIR: dataDir },
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
  if (OWN_SERVER) await startServer();
  process.on('exit', stopServer);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest console di direzione\n────────────────────────────────────────');

  const emailCapo = `capo${Date.now()}@example.com`;
  const emailCliente = `cliente${Date.now()}@example.com`;

  /* Un visitatore vero: apre la home, scorre ai prezzi, preme "Prova Pro". */
  const visitatore = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const v = await visitatore.newPage();
  v.on('pageerror', (e) => errors.push(String(e)));

  await step('la misurazione parte dalla home senza rompere niente', async () => {
    await v.goto(BASE, { waitUntil: 'networkidle' });
    if (errors.length) throw new Error(`errori in console: ${errors.join(' | ')}`);
  });

  await step('scorrendo fino ai prezzi l\'evento parte', async () => {
    await v.evaluate(() => document.querySelector('#prezzi').scrollIntoView());
    await v.waitForTimeout(900);
    await v.click('[data-evento="inizia-piano-pro"]');
    await v.waitForURL('**/accedi');
  });

  await step('un secondo visitatore apre la FAQ', async () => {
    const altro = await browser.newContext({
      viewport: { width: 400, height: 800 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/126 Mobile',
    });
    const a = await altro.newPage();
    await a.goto(BASE, { waitUntil: 'networkidle' });
    await a.evaluate(() => document.querySelector('.faq-item summary').click());
    await a.waitForTimeout(700);
    await altro.close();
  });

  /* Il primo account registrato è l'amministratore. */
  const capo = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const t = await capo.newPage();
  t.on('pageerror', (e) => errors.push(String(e)));

  await step('l\'amministratore usa Solvia come tutti gli altri', async () => {
    await t.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await t.click('.tab[data-tab="register"]');
    await t.fill('#r-name', 'Riccardo');
    await t.fill('#r-email', emailCapo);
    await t.fill('#r-pass', 'passwordsicura');
    await t.click('#r-submit');
    await t.waitForURL('**/app');
    await completaBenvenuto(t);
  });

  await step('dentro Solvia non c\'è traccia della console', async () => {
    const barra = await t.textContent('#nav');
    if (/direzione|console|statistic/i.test(barra)) {
      throw new Error(`la barra laterale nomina la console: ${barra}`);
    }
    await t.click('.nav-item[data-view="settings"]');
    await t.waitForSelector('#gdpr-delete');
    const impostazioni = await t.textContent('#content');
    if (/console|visite del sito|imbuto/i.test(impostazioni)) {
      throw new Error('le impostazioni parlano della console');
    }
    // Nemmeno nel codice dell'applicazione.
    const codice = await (await fetch(`${BASE}/js/app.js`)).text();
    if (/direzione|imbuto|console\/dati/i.test(codice)) {
      throw new Error('il codice dell\'app contiene ancora la console');
    }
  });

  /* La console: piattaforma separata, altro indirizzo, altro aspetto. */
  const cons = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const c = await cons.newPage();
  c.on('pageerror', (e) => errors.push(String(e)));

  await step('la console chiede l\'accesso e non dice a cosa serve', async () => {
    await c.goto(CONSOLE, { waitUntil: 'networkidle' });
    await c.waitForSelector('#porta:not(.nascosto)');
    const testo = await c.textContent('body');
    if (!testo.includes('Accesso riservato')) throw new Error('modulo di accesso assente');
    if (/Solvia/i.test(await c.content())) throw new Error('la pagina nomina il prodotto');
    await shot(c, '58-console-accesso');
  });

  await step('un cliente normale non entra, e non capisce perché', async () => {
    const cliente = await browser.newContext();
    const u = await cliente.newPage();
    await u.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await u.click('.tab[data-tab="register"]');
    await u.fill('#r-name', 'Cliente Qualsiasi');
    await u.fill('#r-email', emailCliente);
    await u.fill('#r-pass', 'passwordsicura');
    await u.click('#r-submit');
    await u.waitForURL('**/app');
    await completaBenvenuto(u);

    // Va sulla console già autenticato: deve restare fuori.
    await u.goto(CONSOLE, { waitUntil: 'networkidle' });
    await u.waitForSelector('#porta:not(.nascosto)');
    const esito = await u.evaluate(async () => (await fetch('/console/dati')).status);
    if (esito !== 404) throw new Error(`i dati rispondono ${esito} invece di 404`);
    await cliente.close();
  });

  await step('con le credenziali sbagliate non succede niente', async () => {
    await c.fill('#e', emailCapo);
    await c.fill('#p', 'passwordsbagliata');
    await c.click('#entra');
    await c.waitForFunction(() => document.getElementById('err').textContent.length > 0);
    if (await c.locator('#console:not(.nascosto)').count()) throw new Error('è entrato lo stesso');
  });

  await step('l\'amministratore entra e vede le visite raccolte davvero', async () => {
    await c.fill('#e', emailCapo);
    await c.fill('#p', 'passwordsicura');
    await c.click('#entra');
    await c.waitForSelector('#console:not(.nascosto)');
    await c.waitForSelector('.passo');
    const testo = await c.textContent('#foglio');
    if (!testo.includes('Dal sito al pagamento')) throw new Error('imbuto assente');
    const visite = await c.textContent('.cifra');
    if (Number(visite) < 2) throw new Error(`visite inattese: ${visite}`);
  });

  await step('sa dire chi è arrivato ai prezzi e cosa ha premuto', async () => {
    const testo = await c.textContent('#foglio');
    if (!testo.includes('È arrivato ai prezzi')) throw new Error('passo prezzi assente');
    if (!testo.includes('inizia-piano-pro')) throw new Error('il clic non è elencato');
    if (!/Domande che si aprono/.test(testo)) throw new Error('sezione FAQ assente');
    await shot(c, '59-console');
  });

  await step('un pagamento compare nel quadro', async () => {
    await t.evaluate(() => fetch('/api/billing/demo-attiva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    }));
    await c.click('#aggiorna');
    await c.waitForFunction(() =>
      document.getElementById('foglio').textContent.includes('HA PAGATO'), { timeout: 8000 });
    const testo = await c.textContent('#foglio');
    if (!testo.includes('19')) throw new Error('l\'incasso mensile non compare');
    await shot(c, '60-console-incassi');
  });

  await step('i periodi cambiano i numeri senza ricaricare', async () => {
    await c.click('[data-periodo="oggi"]');
    await c.waitForFunction(() =>
      document.querySelector('.periodo.attivo')?.dataset.periodo === 'oggi', { timeout: 5000 });
    await c.click('[data-periodo="trimestre"]');
    await c.waitForFunction(() =>
      document.querySelector('.periodo.attivo')?.dataset.periodo === 'trimestre', { timeout: 5000 });
  });

  await step('chi rifiuta il tracciamento non viene contato', async () => {
    const conta = async () => c.evaluate(async () =>
      (await (await fetch('/console/dati?periodo=oggi')).json()).traffico.visite);
    const prima = await conta();

    const riservato = await browser.newContext({ extraHTTPHeaders: { DNT: '1' } });
    const r = await riservato.newPage();
    await r.goto(BASE, { waitUntil: 'networkidle' });
    await r.waitForTimeout(700);
    await riservato.close();

    const dopo = await conta();
    if (dopo !== prima) throw new Error(`contate ${dopo - prima} visite di chi ha detto no`);
  });

  await step('uscendo dalla console si torna al muro', async () => {
    await c.click('#esci');
    await c.waitForSelector('#porta:not(.nascosto)');
    if (await c.locator('#console:not(.nascosto)').count()) throw new Error('i dati restano a video');
  });

  await step('su schermo da tablet la console resta leggibile', async () => {
    const tab = await browser.newContext({
      viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true,
    });
    const p = await tab.newPage();
    await p.goto(CONSOLE, { waitUntil: 'networkidle' });
    await p.fill('#e', emailCapo);
    await p.fill('#p', 'passwordsicura');
    await p.click('#entra');
    await p.waitForSelector('.passo');
    const scroll = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (scroll > 2) throw new Error(`la pagina scorre in orizzontale di ${scroll}px`);
    await p.screenshot({ path: 'shots/61-console-tablet.png' });
    await tab.close();
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
