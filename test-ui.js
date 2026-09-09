// Verifica dell'interfaccia con browser reale: registrazione, navigazione, azioni chiave.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');

const BASE = process.env.BASE || 'http://localhost:3000';
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png`, fullPage: false });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  [32m✓[0m ${label}`); }
    catch (e) { console.log(`  [31m✗[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest interfaccia Solvia\n────────────────────────────────────────');

  await step('landing page si carica', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1');
    await shot(page, '01-landing');
  });

  await step('pulsante porta alla pagina di accesso', async () => {
    await page.click('a[href="/accedi"]');
    await page.waitForSelector('#login-form');
    await shot(page, '02-accedi');
  });

  const email = `ui${Date.now()}@example.com`;
  await step('registrazione crea account ed entra nell\'app', async () => {
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Giulia Ferrari');
    await page.fill('#r-business', 'Studio Ferrari Design');
    await page.fill('#r-email', email);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    // Chi si registra vede la schermata di benvenuto, non la dashboard.
    await completaBenvenuto(page);
  });

  await step('dashboard mostra statistiche reali', async () => {
    const value = await page.textContent('.stat-value');
    if (!value.includes('€')) throw new Error(`valore inatteso: ${value}`);
    const bars = await page.locator('#revenue-chart .bar').count();
    if (bars !== 6) throw new Error(`attese 6 colonne mensili, trovate ${bars}`);
    const drawn = await page.evaluate(() => [...document.querySelectorAll('#revenue-chart .bar')]
      .filter((b) => Number(b.getAttribute('height')) > 0).length);
    if (drawn < 1) throw new Error('nessuna colonna con incassi disegnata');
    await shot(page, '03-dashboard');
  });

  await step('analisi email dalla dashboard produce bozze', async () => {
    await page.click('[data-action="triage-all"]');
    await page.waitForFunction(() => !document.querySelector('[data-action="triage-all"]'), { timeout: 15000 });
  });

  await step('inbox mostra classificazione e bozza di risposta', async () => {
    await page.click('.nav-item[data-view="inbox"]');
    await page.waitForSelector('#draft');
    const draft = await page.inputValue('#draft');
    if (!draft.includes('Gentile')) throw new Error('bozza mancante');
    const badge = await page.textContent('.assistant-box .badge');
    if (!badge.trim()) throw new Error('categoria mancante');
    await shot(page, '04-inbox');
  });

  await step('attività si caricano e si completano', async () => {
    await page.click('.nav-item[data-view="tasks"]');
    await page.waitForSelector('[data-toggle]');
    const before = await page.locator('[data-toggle]').count();
    if (before < 5) throw new Error(`attese 5 attività, trovate ${before}`);
    await page.locator('[data-toggle]').first().check();
    await page.waitForSelector('.card-head h2:has-text("Completate")');
    await shot(page, '05-attivita');
  });

  await step('preventivi elencati con totali', async () => {
    await page.click('.nav-item[data-view="quotes"]');
    await page.waitForSelector('tbody tr');
    await shot(page, '06-preventivi');
  });

  await step('editor genera voci da descrizione libera', async () => {
    await page.click('[data-action="new-quote"]');
    await page.waitForSelector('#d-ai');
    await page.fill('#d-ai', 'progettazione logo 900 €; brochure 12 pagine 1.400 €; stampa 300 €');
    await page.click('#d-ai-btn');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-field="description"]').length >= 3, { timeout: 15000 });
    const total = await page.textContent('#t-total');
    if (!total.includes('3.172')) throw new Error(`totale inatteso: ${total} (atteso 2600 + 22% IVA)`);
    await shot(page, '07-editor-preventivo');
  });

  await step('preventivo creato viene salvato', async () => {
    await page.selectOption('#d-client', { index: 1 });
    const before = await page.locator('tbody tr').count();
    await page.click('#d-save');
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.waitForFunction(
      (n) => document.querySelectorAll('tbody tr').length > n, before, { timeout: 10000 });
    const total = await page.locator('tbody tr').first().textContent();
    if (!total.includes('P-')) throw new Error('numerazione preventivo mancante in elenco');
  });

  await step('fatture: apertura documento e download PDF', async () => {
    await page.click('.nav-item[data-view="invoices"]');
    await page.waitForSelector('tbody tr');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('a[href*="/pdf"]'),
    ]);
    const path = await download.path();
    if (!path) throw new Error('PDF non scaricato');
    await shot(page, '08-fatture');
  });

  await step('clienti mostrano fatturato per cliente', async () => {
    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('tbody tr');
    const rows = await page.locator('tbody tr').count();
    if (rows < 3) throw new Error(`attesi almeno 3 clienti, trovati ${rows}`);
    await shot(page, '09-clienti');
  });

  await step('impostazioni salvano i dati aziendali', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#s-vat');
    await page.fill('#s-vat', 'IT01234567890');
    await page.fill('#s-address', 'Via Roma 10, 20121 Milano');
    await page.click('#s-save');
    await page.waitForSelector('#s-ok.show');
    await shot(page, '10-impostazioni');
  });

  await step('la sessione persiste dopo un ricaricamento', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#user-name');
    const name = await page.textContent('#user-name');
    if (!name.includes('Giulia')) throw new Error('sessione persa');
  });

  await step('tasto Indietro del browser cambia sezione', async () => {
    await page.click('.nav-item[data-view="clients"]');
    await page.waitForSelector('tbody tr');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#settings', { timeout: 10000 });
    await page.waitForSelector('#s-vat');
  });

  await step('vista mobile senza sovrapposizioni', async () => {
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/app#dashboard`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.stat-value');
      await shot(page, '11-mobile');
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) throw new Error(`la pagina straborda di ${overflow}px in orizzontale`);
    } finally {
      await page.setViewportSize({ width: 1440, height: 950 });
    }
  });

  await step('logout riporta al sito pubblico', async () => {
    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#logout');
    await page.click('#logout');
    await page.waitForURL(`${BASE}/`);
  });

  await step('l\'app non è accessibile dopo il logout', async () => {
    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
    if (!page.url().includes('/accedi')) throw new Error(`atteso reindirizzamento, sono su ${page.url()}`);
  });

  console.log('────────────────────────────────────────');
  console.log(errors.length ? `[31mErrori console: ${errors.length}[0m\n${errors.join('\n')}`
                            : '[32mNessun errore in console[0m');
  console.log('');

  await browser.close();
})();
