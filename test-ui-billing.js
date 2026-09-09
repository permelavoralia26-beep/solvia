// Percorso completo di acquisto visto dall'utente: limite raggiunto → pagamento → sblocco → disdetta.
const { chromium } = require('playwright');
const { completaBenvenuto } = require('./test-helpers');

const BASE = process.env.BASE || 'http://localhost:3000';
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

(async () => {
  // Di default la parte commerciale è spenta: senza piani non c'è nulla da provare.
  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (health.billingMode === 'disattivato') {
    console.log('\nTest percorso di acquisto');
    console.log('────────────────────────────────────────');
    console.log('  saltati — la parte commerciale è disattivata (progetto gratuito).');
    console.log('  Per eseguirli: SOLVIA_COMMERCIAL=true npm start');
    console.log('────────────────────────────────────────\n');
    return;
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest percorso di acquisto\n────────────────────────────────────────');

  await step('registrazione di un nuovo account', async () => {
    await page.goto(`${BASE}/accedi`, { waitUntil: 'networkidle' });
    await page.click('.tab[data-tab="register"]');
    await page.fill('#r-name', 'Marco Pagante');
    await page.fill('#r-email', `pay${Date.now()}@example.com`);
    await page.fill('#r-pass', 'passwordsicura');
    await page.click('#r-submit');
    await page.waitForURL('**/app');
    await completaBenvenuto(page);
  });

  await step('impostazioni mostrano piano Free e consumo', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('[data-plan-upgrade="pro"]');
    const text = await page.textContent('.card');
    if (!text.includes('Free')) throw new Error('piano Free non indicato');
    if (!text.includes('Consumo di questo mese')) throw new Error('consumo non mostrato');
    await shot(page, '12-abbonamento-free');
  });

  await step('superare il limite apre la proposta di upgrade', async () => {
    await page.click('.nav-item[data-view="quotes"]');
    await page.waitForSelector('[data-action="new-quote"]');
    // Il piano Free consente 5 preventivi al mese; l'account demo ne ha già 1.
    for (let i = 0; i < 6; i += 1) {
      const visible = await page.locator('#modal-backdrop.open').count();
      if (visible) break;
      await page.click('[data-action="new-quote"]');
      await page.waitForSelector('#d-save');
      await page.fill('[data-field="description"]', `Preventivo di prova ${i + 1}`);
      await page.fill('[data-field="unit_price"]', '100');
      await page.click('#d-save');
      await page.waitForTimeout(600);
    }
    await page.waitForSelector('#m-upgrade', { timeout: 10000 });
    const title = await page.textContent('#modal-title');
    if (!title.includes('Limite')) throw new Error(`finestra inattesa: ${title}`);
    await shot(page, '13-limite-raggiunto');
  });

  await step('il pulsante porta alla pagina di pagamento', async () => {
    await page.click('#m-upgrade');
    await page.waitForURL('**/pagamento-demo**');
    await page.waitForSelector('#p-pay');
    const left = await page.textContent('.pay-left');
    if (!left.includes('Pro')) throw new Error('piano non mostrato nel riepilogo');
    if (!left.includes('19')) throw new Error('prezzo non mostrato');
    await shot(page, '14-pagamento');
  });

  await step('il pagamento attiva il piano Pro', async () => {
    await page.click('#p-pay');
    await page.waitForURL('**/app**');
    await page.waitForSelector('.badge');
    const text = await page.textContent('.card');
    if (!text.includes('Pro')) throw new Error('piano Pro non attivo');
    if (!text.includes('illimitato')) throw new Error('limiti non rimossi');
    await shot(page, '15-abbonamento-pro');
  });

  await step('le funzioni bloccate ora funzionano', async () => {
    await page.click('.nav-item[data-view="quotes"]');
    await page.waitForSelector('[data-action="new-quote"]');
    const before = await page.locator('tbody tr').count();
    await page.click('[data-action="new-quote"]');
    await page.waitForSelector('#d-save');
    await page.fill('[data-field="description"]', 'Preventivo dopo upgrade');
    await page.fill('[data-field="unit_price"]', '500');
    await page.click('#d-save');
    await page.waitForSelector('#modal-backdrop', { state: 'hidden' });
    await page.waitForFunction((n) => document.querySelectorAll('tbody tr').length > n, before,
      { timeout: 10000 });
  });

  await step('la disdetta riporta al piano Free', async () => {
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#b-cancel');
    await page.click('#b-cancel');
    await page.waitForSelector('[data-plan-upgrade="pro"]', { timeout: 10000 });
    const text = await page.textContent('.card');
    if (!text.includes('Free')) throw new Error('non è tornato al piano Free');
  });

  console.log('────────────────────────────────────────');
  console.log(errors.length ? `\x1b[31mErrori console: ${errors.join(' | ')}\x1b[0m`
                            : '\x1b[32mNessun errore in console\x1b[0m');
  console.log('');
  await browser.close();
})();
