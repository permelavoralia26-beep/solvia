#!/usr/bin/env node
'use strict';

/**
 * Controllo prima del volo.
 *
 * Elenca in un colpo solo tutto ciò che va sistemato prima di far entrare
 * persone vere, e distingue fra ciò che è **rotto** (rosso: non pubblicare) e
 * ciò che è **da sistemare** (giallo: pubblica pure, ma sappilo).
 *
 * Serve perché gli errori peggiori di una messa online sono silenziosi: il
 * database che si azzera, le sessioni che cadono a ogni riavvio, la pagina
 * legale che mostra "[Nome e Cognome]" a un potenziale cliente. Nessuno di
 * questi dà un errore: danno un sito che sembra funzionare.
 *
 * Uso:  node controllo.js       (oppure: npm run controllo)
 * Viene eseguito anche all'avvio quando NODE_ENV=production.
 */

const fs = require('fs');
const path = require('path');

const ROSSO = '\x1b[31m';
const GIALLO = '\x1b[33m';
const VERDE = '\x1b[32m';
const FINE = '\x1b[0m';

/** Un controllo: { stato: 'ok' | 'avviso' | 'errore', titolo, azione } */
function esegui() {
  const v = process.env;
  const controlli = [];
  const ok = (titolo) => controlli.push({ stato: 'ok', titolo });
  const avviso = (titolo, azione) => controlli.push({ stato: 'avviso', titolo, azione });
  const errore = (titolo, azione) => controlli.push({ stato: 'errore', titolo, azione });

  const produzione = v.NODE_ENV === 'production';

  /* ---- Sessioni ---- */
  if (v.SOLVIA_SECRET) ok('Chiave delle sessioni impostata');
  else if (produzione) {
    errore('Chiave delle sessioni mancante',
      'Senza SOLVIA_SECRET la chiave cambia a ogni riavvio: tutti gli utenti vengono '
      + 'disconnessi ogni volta che il server riparte. Su Render usa generateValue: true.');
  } else {
    avviso('Chiave delle sessioni generata al volo',
      'In sviluppo va bene. In produzione imposta SOLVIA_SECRET.');
  }

  /* ---- Dove vivono i dati ---- */
  const dir = v.SOLVIA_DATA_DIR || './data';
  if (!produzione) {
    ok(`Cartella dati: ${dir}`);
  } else if (dir.startsWith('/tmp') || dir.startsWith('./') || !path.isAbsolute(dir)) {
    errore(`Cartella dati non persistente: ${dir}`,
      'In produzione SOLVIA_DATA_DIR deve puntare a un disco che sopravvive ai riavvii '
      + '(su Render: /var/data con un disco collegato). Altrimenti il database si azzera '
      + 'a ogni deploy, senza dare nessun errore.');
  } else {
    ok(`Cartella dati su percorso assoluto: ${dir}`);
  }

  /* ---- La console di direzione ---- */
  const percorso = v.SOLVIA_CONSOLE_PATH || 'console';
  if (percorso === 'console') {
    avviso('La console è sull\'indirizzo predefinito (/console)',
      'È il primo che chiunque proverebbe. Imposta SOLVIA_CONSOLE_PATH con qualcosa '
      + 'che conosci solo tu.');
  } else {
    ok(`Console su un indirizzo tuo (/${percorso})`);
  }

  /* ---- Pagine legali ---- */
  const segnaposto = [];
  for (const f of ['privacy.html', 'cookie.html', 'termini.html']) {
    const file = path.join(__dirname, 'public', f);
    if (!fs.existsSync(file)) { segnaposto.push(`${f} (assente)`); continue; }
    const testo = fs.readFileSync(file, 'utf8');
    if (/\[Nome e Cognome\]|\[tua-email@esempio\.it\]|\[indirizzo, città\]/.test(testo)) {
      segnaposto.push(f);
    }
  }
  if (segnaposto.length) {
    errore(`Pagine legali da compilare: ${segnaposto.join(', ')}`,
      'Imposta SOLVIA_TITOLARE, SOLVIA_CONTATTO_EMAIL e SOLVIA_INDIRIZZO, poi rigenera '
      + 'con "npm run build:pages". Finché restano i segnaposto, i visitatori leggono '
      + '"[Nome e Cognome]" nella tua informativa privacy.');
  } else {
    ok('Pagine legali compilate');
  }

  /* ---- Incassi: le combinazioni che si contraddicono ---- */
  const commerciale = v.SOLVIA_COMMERCIAL !== 'false';
  const prelancio = commerciale && v.SOLVIA_PRELANCIO === 'true';
  const stripe = Boolean(v.STRIPE_SECRET_KEY);

  if (!commerciale && stripe) {
    avviso('Progetto gratuito, ma le chiavi Stripe sono impostate',
      'Con SOLVIA_COMMERCIAL=false non si incassa niente comunque, quindi quelle chiavi '
      + 'stanno lì senza servire. Toglile finché non riaccendi il listino: una chiave che '
      + 'non serve è solo una cosa in più che si può perdere.');
  } else if (!commerciale) {
    ok('Progetto gratuito: nessun prezzo, nessun incasso, nessun obbligo');
  } else if (prelancio && stripe) {
    avviso('Pre-lancio acceso ma Stripe è già configurato',
      'Con SOLVIA_PRELANCIO=true i pagamenti restano chiusi anche se le chiavi ci sono. '
      + 'Se sei pronto a incassare, togli SOLVIA_PRELANCIO.');
  } else if (prelancio) {
    ok('Pre-lancio: prezzi visibili, incassi chiusi, lista d\'attesa attiva');
  } else if (stripe) {
    ok('Pagamenti collegati a Stripe');
  } else {
    avviso('Prezzi esposti ma nessun incasso configurato',
      'Il sito mostra 19 €/mese e il pagamento è simulato: chi ci prova se ne accorge. '
      + 'Accendi SOLVIA_PRELANCIO=true finché non colleghi Stripe.');
  }

  /* ---- Sostegno volontario ---- */
  const sostegno = require('./lib/sostegno').diagnosi();
  if (sostegno.stato === 'acceso') {
    ok(`Sostegno volontario attivo: ${sostegno.motivo}`);
  } else if (sostegno.stato === 'rotto') {
    errore(`Sostegno volontario configurato male: ${sostegno.motivo}`,
      'Finché non torna a posto il pulsante non compare — ed è giusto così, ma se pensavi '
      + 'di averlo acceso, non lo è. Servono SOLVIA_SOSTIENI_URL (indirizzo https di una '
      + 'piattaforma riconosciuta) e il nome di chi riceve i soldi.');
  }

  /* ---- Email ---- */
  if (v.SMTP_HOST) ok('Invio email configurato');
  else {
    avviso('Nessun SMTP: le email non partono davvero',
      'Conferme newsletter, recupero password e inviti allo studio finiscono in '
      + 'data/outbox/ invece di essere spediti. Va bene per provare, non per il pubblico.');
  }

  /* ---- Chi comanda ---- */
  try {
    const { db } = require('./lib/db');
    const admin = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
    const utenti = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (!utenti) {
      avviso('Nessun account registrato',
        'Il primo che si registra diventa amministratore: registrati tu per primo.');
    } else if (!admin) {
      errore('Nessun amministratore',
        'Nessuno può aprire la console. Sistemalo con: node amministratore.js tua@email.it');
    } else {
      ok(`${admin} amministratore${admin > 1 ? 'i' : ''} su ${utenti} account`);
    }
  } catch (e) {
    avviso('Database non leggibile in questo momento', e.message);
  }

  const errori = controlli.filter((c) => c.stato === 'errore').length;
  const avvisi = controlli.filter((c) => c.stato === 'avviso').length;

  return {
    pronto: errori === 0,
    errori,
    avvisi,
    controlli,
    riassunto: errori
      ? `${errori} cos${errori > 1 ? 'e' : 'a'} da sistemare prima di pubblicare`
      : avvisi
        ? `Si può pubblicare, ma ${avvisi} cos${avvisi > 1 ? 'e meritano' : 'a merita'} attenzione`
        : 'Tutto a posto: puoi pubblicare',
  };
}

/** Stampa leggibile, usata sia dal comando sia dall'avvio in produzione. */
function stampa(esito = esegui(), compatto = false) {
  const SEGNO = { ok: `${VERDE}✓${FINE}`, avviso: `${GIALLO}!${FINE}`, errore: `${ROSSO}✗${FINE}` };

  console.log('');
  console.log('  Controllo prima del volo');
  console.log('  ────────────────────────');
  for (const c of esito.controlli) {
    // In modalità compatta (avvio del server) si tace su ciò che è già a posto.
    if (compatto && c.stato === 'ok') continue;
    console.log(`  ${SEGNO[c.stato]} ${c.titolo}`);
    if (c.azione) console.log(`      → ${c.azione}`);
  }
  const colore = esito.errori ? ROSSO : esito.avvisi ? GIALLO : VERDE;
  console.log(`  ${colore}${esito.riassunto}${FINE}\n`);
}

module.exports = { esegui, stampa };

if (require.main === module) {
  const esito = esegui();
  stampa(esito);
  process.exit(esito.pronto ? 0 : 1);
}
