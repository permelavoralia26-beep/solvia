// Studio condiviso visto dal browser: il titolare invita, il collaboratore
// entra dal link e trova il lavoro già lì, il titolare lo rimuove.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWN_SERVER = !process.env.BASE;
const PORT = 4560;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-studio-'));
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

/** Pesca dall'archivio email il token dell'ultimo messaggio inviato. */
function ultimoToken() {
  const dir = path.join(dataDir, 'outbox');
  const file = fs.readdirSync(dir).sort().reverse()[0];
  return fs.readFileSync(path.join(dir, file), 'utf8').match(/token=([a-f0-9]{64})/)?.[1];
}

(async () => {
  if (OWN_SERVER) await startServer();
  process.on('exit', stopServer);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  const titolare = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const collega = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const t = await titolare.newPage();
  const c = await collega.newPage();
  [t, c].forEach((p) => p.on('pageerror', (e) => errors.push(String(e))));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest studio condiviso su browser\n────────────────────────────────────────');

  const emailTitolare = `capo${Date.now()}@example.com`;
  const emailCollega = `socio${Date.now()}@example.com`;

  await step('il titolare crea lo studio', async () => {
    await t.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await t.click('.tab[data-tab="register"]');
    await t.fill('#r-name', 'Marco Titolare');
    await t.fill('#r-business', 'Studio Marco');
    await t.fill('#r-email', emailTitolare);
    await t.fill('#r-pass', 'passwordsicura');
    await t.click('#r-submit');
    await t.waitForURL('**/app');
    await completaBenvenuto(t);
  });

  await step('senza piano Team la scheda spiega, non finge', async () => {
    await t.click('.nav-item[data-view="settings"]');
    await t.waitForSelector('[data-plan-upgrade="team"]');
    const testo = await t.textContent('#content');
    if (!testo.includes('Studio condiviso')) throw new Error('scheda studio assente');
    if (await t.locator('#studio-invita').count()) {
      throw new Error('mostra il modulo di invito senza il piano che lo permette');
    }
    await shot(t, '51-studio-senza-piano');
  });

  await step('attivato il Team compare il modulo di invito', async () => {
    await t.evaluate(() => fetch('/api/billing/demo-attiva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'team' }),
    }));
    await t.click('.nav-item[data-view="dashboard"]');
    await t.waitForSelector('.stat-value');
    await t.click('.nav-item[data-view="settings"]');
    await t.waitForSelector('#studio-invita');
    const testo = await t.textContent('#content');
    if (!testo.includes('di 5 posti')) throw new Error('non mostra i posti disponibili');
  });

  await step('un indirizzo già registrato viene rifiutato con un motivo', async () => {
    await t.fill('#studio-email', emailTitolare);
    await t.click('#studio-invita');
    await t.waitForSelector('#studio-err.show');
    const testo = await t.textContent('#studio-err');
    if (!/già un account/.test(testo)) throw new Error(`messaggio inatteso: ${testo}`);
  });

  await step('l\'invito parte e compare in sospeso', async () => {
    await t.fill('#studio-email', emailCollega);
    await t.click('#studio-invita');
    await t.waitForSelector('.membro.in-attesa');
    const testo = await t.textContent('.membro.in-attesa');
    if (!testo.includes(emailCollega)) throw new Error('invito non elencato');
    await shot(t, '52-studio-invito');
  });

  await step('chi riceve il link vede chi lo ha invitato', async () => {
    await c.goto(`${BASE}/invito.html?token=${ultimoToken()}`, { waitUntil: 'networkidle' });
    await c.waitForSelector('#valido:not(.hidden)');
    const testo = await c.textContent('.studio-nome');
    if (!testo.includes('Studio Marco')) throw new Error('non mostra il nome dello studio');
    if (!testo.includes('Marco Titolare')) throw new Error('non dice chi invita');
    const email = await c.inputValue('#email');
    if (email !== emailCollega) throw new Error('indirizzo sbagliato nel modulo');
    await shot(c, '53-invito-pagina');
  });

  await step('un link inventato non apre niente', async () => {
    const p = await collega.newPage();
    await p.goto(`${BASE}/invito.html?token=inventato`, { waitUntil: 'networkidle' });
    await p.waitForSelector('#scaduto:not(.hidden)');
    // Il modulo vive dentro #valido: è quel contenitore a essere nascosto.
    if (await p.locator('#valido:not(.hidden)').count()) throw new Error('mostra comunque il modulo');
    await p.close();
  });

  await step('entrando trova il lavoro già lì, senza configurazione', async () => {
    await c.fill('#nome', 'Anna Collaboratrice');
    await c.fill('#pass', 'passwordsicura');
    await c.click('#entra');
    await c.waitForURL('**/app');
    // Niente schermata di benvenuto: entra dritta nella dashboard dello studio.
    await c.waitForSelector('.stat-value');
    if (await c.locator('.onb-choice').count()) {
      throw new Error('le hanno rifatto fare la configurazione iniziale');
    }
    await c.click('.nav-item[data-view="clients"]');
    await c.waitForSelector('#content tbody tr');
    const testo = await c.textContent('#content');
    if (!testo.includes('Caffè Aurora')) throw new Error('non vede i clienti dello studio');
    await shot(c, '54-collaboratore-dentro');
  });

  await step('quello che fa lei, il titolare lo vede firmato col suo nome', async () => {
    await c.click('[data-action="new-client"]');
    await c.waitForSelector('#c-name');
    await c.fill('#c-name', 'Cliente Trovato Da Anna');
    await c.click('#m-save');
    await c.waitForSelector('#modal-backdrop', { state: 'hidden' });

    await t.click('.nav-item[data-view="dashboard"]');
    await t.waitForSelector('.stat-value');
    await t.waitForFunction(
      () => document.querySelector('#content')?.textContent.includes('Cliente Trovato Da Anna'),
      { timeout: 10000 },
    );
    const autore = await t.textContent('.autore');
    if (!autore.includes('Anna')) throw new Error(`autore inatteso: ${autore}`);
    await shot(t, '55-attivita-firmata');
  });

  await step('la collaboratrice non vede pulsanti che non può premere', async () => {
    await c.click('.nav-item[data-view="settings"]');
    await c.waitForSelector('#studio-esci');
    if (await c.locator('#studio-invita').count()) throw new Error('può invitare, non dovrebbe');
    if (await c.locator('[data-plan-upgrade]').count()) throw new Error('le propone un abbonamento');
    const testo = await c.textContent('#content');
    if (!testo.includes('Piano Team')) throw new Error('non mostra a che piano lavora');
    await shot(c, '56-impostazioni-collaboratore');
  });

  await step('il titolare la rimuove e lei perde l\'accesso', async () => {
    await t.click('.nav-item[data-view="settings"]');
    await t.waitForSelector('[data-rimuovi]');
    await t.click('[data-rimuovi]');
    await t.waitForSelector('#conf-si');
    await t.click('#conf-si');
    await t.waitForSelector('#modal-backdrop', { state: 'hidden' });

    await c.reload({ waitUntil: 'networkidle' });
    await c.waitForURL('**/accedi**', { timeout: 10000 });
  });

  await step('il cliente che aveva inserito resta allo studio', async () => {
    await t.click('.nav-item[data-view="clients"]');
    await t.waitForSelector('#content tbody tr');
    const testo = await t.textContent('#content');
    if (!testo.includes('Cliente Trovato Da Anna')) throw new Error('il lavoro è sparito con lei');
  });

  await step('su schermo da tablet la scheda studio resta leggibile', async () => {
    const tab = await browser.newContext({
      viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true,
    });
    const p = await tab.newPage();
    await p.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await p.fill('#l-email', emailTitolare);
    await p.fill('#l-pass', 'passwordsicura');
    await p.click('#l-submit');
    await p.waitForURL('**/app');
    await p.click('#menu-toggle');
    await p.click('.nav-item[data-view="settings"]');
    await p.waitForSelector('.membro');
    const scroll = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (scroll > 2) throw new Error(`la pagina scorre in orizzontale di ${scroll}px`);
    await p.screenshot({ path: 'shots/57-studio-tablet.png' });
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
