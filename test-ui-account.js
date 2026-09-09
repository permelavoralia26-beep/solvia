// Primo accesso e sicurezza dell'account visti dal browser:
// schermata di benvenuto, checklist dei primi passi, cambio password,
// recupero password dalla pagina di accesso.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Server tutto suo con un database vuoto: qui si registrano account nuovi e si
 * cambiano password: su un database condiviso le altre suite ne risentirebbero.
 */
const OWN_SERVER = !process.env.BASE;
const PORT = 4550;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-acc-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest primo accesso e account\n────────────────────────────────────────');

  const email = `benvenuto${Date.now()}@example.com`;

  await step('chi si registra atterra sul benvenuto, non sulla dashboard', async () => {
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Luca Primi Passi');
    await page.fill('#r-email', email);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await page.waitForSelector('.onb-choice');
    const titolo = await page.textContent('#page-title');
    if (!titolo.includes('Benvenuto')) throw new Error(`intestazione inattesa: ${titolo}`);
    if (await page.locator('.stat-value').count()) throw new Error('mostra già la dashboard');
    await shot(page, '45-benvenuto');
  });

  await step('l\'etichetta "consigliato" è leggibile, non colore su colore', async () => {
    const { testo, sfondo } = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.onb-choice-tag'));
      return { testo: s.color, sfondo: s.backgroundColor };
    });
    if (testo === sfondo) throw new Error(`testo e sfondo identici: ${testo}`);
  });

  await step('la barra laterale è visibile ma non cliccabile', async () => {
    const attivo = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.nav-item')).pointerEvents);
    if (attivo !== 'none') throw new Error('le sezioni sono ancora cliccabili');
  });

  await step('non si scavalca la configurazione cambiando indirizzo', async () => {
    await page.goto(`${BASE}/app#invoices`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.onb-choice');
    if (await page.locator('.stat-value').count()) throw new Error('è entrato lo stesso');
  });

  await step('la scelta "account vuoto" non carica dati finti', async () => {
    await page.click('#onb-vuoto');
    await page.waitForSelector('#onb-salva');
    const clienti = await page.evaluate(async () =>
      (await (await fetch('/api/clients')).json()).clients.length);
    if (clienti !== 0) throw new Error(`trovati ${clienti} clienti in un account vuoto`);
  });

  await step('i dati inseriti al passo 2 restano salvati', async () => {
    await page.fill('#onb-attivita', 'Studio Luca');
    await page.fill('#onb-piva', 'IT01234567890');
    await page.fill('#onb-tariffa', '55');
    await page.click('#onb-salva');
    await page.waitForSelector('#onb-fine');
    const u = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user);
    if (u.business_name !== 'Studio Luca') throw new Error('attività non salvata');
    if (u.hourly_rate !== 55) throw new Error('tariffa oraria non salvata');
  });

  await step('si torna indietro senza perdere quanto scritto', async () => {
    await page.click('#onb-indietro');
    await page.waitForSelector('#onb-attivita');
    const valore = await page.inputValue('#onb-attivita');
    if (valore !== 'Studio Luca') throw new Error(`campo ripristinato male: "${valore}"`);
    await page.click('#onb-salva');
    await page.waitForSelector('#onb-fine');
  });

  await step('l\'ultimo passo apre la dashboard vera', async () => {
    await shot(page, '46-benvenuto-fisco');
    await page.click('#onb-fine');
    await page.waitForSelector('.stat-value');
    const attivo = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.nav-item')).pointerEvents);
    if (attivo === 'none') throw new Error('la barra laterale è rimasta bloccata');
  });

  await step('la dashboard mostra la checklist dei primi passi', async () => {
    await page.waitForSelector('.onb-checklist');
    const testo = await page.textContent('.onb-checklist');
    if (!testo.includes('Primi passi')) throw new Error('checklist assente');
    const fatti = await page.locator('.onb-list li.done').count();
    if (fatti < 3) throw new Error(`solo ${fatti} passi risultano fatti, attesi almeno 3`);
    await shot(page, '47-primi-passi');
  });

  await step('ricaricando non ricompare la configurazione', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.stat-value');
    if (await page.locator('.onb-choice').count()) throw new Error('il benvenuto è tornato');
  });

  await step('la password attuale sbagliata non fa uscire dall\'app', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#pw-salva');
    await page.fill('#pw-attuale', 'nonequesta');
    await page.fill('#pw-nuova', 'unanuovapassword');
    await page.fill('#pw-ripeti', 'unanuovapassword');
    await page.click('#pw-salva');
    await page.waitForSelector('#pw-err.show');
    if (!page.url().includes('/app')) throw new Error('è stato disconnesso per un errore di battitura');
  });

  await step('due password diverse vengono fermate prima di partire', async () => {
    await page.fill('#pw-attuale', 'passwordsicura');
    await page.fill('#pw-nuova', 'unanuovapassword');
    await page.fill('#pw-ripeti', 'unaltradiversa');
    await page.click('#pw-salva');
    await page.waitForSelector('#pw-err.show');
    const testo = await page.textContent('#pw-err');
    if (!testo.includes('non coincidono')) throw new Error(`messaggio inatteso: ${testo}`);
  });

  await step('il cambio password riesce e la sessione resta valida', async () => {
    await page.fill('#pw-attuale', 'passwordsicura');
    await page.fill('#pw-nuova', 'unanuovapassword');
    await page.fill('#pw-ripeti', 'unanuovapassword');
    await page.click('#pw-salva');
    await page.waitForSelector('#pw-ok.show');
    await page.click('.nav-item[data-view="dashboard"]');
    await page.waitForSelector('.stat-value');
    await shot(page, '48-account-sicurezza');
  });

  await step('si rientra solo con la password nuova', async () => {
    await page.click('#logout');
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.fill('#l-email', email);
    await page.fill('#l-pass', 'passwordsicura');
    await page.click('#l-submit');
    await page.waitForSelector('#err.show');
    await page.fill('#l-pass', 'unanuovapassword');
    await page.click('#l-submit');
    await page.waitForURL('**/app');
    await page.waitForSelector('.stat-value');
  });

  await step('"password dimenticata" apre il modulo di recupero', async () => {
    // Da autenticati /accedi rimanda all'app: prima si esce.
    await page.click('#logout');
    await page.waitForURL(`${BASE}/`);
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('#show-forgot');
    await page.waitForSelector('#f-email');
    await page.fill('#f-email', email);
    await page.click('#f-submit');
    await page.waitForSelector('#ok.show');
    const testo = await page.textContent('#ok');
    if (!/Se esiste un account/i.test(testo)) throw new Error(`messaggio inatteso: ${testo}`);
    await shot(page, '49-password-dimenticata');
  });

  await step('un link di reimpostazione inventato viene respinto', async () => {
    await page.goto(`${BASE}/reimposta.html?token=inventatodisanapianta`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#scaduto:not(.hidden)');
    if (await page.locator('#form:not(.hidden)').count()) throw new Error('mostra comunque il modulo');
  });

  await step('il link vero porta al modulo e cambia la password', async () => {
    // Si prende il token dall'email archiviata in data/outbox.
    const outbox = path.join(dataDir, 'outbox');
    const file = fs.readdirSync(outbox).sort().reverse()[0];
    const token = fs.readFileSync(path.join(outbox, file), 'utf8').match(/token=([a-f0-9]{64})/)?.[1];
    if (!token) throw new Error('token non trovato nell\'email');

    await page.goto(`${BASE}/reimposta.html?token=${token}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#form:not(.hidden)');
    await page.fill('#p1', 'passwordrecuperata');
    await page.fill('#p2', 'passwordrecuperata');
    await page.click('#salva');
    await page.waitForURL('**/accedi', { timeout: 10000 });

    await page.fill('#l-email', email);
    await page.fill('#l-pass', 'passwordrecuperata');
    await page.click('#l-submit');
    await page.waitForURL('**/app');
    await page.waitForSelector('.stat-value');
  });

  await step('su schermo da tablet il benvenuto resta leggibile', async () => {
    const tablet = await browser.newContext({
      viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true,
    });
    const p = await tablet.newPage();
    await p.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await p.click('.tab[data-tab="register"]');
    await p.fill('#r-name', 'Tablet Nuovo');
    await p.fill('#r-email', `tab${Date.now()}@example.com`);
    await p.fill('#r-pass', 'passwordsicura');
    await p.click('#r-submit');
    await p.waitForURL('**/app');
    await p.waitForSelector('.onb-choice');
    // Le due scelte devono impilarsi, non stringersi fino a diventare illeggibili.
    const larghezza = await p.evaluate(() =>
      document.querySelector('.onb-choice').getBoundingClientRect().width);
    if (larghezza < 300) throw new Error(`scelte troppo strette: ${Math.round(larghezza)}px`);
    const scroll = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (scroll > 2) throw new Error(`la pagina scorre in orizzontale di ${scroll}px`);
    await p.screenshot({ path: 'shots/50-benvenuto-tablet.png' });
    await tablet.close();
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
