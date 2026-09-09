// Percorso newsletter visto dall'utente: iscrizione → conferma → disiscrizione,
// più pagine legali e diritti GDPR nell'applicazione.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Questa suite avvia un server con un database vuoto tutto suo.
 * Motivo: l'amministratore è il primo account registrato, quindi su un database
 * condiviso con altri test l'utente creato qui non sarebbe amministratore e le
 * verifiche sul pannello fallirebbero per un motivo che non c'entra col codice.
 */
const OWN_SERVER = !process.env.BASE;
const PORT = 4500;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-nl-'));
  server = spawn('node', [path.join(__dirname, 'server.js')], {
    // SOLVIA_COMMERCIAL=false: questa suite verifica la modalità "progetto
    // gratuito" — pannello newsletter, diritti GDPR e nessun prezzo esposto.
    // Il percorso di acquisto è coperto da test-ui-billing.js.
    env: {
      ...process.env, PORT: String(PORT), SOLVIA_DATA_DIR: dataDir, SOLVIA_COMMERCIAL: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* non ancora pronto */ }
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

  console.log('\nTest newsletter, pagine legali e GDPR\n────────────────────────────────────────');

  const adminEmail = `titolare${Date.now()}@example.com`;
  const readerEmail = `lettore${Date.now()}@example.com`;

  await step('la home espone i due piani in modo chiaro', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const text = await page.textContent('body');
    if (!text.includes('€19')) throw new Error('prezzo Pro non trovato');
    if (!text.includes('€0')) throw new Error('piano gratuito non trovato');
    if (!/disdici quando vuoi/i.test(text)) throw new Error('manca la rassicurazione sulla disdetta');
    await shot(page, '16-home');
  });

  await step('il modulo newsletter richiede il consenso esplicito', async () => {
    await page.click('a[href="#newsletter"]');
    await page.waitForSelector('#news-form');
    const checked = await page.isChecked('#n-consent');
    if (checked) throw new Error('il consenso risulta già spuntato: non è valido');
    await page.fill('#n-email', readerEmail);
    await page.fill('#n-name', 'Anna Verdi');
    // Senza spuntare il consenso il browser blocca l'invio (campo required)
    const valid = await page.evaluate(() => document.getElementById('news-form').checkValidity());
    if (valid) throw new Error('il modulo si invia anche senza consenso');
  });

  await step('iscrizione riuscita e messaggio di conferma', async () => {
    await page.check('#n-consent');
    await page.click('#n-submit');
    await page.waitForSelector('#n-msg.show');
    const msg = await page.textContent('#n-msg');
    if (!msg.includes('conferma')) throw new Error(`messaggio inatteso: ${msg}`);
    await shot(page, '17-newsletter-iscrizione');
  });

  await step('le pagine legali si aprono e hanno contenuto', async () => {
    for (const [path, expected] of [
      ['/privacy.html', 'Informativa privacy'],
      ['/cookie.html', 'Cookie policy'],
      ['/termini.html', "Termini d'uso"],
    ]) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      const h1 = await page.textContent('h1');
      if (!h1.includes(expected)) throw new Error(`${path}: titolo inatteso "${h1}"`);
      const body = await page.textContent('.doc');
      if (body.length < 1200) throw new Error(`${path}: contenuto troppo breve`);
    }
    await shot(page, '18-privacy');
  });

  await step('la privacy spiega i diritti e cita il Garante', async () => {
    await page.goto(`${BASE}/privacy.html`, { waitUntil: 'networkidle' });
    const text = await page.textContent('.doc');
    for (const term of ['Garante', 'art. 17', 'consenso', 'bcrypt']) {
      if (!text.includes(term)) throw new Error(`manca il riferimento a "${term}"`);
    }
  });

  await step('registrazione del primo account (amministratore)', async () => {
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Titolare Progetto');
    await page.fill('#r-email', adminEmail);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await completaBenvenuto(page);
  });

  await step('le impostazioni mostrano il piano gratuito, non un abbonamento', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#gdpr-delete');
    const text = await page.textContent('#content');
    if (!text.includes('Gratuito')) throw new Error('non indica che è gratuito');
    if (text.includes('19/mese')) throw new Error('mostra ancora un prezzo');
    if (!text.includes('Scarica i miei dati')) throw new Error('manca l\'esportazione dati');
    await shot(page, '19-impostazioni-gdpr');
  });

  await step('l\'esportazione dei dati scarica un file leggibile', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#gdpr-export'),
    ]);
    const path = await download.path();
    if (!path) throw new Error('nessun file scaricato');
    const content = require('fs').readFileSync(path, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed.account || !parsed.informazioni) throw new Error('struttura del file inattesa');
    if (content.includes('password_hash')) throw new Error('il file contiene l\'impronta della password');
  });

  await step('la cancellazione account chiede conferma con password', async () => {
    await page.click('#gdpr-delete');
    await page.waitForSelector('#del-pass');
    const body = await page.textContent('#modal-body');
    if (!/non si può annullare/i.test(body)) throw new Error('manca l\'avviso di irreversibilità');
    await page.fill('#del-pass', 'password-sbagliata');
    await page.click('#m-delete');
    await page.waitForSelector('#del-err.show');
    await page.click('#m-cancel');
  });

  await step('il pannello newsletter è raggiungibile dall\'amministratore', async () => {
    await page.goto(`${BASE}/newsletter-admin`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#s-confirmed');
    const pending = await page.textContent('#s-pending');
    if (Number(pending) < 1) throw new Error(`atteso almeno 1 iscritto in attesa, trovato ${pending}`);
    await shot(page, '20-newsletter-admin');
  });

  await step('si può scrivere e salvare una campagna', async () => {
    await page.fill('#c-subject', 'Solvia — le novità di agosto');
    await page.fill('#c-body', 'Ciao! Questo mese ho aggiunto la newsletter e le pagine legali.');
    await page.click('#save');
    await page.waitForSelector('#ok.show');
    await page.click('.tabbar button[data-tab="campagne"]');
    await page.waitForSelector('#campaigns-list table');
    const rows = await page.locator('#campaigns-list tbody tr').count();
    if (rows < 1) throw new Error('la campagna non compare in elenco');
  });

  await step('la scheda "Email inviate" mostra le email registrate', async () => {
    await page.click('.tabbar button[data-tab="inviate"]');
    await page.waitForSelector('#outbox-list .eml');
    const text = await page.textContent('#outbox-list');
    if (!text.includes('Conferma')) throw new Error('manca l\'email di conferma iscrizione');
  });

  await step('un utente normale non entra nel pannello', async () => {
    await page.click('a[href="/app"]');
    await page.waitForSelector('#logout');
    await page.click('#logout');
    await page.waitForURL(`${BASE}/`);

    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Utente Normale');
    await page.fill('#r-email', `normale${Date.now()}@example.com`);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await completaBenvenuto(page, 'vuoto');

    await page.goto(`${BASE}/newsletter-admin`, { waitUntil: 'networkidle' });
    if (!/\/app(#|$)/.test(page.url())) throw new Error(`non reindirizzato: sono su ${page.url()}`);
    if (await page.locator('#s-confirmed').count()) throw new Error('il pannello è comunque visibile');
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
