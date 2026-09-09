// Nuove funzioni viste dall'utente, su schermo tablet: firma col dito,
// cronometro, portale cliente, app installabile.
const { chromium, devices } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWN_SERVER = !process.env.BASE;
const PORT = 5300;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-extra-'));
  server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), SOLVIA_DATA_DIR: dataDir, SOLVIA_COMMERCIAL: 'true' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* non pronto */ }
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

  // Contesto che imita un tablet Samsung: schermo grande e input a tocco.
  const tablet = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await tablet.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest su schermo tablet\n────────────────────────────────────────');

  await step('registrazione e attivazione Pro', async () => {
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Anna Tablet');
    await page.fill('#r-business', 'Studio Anna');
    await page.fill('#r-email', `tab${Date.now()}@example.com`);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await completaBenvenuto(page);
    await page.waitForSelector('.tax-card');
    await page.evaluate(() => fetch('/api/billing/demo-attiva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    }));
  });

  await step('il manifest è dichiarato e valido', async () => {
    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    if (href !== '/manifest.json') throw new Error('manifest non collegato');
    const m = await (await fetch(`${BASE}/manifest.json`)).json();
    if (m.display !== 'standalone') throw new Error('non si apre a schermo intero');
    if (!m.icons.some((i) => i.purpose === 'maskable')) throw new Error('manca l\'icona per Android');
  });

  await step('il service worker si registra', async () => {
    await page.waitForFunction(() => navigator.serviceWorker?.controller
      || navigator.serviceWorker?.getRegistrations().then((r) => r.length > 0), { timeout: 15000 });
    const n = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
    if (n < 1) throw new Error('nessun service worker registrato');
  });

  await step('il cronometro parte, avanza e si ferma', async () => {
    await page.click('.nav-item[data-view="time"]');
    await page.waitForSelector('#t-start');
    await page.fill('#t-desc', 'Revisione grafica homepage');
    await page.selectOption('#t-client', { index: 1 });
    await page.fill('#t-rate', '55');
    await page.click('#t-start');
    await page.waitForSelector('#timer-display', { timeout: 10000 });

    const testo = await page.textContent('#content');
    if (!testo.includes('Revisione grafica')) throw new Error('descrizione non mostrata');
    if (!testo.includes('55,00')) throw new Error('tariffa non mostrata');
    await shot(page, '36-cronometro');

    await page.click('#t-stop');
    await page.waitForSelector('#t-start', { timeout: 10000 });
  });

  await step('ore inserite a mano e trasformate in fattura', async () => {
    await page.click('[data-action="new-time"]');
    await page.waitForSelector('#m-desc');
    await page.fill('#m-desc', 'Consulenza strategica');
    await page.selectOption('#m-client', { index: 1 });
    await page.fill('#m-hours', '4');
    await page.fill('#m-rate', '60');
    await page.click('#m-save');
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.waitForSelector('#content tbody tr', { timeout: 10000 });

    const testo = await page.textContent('#content');
    if (!testo.includes('Consulenza strategica')) throw new Error('voce non registrata');
    if (!testo.includes('240,00')) throw new Error('importo (4 × 60) non calcolato');
    await shot(page, '37-ore');

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/time/fattura')),
      page.click('[data-action="bill-time"]'),
    ]);
    await page.waitForFunction(() => location.hash === '#invoices', { timeout: 15000 });
    await page.waitForSelector('#content tbody tr', { timeout: 10000 });
    if (!/Fatture/.test(await page.textContent('#page-title'))) {
      throw new Error('non è passato alle fatture dopo la fatturazione');
    }
  });

  await step('il portale cliente si genera e si apre', async () => {
    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('#content [data-portal]');
    await page.click('#content [data-portal]');
    await page.waitForSelector('#portal-url', { timeout: 15000 });
    const url = await page.inputValue('#portal-url');
    if (!/\/c\/[a-f0-9]{64}$/.test(url)) throw new Error(`link inatteso: ${url}`);

    const cliente = await tablet.newPage();
    await cliente.goto(url, { waitUntil: 'networkidle' });
    await cliente.waitForSelector('.docs');
    const testo = await cliente.textContent('body');
    if (!testo.includes('Ciao')) throw new Error('intestazione mancante');
    if (!testo.includes('Totale fatturato')) throw new Error('riepilogo mancante');
    if (testo.includes('Bozza')) throw new Error('sono visibili documenti in bozza');
    await shot(cliente, '38-portale-cliente');
    await cliente.close();
  });

  await step('il cliente firma il preventivo col dito', async () => {
    await page.click('#m-cancel');
    await page.click('.nav-item[data-view="quotes"]');
    await page.waitForSelector('#content tbody tr');
    await page.click('#content [data-edit-doc]');
    await page.waitForSelector('#d-share');
    await page.click('#d-share');
    await page.waitForSelector('#share-url');
    const url = await page.inputValue('#share-url');

    const cliente = await tablet.newPage();
    await cliente.goto(url, { waitUntil: 'networkidle' });
    await cliente.waitForSelector('#accept');
    await cliente.click('#accept');
    await cliente.waitForSelector('#sign-canvas', { state: 'visible', timeout: 10000 });
    // Il riquadro si predispone subito dopo essere comparso: senza questa attesa
    // gli eventi di tocco arriverebbero prima dei gestori.
    await cliente.waitForSelector('#sign-pad[data-ready="1"]', { timeout: 10000 });

    // Firma tracciata con veri eventi di tocco: è il percorso che userà
    // il cliente da telefono o tablet, diverso da quello del mouse.
    await cliente.evaluate(() => {
      const canvas = document.getElementById('sign-canvas');
      const r = canvas.getBoundingClientRect();
      const touch = (x, y) => new Touch({
        identifier: 1, target: canvas,
        clientX: r.left + x, clientY: r.top + y,
      });
      const fire = (type, x, y) => canvas.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [touch(x, y)],
        changedTouches: [touch(x, y)],
      }));

      fire('touchstart', 30, r.height / 2);
      for (let i = 1; i <= 12; i += 1) {
        fire('touchmove', 30 + i * 18, r.height / 2 + Math.sin(i) * 26);
      }
      fire('touchend', 30 + 12 * 18, r.height / 2);
    });
    await cliente.waitForTimeout(200);

    const drawn = await cliente.locator('#sign-pad.drawn').count();
    if (!drawn) throw new Error('la firma non è stata registrata sul riquadro');

    await cliente.fill('#firmatario', 'Mario Bianchi');
    await cliente.fill('#nota', 'Perfetto, procediamo');
    await shot(cliente, '39-firma');

    await cliente.click('#conferma');
    await cliente.waitForSelector('.outcome .mark.ok', { timeout: 15000 });
    const testo = await cliente.textContent('.outcome');
    if (!testo.includes('Mario Bianchi')) throw new Error('il nome del firmatario non compare');
    if (!await cliente.locator('.signed-box img').count()) throw new Error('la firma non è mostrata');
    await shot(cliente, '40-firmato');
    await cliente.close();
  });

  await step('il riepilogo annuale si scarica', async () => {
    // La finestra di condivisione resta aperta dal passo precedente e
    // intercetterebbe i clic sul menu.
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#report-link');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#report-link'),
    ]);
    const file = await download.path();
    if (!file) throw new Error('nessun file scaricato');
    const head = fs.readFileSync(file).subarray(0, 4).toString();
    if (head !== '%PDF') throw new Error(`non è un PDF: ${head}`);
    await shot(page, '41-impostazioni-tablet');
  });

  await step('la pagina offline esiste ed è leggibile', async () => {
    const p2 = await tablet.newPage();
    await p2.goto(`${BASE}/offline.html`, { waitUntil: 'networkidle' });
    const testo = await p2.textContent('body');
    if (!testo.includes('senza connessione')) throw new Error('messaggio offline mancante');
    await p2.close();
  });

  await step('a schermo stretto il menu resta raggiungibile', async () => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.stat-value');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) throw new Error(`la pagina straborda di ${overflow}px`);
    await page.click('#menu-toggle');
    await page.waitForSelector('.sidebar.open');
    await shot(page, '42-telefono');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  console.log('────────────────────────────────────────');
  console.log(errors.length ? `\x1b[31mErrori console: ${errors.join(' | ')}\x1b[0m`
                            : '\x1b[32mNessun errore in console\x1b[0m');
  console.log('');
  await browser.close();
  if (OWN_SERVER) stopServer();

  // Senza questo, il processo resta appeso al server figlio e la suite
  // "finita" non restituisce mai il terminale.
  process.exit(process.exitCode || 0);
})();
