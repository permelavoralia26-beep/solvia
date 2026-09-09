// Funzioni Pro viste dall'utente: condivisione preventivo, ricorrenti,
// solleciti, spese, tasse, ricerca globale e tema scuro.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWN_SERVER = !process.env.BASE;
const PORT = 5000;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-pro-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest funzioni Pro nell\'interfaccia\n────────────────────────────────────────');

  await step('il sito mostra il piano Pro a 19 €', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const text = await page.textContent('#prezzi');
    if (!text.includes('€19')) throw new Error('prezzo Pro non trovato');
    if (!text.includes('€0')) throw new Error('piano gratuito non trovato');
    if (!text.includes('accettazione online')) throw new Error('non elenca la funzione principale');
  });

  await step('registrazione e accesso alla dashboard', async () => {
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Anna Pro');
    await page.fill('#r-business', 'Studio Anna');
    await page.fill('#r-email', `pro${Date.now()}@example.com`);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await completaBenvenuto(page);
    await page.waitForSelector('.tax-card');
  });

  await step('la dashboard mostra quanto accantonare per il fisco', async () => {
    const text = await page.textContent('.tax-card');
    if (!text.includes('Da mettere da parte')) throw new Error('riquadro tasse assente');
    if (!/€/.test(text)) throw new Error('importo non calcolato');
    await shot(page, '27-dashboard-pro');
  });

  await step('le funzioni Pro sono bloccate sul piano gratuito', async () => {
    await page.click('.nav-item[data-view="recurring"]');
    await page.waitForSelector('#m-upgrade', { timeout: 10000 });
    const title = await page.textContent('#modal-title');
    if (!title.includes('Limite')) throw new Error(`finestra inattesa: ${title}`);
    await shot(page, '28-blocco-pro');
    await page.click('#m-cancel');
  });

  await step('attivazione Pro dalle impostazioni', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('[data-plan-upgrade="pro"]');
    await page.click('[data-plan-upgrade="pro"]');
    await page.waitForURL('**/pagamento-demo**');
    await page.click('#p-pay');
    await page.waitForURL('**/app**');
    await page.waitForSelector('.badge');
  });

  await step('condivisione preventivo: genera il link', async () => {
    await page.click('.nav-item[data-view="quotes"]');
    await page.waitForSelector('#content tbody tr');
    await page.click('#content [data-edit-doc]');
    await page.waitForSelector('#d-share');
    await page.click('#d-share');
    await page.waitForSelector('#share-url');
    const url = await page.inputValue('#share-url');
    if (!/\/p\/[a-f0-9]{64}$/.test(url)) throw new Error(`link inatteso: ${url}`);
    const testo = await page.inputValue('#share-text');
    if (!testo.includes(url)) throw new Error('il testo pronto non contiene il link');
    await shot(page, '29-link-preventivo');
    global.quoteUrl = url;
  });

  await step('il cliente apre il link e accetta', async () => {
    const client = await browser.newPage({ viewport: { width: 900, height: 1100 } });
    await client.goto(global.quoteUrl, { waitUntil: 'networkidle' });
    await client.waitForSelector('.sheet');

    const testo = await client.textContent('.sheet');
    if (!testo.includes('PREVENTIVO')) throw new Error('intestazione mancante');
    if (!testo.includes('Studio Anna')) throw new Error('mittente non mostrato');

    await client.click('#accept');
    await client.waitForSelector('#conferma');
    await client.fill('#nota', 'Perfetto, quando iniziamo?');
    await client.click('#conferma');
    await client.waitForSelector('.outcome .mark.ok', { timeout: 10000 });
    const esito = await client.textContent('.outcome');
    if (!esito.includes('accettato')) throw new Error('accettazione non registrata');
    await shot(client, '30-preventivo-accettato');
    await client.close();
  });

  await step('chi ha inviato vede subito che è stato accettato', async () => {
    await page.click('#m-cancel');
    await page.click('.nav-item[data-view="dashboard"]');
    await page.waitForSelector('.tax-card');
    const text = await page.textContent('#content');
    if (!text.includes('Accettato')) throw new Error('lo stato accettato non compare in dashboard');
  });

  await step('l\'accettazione ha creato l\'attività "emetti fattura"', async () => {
    await page.click('.nav-item[data-view="tasks"]');
    await page.waitForSelector('[data-toggle]');
    const text = await page.textContent('#content');
    if (!text.includes('Emettere fattura')) throw new Error('attività non creata');
  });

  await step('creazione di un abbonamento ricorrente', async () => {
    await page.click('.nav-item[data-view="recurring"]');
    await page.waitForSelector('#btn-empty-rec', { timeout: 10000 });
    await page.click('#btn-empty-rec');
    await page.waitForSelector('#r-name');
    await page.fill('#r-name', 'Manutenzione mensile');
    await page.selectOption('#r-client', { index: 1 });
    await page.fill('[data-ritem="0"][data-field="description"]', 'Manutenzione sito');
    await page.fill('[data-ritem="0"][data-field="unit_price"]', '200');
    await page.click('#r-save');
    // Selettore ristretto a #content: 'tbody tr' da solo intercetterebbe la
    // tabella delle voci dentro la finestra modale, ancora aperta in quel momento.
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.waitForSelector('#content tbody tr', { timeout: 10000 });
    const text = await page.textContent('#content');
    if (!text.includes('Manutenzione mensile')) throw new Error('abbonamento non creato');
    if (!text.includes('244,00')) throw new Error('ricavo ricorrente non calcolato (200 + IVA)');
    await shot(page, '31-ricorrenti');
  });

  await step('genera subito la fattura dall\'abbonamento', async () => {
    await page.click('.nav-item[data-view="invoices"]');
    await page.waitForSelector('#content tbody tr');
    const before = await page.locator('#content tbody tr').count();

    await page.click('.nav-item[data-view="recurring"]');
    await page.waitForSelector('[data-gen-rec]');
    await page.click('[data-gen-rec]');
    await page.waitForTimeout(1500);

    await page.click('.nav-item[data-view="invoices"]');
    await page.waitForFunction(
      (n) => document.querySelectorAll('#content tbody tr').length > n, before, { timeout: 10000 });
  });

  await step('registrazione di una spesa', async () => {
    await page.click('.nav-item[data-view="expenses"]');
    await page.waitForSelector('#btn-empty-exp', { timeout: 10000 });
    await page.click('#btn-empty-exp');
    await page.waitForSelector('#e-desc');
    await page.fill('#e-desc', 'Abbonamento Adobe');
    await page.fill('#e-amount', '60');
    await page.selectOption('#e-cat', 'software');
    await page.click('#m-save');
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.waitForSelector('#content tbody tr', { timeout: 10000 });
    const text = await page.textContent('#content');
    if (!text.includes('Adobe')) throw new Error('spesa non registrata');
    if (!text.includes('60,00')) throw new Error('importo non mostrato');
    await shot(page, '32-spese');
  });

  await step('la pagina tasse calcola e si può configurare', async () => {
    await page.click('.nav-item[data-view="tax"]');
    await page.waitForSelector('#t-save');
    const text = await page.textContent('#content');
    if (!text.includes('Metti da parte')) throw new Error('riquadro principale assente');
    if (!text.includes('Coefficiente di redditività')) throw new Error('dettaglio calcolo assente');
    if (!text.includes('Stima indicativa')) throw new Error('manca l\'avvertenza sulla stima');

    await page.selectOption('#t-inps', 'artigiani');
    await page.click('#t-save');
    await page.waitForTimeout(1200);
    const dopo = await page.textContent('#content');
    if (!dopo.includes('Artigiani')) throw new Error('impostazione non salvata');
    await shot(page, '33-tasse');
  });

  await step('la ricerca globale trova clienti e documenti', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('#search-input');
    await page.fill('#search-input', 'bianchi');
    await page.waitForSelector('.search-item', { timeout: 10000 });
    const n = await page.locator('.search-item').count();
    if (n < 1) throw new Error('nessun risultato');
    await shot(page, '34-ricerca');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#search-backdrop', { state: 'hidden' });
  });

  await step('il tema scuro si attiva e resta dopo il ricaricamento', async () => {
    await page.click('#theme-toggle');
    await page.waitForTimeout(900);
    const tema = await page.getAttribute('html', 'data-theme');
    if (tema !== 'scuro') throw new Error(`tema inatteso: ${tema}`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#user-name');
    await page.waitForTimeout(600);
    const dopo = await page.getAttribute('html', 'data-theme');
    if (dopo !== 'scuro') throw new Error('il tema non è stato ricordato');
    await shot(page, '35-tema-scuro');
  });

  await step('i solleciti mostrano lo stato corretto', async () => {
    await page.click('.nav-item[data-view="reminders"]');
    await page.waitForSelector('#content .card', { timeout: 10000 });
    const text = await page.textContent('#content');
    if (!/sollecit/i.test(text)) throw new Error('sezione solleciti vuota o errata');
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
