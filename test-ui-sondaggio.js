// Progetto gratuito visto dal browser: il listino non c'è, al suo posto c'è la
// domanda sul prezzo, e chi risponde lo fa in tre tocchi anche dal telefono.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4810;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const shot = (page, name) => page.screenshot({ path: `shots/${name}.png` });

let server = null;
let dataDir = null;

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solvia-sond-'));
  server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), SOLVIA_DATA_DIR: dataDir, SOLVIA_COMMERCIAL: 'false',
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

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--disable-background-networking', '--disable-sync', '--no-first-run'],
  });
  const errors = [];
  const step = async (label, fn) => {
    try { await fn(); console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
    catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${label} — ${e.message}`); process.exitCode = 1; }
  };

  console.log('\nTest sondaggio sul prezzo su browser\n────────────────────────────────────────');

  // Uno schermo da telefono: è da lì che arriverà quasi tutto il traffico.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));

  await step('il listino sparisce dal sito', async () => {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    if (await p.isVisible('#prezzi')) throw new Error('la sezione prezzi è ancora visibile');
    // Le cifre del sondaggio sono un'altra cosa: qui si controlla che non resti
    // in giro un *listino*, cioè un prezzo al mese o un piano da comprare.
    // innerText e non textContent: il listino è ancora nel documento, ma
    // nascosto — quello che conta è cosa *legge* chi apre la pagina.
    const testo = await p.evaluate(() => document.body.innerText);
    if (/\/mese|Prova Pro|Passa a Pro|Prova Team/i.test(testo)) {
      throw new Error('sulla pagina compare ancora un piano a pagamento');
    }
    if (/Perché 19 euro/i.test(testo)) throw new Error('resta una domanda frequente sul prezzo');
  });

  await step('e al suo posto c\'è la domanda', async () => {
    await p.waitForSelector('#sondaggio:not([hidden])', { timeout: 8000 });
    const testo = await p.textContent('#sondaggio');
    if (!/Quanto pagheresti/i.test(testo)) throw new Error('la domanda non c\'è');
    await shot(p, '70-sondaggio-telefono');
  });

  await step('il menù non manda più a una pagina che non esiste', async () => {
    const restanti = await p.$$eval('a[href="#prezzi"]', (a) => a.length);
    if (restanti) throw new Error(`${restanti} link puntano ancora ai prezzi`);
  });

  await step('senza scegliere una cifra non parte, e lo spiega', async () => {
    await p.click('#sond-invia');
    await p.waitForTimeout(300);
    const msg = await p.textContent('#sond-msg');
    if (!/Scegli una cifra/i.test(msg)) throw new Error(`messaggio inatteso: "${msg}"`);
  });

  await step('la cifra scelta si vede che è scelta', async () => {
    await p.click('.sond-cifra[data-importo="19"]');
    const premuto = await p.getAttribute('.sond-cifra[data-importo="19"]', 'aria-pressed');
    if (premuto !== 'true') throw new Error('il pulsante non risulta selezionato');
    await p.waitForTimeout(350);   // il colore arriva con la transizione
    // Il contrasto conta: un pulsante "scelto" che resta identico agli altri non
    // comunica niente, e chi risponde dal telefono non capisce se ha premuto.
    const leggi = (sel) => p.$eval(sel, (el) => {
      const s = getComputedStyle(el);
      return { testo: s.color, sfondo: s.backgroundColor };
    });
    const scelto = await leggi('.sond-cifra[data-importo="19"]');
    const altro = await leggi('.sond-cifra[data-importo="29"]');
    if (scelto.testo === scelto.sfondo) throw new Error('testo e sfondo hanno lo stesso colore');
    if (scelto.sfondo === altro.sfondo) throw new Error('il selezionato è uguale agli altri');
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(scelto.sfondo)) {
      throw new Error('il selezionato è rimasto trasparente');
    }
  });

  await step('si risponde anche senza lasciare email né mestiere', async () => {
    await p.click('#sond-invia');
    await p.waitForSelector('#sond-msg.ok', { timeout: 8000 });
    const msg = await p.textContent('#sond-msg');
    if (!/Grazie/i.test(msg)) throw new Error(`messaggio inatteso: "${msg}"`);
    await shot(p, '71-sondaggio-risposta');
  });

  await step('rispondere di nuovo corregge invece di raddoppiare', async () => {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#sondaggio:not([hidden])');
    await p.click('.sond-cifra[data-importo="29"]');
    await p.fill('#sond-mestiere', 'fotografo');
    await p.click('#sond-invia');
    await p.waitForSelector('#sond-msg.ok', { timeout: 8000 });
  });

  await step('in console il titolare vede la risposta, non due', async () => {
    const stato = await p.evaluate(async () => {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'capo@solvia.it', password: 'passwordsicura', name: 'Capo' }),
      });
      return r.status;
    });
    if (stato !== 201) throw new Error(`registrazione non riuscita (${stato})`);

    const d = await p.evaluate(async () => {
      const r = await fetch('/console/dati');
      if (!r.ok) throw new Error(`la console risponde ${r.status}`);
      return (await r.json()).sondaggio;
    });
    if (d.totale !== 1) throw new Error(`risposte contate: ${d.totale}`);
    if (d.mediana !== 29) throw new Error(`mediana inattesa: ${d.mediana}`);
    if (!d.ultime[0].mestiere) throw new Error('il mestiere non è arrivato');
  });

  await step('c\'è la sezione "dai una mano", e non chiede soldi', async () => {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#mano:not([hidden])', { timeout: 8000 });
    const testo = await p.evaluate(() => document.getElementById('mano').innerText);
    if (!/Non voglio soldi/i.test(testo)) throw new Error('manca la frase chiave');
    if (!/non raccoglie donazioni/i.test(testo)) throw new Error('non lo dice esplicitamente');
    // Nominare le donazioni per escluderle va bene; quello che non deve esserci
    // è un modo *concreto* di mandare soldi.
    const soldi = await p.evaluate(() => {
      const dentro = document.getElementById('mano');
      const link = [...dentro.querySelectorAll('a')].map((a) => a.href).join(' ');
      const campi = dentro.querySelectorAll('input, form').length;
      return { link, campi };
    });
    if (/paypal|ko-fi|kofi|buymeacoffee|patreon|stripe|satispay|revolut/i.test(soldi.link)) {
      throw new Error('c\'è un link per pagare: ' + soldi.link);
    }
    if (soldi.campi) throw new Error('c\'è un modulo dove si potrebbe inserire un importo');
    // Il sostegno volontario non è configurato in questa prova: la scheda deve
    // restare invisibile. Un pulsante "paga" che compare da solo è il guasto
    // peggiore possibile su un sito che promette di non chiedere soldi.
    if (await p.isVisible('#sostegno')) throw new Error('la scheda del sostegno è visibile senza essere configurata');
    await p.locator('#mano').screenshot({ path: 'shots/72-dai-una-mano.png' });
  });

  await step('il messaggio da passare a un amico si copia', async () => {
    // Il permesso agli appunti non c'è in un browser di prova: quello che conta
    // è che il pulsante risponda comunque invece di restare muto.
    await p.click('#mano-copia');
    await p.waitForTimeout(400);
    const esito = await p.textContent('#mano-esito-3');
    if (!esito.trim()) throw new Error('il pulsante non dice niente a chi lo preme');
  });

  await step('dentro l\'app non compare nessun piano a pagamento', async () => {
    // Il benvenuto in tre passi sta prima di tutto: lo si conclude dall'API,
    // perché qui interessa cosa mostrano le impostazioni, non l'onboarding.
    await p.evaluate(async () => {
      await fetch('/api/onboarding/dati', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'vuoto' }),
      });
      await fetch('/api/onboarding/completa', { method: 'POST' });
    });
    await p.goto(`${BASE}/app#settings`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.card', { timeout: 15000 });
    await p.waitForTimeout(600);
    const testo = await p.evaluate(() => document.body.innerText);
    if (/19\s*€|€\s*19|Passa a Pro/i.test(testo)) throw new Error('compare un piano a pagamento');
    if (!/gratuito|Tutto incluso/i.test(testo)) throw new Error('non dice che è gratuito');
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
