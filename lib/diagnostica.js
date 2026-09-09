'use strict';

/**
 * Diagnostica della configurazione Stripe.
 *
 * Collegare Stripe significa incastrare quattro valori in posti diversi, e
 * sbagliarne uno produce sintomi confusi: il pagamento va a buon fine ma il
 * piano non si attiva, oppure il checkout non parte e basta.
 *
 * Questo modulo controlla ogni pezzo davvero — non si limita a verificare che
 * la variabile esista, ma interroga Stripe per accertarsi che la chiave sia
 * valida, che i prezzi esistano, che siano ricorrenti e nella valuta giusta.
 * Ogni problema arriva con l'istruzione per risolverlo.
 */

const { COMMERCIAL, PLANS } = require('./billing');

const esito = (stato, titolo, dettaglio, azione = null) =>
  ({ stato, titolo, dettaglio, azione });

const OK = 'ok';
const ERRORE = 'errore';
const AVVISO = 'avviso';

/** Verifica la forma della chiave prima di sprecare una chiamata di rete. */
function formaChiave(chiave) {
  if (!chiave) return null;
  if (chiave.startsWith('sk_test_')) return 'test';
  if (chiave.startsWith('sk_live_')) return 'live';
  if (chiave.startsWith('pk_')) return 'pubblicabile';
  return 'sconosciuta';
}

async function esegui() {
  const controlli = [];
  const chiave = process.env.STRIPE_SECRET_KEY || null;
  const webhook = process.env.STRIPE_WEBHOOK_SECRET || null;

  /* ---- 1. Parte commerciale accesa ---- */
  controlli.push(COMMERCIAL
    ? esito(OK, 'Parte commerciale attiva', 'I piani a pagamento sono abilitati.')
    : esito(ERRORE, 'Parte commerciale spenta',
      'Piani e pagamenti sono disattivati, quindi nulla verrà mai addebitato.',
      'Imposta SOLVIA_COMMERCIAL=true e riavvia.'));

  /* ---- 2. Chiave segreta ---- */
  const tipo = formaChiave(chiave);

  if (!chiave) {
    controlli.push(esito(ERRORE, 'Chiave segreta mancante',
      'Senza chiave i pagamenti restano in simulazione: nessun incasso reale.',
      'Dashboard Stripe → Sviluppatori → Chiavi API → copia la "Chiave segreta" '
      + 'e impostala come STRIPE_SECRET_KEY.'));
  } else if (tipo === 'pubblicabile') {
    controlli.push(esito(ERRORE, 'Hai messo la chiave sbagliata',
      'Questa è la chiave pubblicabile (pk_), non quella segreta.',
      'Serve la chiave che inizia con sk_. Sono nella stessa pagina, una sotto l\'altra.'));
  } else if (tipo === 'sconosciuta') {
    controlli.push(esito(ERRORE, 'Chiave in formato non riconosciuto',
      'Una chiave segreta Stripe inizia sempre con sk_test_ o sk_live_.',
      'Ricopiala per intero: probabilmente si è persa una parte.'));
  } else {
    controlli.push(esito(OK, `Chiave segreta presente (modo ${tipo})`,
      tipo === 'test'
        ? 'Sei in modo test: le carte finte funzionano, nessun soldo si muove davvero.'
        : 'Sei in modo LIVE: gli addebiti sono reali.'));
  }

  /* ---- 3. La chiave funziona davvero ---- */
  let stripe = null;
  if (chiave && (tipo === 'test' || tipo === 'live')) {
    try {
      // eslint-disable-next-line global-require
      stripe = require('stripe')(chiave);
      const account = await stripe.accounts.retrieve();

      controlli.push(esito(OK, 'Stripe risponde',
        `Account collegato: ${account.business_profile?.name || account.id}`
        + `${account.country ? ` · paese ${account.country}` : ''}`));

      if (account.charges_enabled === false) {
        controlli.push(esito(AVVISO, 'Account non ancora abilitato agli incassi',
          'Stripe ha accettato la chiave ma l\'account non può ancora ricevere pagamenti.',
          'Completa la verifica nella dashboard Stripe: di solito mancano documento, '
          + 'partita IVA o IBAN.'));
      } else {
        controlli.push(esito(OK, 'Account abilitato agli incassi',
          'Stripe può accettare pagamenti su questo account.'));
      }

      if (account.payouts_enabled === false) {
        controlli.push(esito(AVVISO, 'Accrediti sul conto non ancora attivi',
          'Puoi incassare, ma Stripe non ti gira ancora i soldi sull\'IBAN.',
          'Aggiungi o verifica l\'IBAN nella dashboard Stripe.'));
      }
    } catch (e) {
      const messaggio = e?.raw?.message || e.message;
      controlli.push(esito(ERRORE, 'Stripe rifiuta la chiave', messaggio,
        e?.raw?.type === 'invalid_request_error'
          ? 'La chiave è stata revocata o appartiene a un altro account. Generane una nuova.'
          : 'Controlla la chiave e la connessione del server.'));
      stripe = null;
    }
  }

  /* ---- 4. I prezzi ---- */
  for (const piano of ['pro', 'team']) {
    const variabile = `STRIPE_PRICE_${piano.toUpperCase()}`;
    const priceId = process.env[variabile] || null;
    const nome = PLANS[piano].name;

    if (!priceId) {
      controlli.push(esito(piano === 'pro' ? ERRORE : AVVISO,
        `Prezzo del piano ${nome} non configurato`,
        piano === 'pro'
          ? 'Senza questo, il pulsante "Passa a Pro" non può funzionare.'
          : 'Il piano Team non sarà acquistabile. Va bene se per ora non ti serve.',
        `Dashboard Stripe → Catalogo prodotti → apri il prodotto → copia l'ID del PREZZO `
        + `(inizia con price_, non prod_) e impostalo come ${variabile}.`));
      continue;
    }

    if (!priceId.startsWith('price_')) {
      controlli.push(esito(ERRORE, `ID prezzo ${nome} non valido`,
        priceId.startsWith('prod_')
          ? 'Hai copiato l\'ID del prodotto invece di quello del prezzo.'
          : 'Un ID prezzo Stripe inizia sempre con price_.',
        'Apri il prodotto nella dashboard: l\'ID del prezzo è nella sezione '
        + '"Prezzi", non in cima alla pagina.'));
      continue;
    }

    if (!stripe) {
      controlli.push(esito(AVVISO, `Prezzo ${nome} non verificabile`,
        'L\'ID sembra corretto ma senza una chiave valida non posso controllarlo su Stripe.'));
      continue;
    }

    try {
      const prezzo = await stripe.prices.retrieve(priceId);
      const importo = prezzo.unit_amount != null ? (prezzo.unit_amount / 100) : null;
      const atteso = PLANS[piano].price;

      if (!prezzo.active) {
        controlli.push(esito(ERRORE, `Prezzo ${nome} archiviato`,
          'Questo prezzo esiste ma è disattivato su Stripe: nessuno può acquistarlo.',
          'Riattivalo nella dashboard, oppure creane uno nuovo e aggiorna la variabile.'));
      } else if (prezzo.type !== 'recurring') {
        controlli.push(esito(ERRORE, `Prezzo ${nome} non ricorrente`,
          'È un pagamento una tantum, ma Solvia lo usa come abbonamento mensile.',
          'Crea un nuovo prezzo scegliendo "Ricorrente · Mensile".'));
      } else if (prezzo.currency !== 'eur') {
        controlli.push(esito(AVVISO, `Prezzo ${nome} non in euro`,
          `La valuta impostata è ${prezzo.currency.toUpperCase()}.`,
          'Se i tuoi clienti sono italiani, conviene un prezzo in EUR.'));
      } else if (importo != null && Math.abs(importo - atteso) > 0.01) {
        controlli.push(esito(AVVISO, `Prezzo ${nome}: importo diverso da quello sul sito`,
          `Su Stripe è € ${importo.toFixed(2)}, ma il sito annuncia € ${atteso}.`,
          `Allinea i due valori: o cambi il prezzo su Stripe, o aggiorni PLANS in lib/billing.js.`));
      } else {
        controlli.push(esito(OK, `Prezzo ${nome} verificato`,
          `€ ${importo.toFixed(2)} al mese, ricorrente, attivo.`));
      }
    } catch (e) {
      controlli.push(esito(ERRORE, `Prezzo ${nome} inesistente`,
        e?.raw?.message || e.message,
        'L\'ID non corrisponde a nessun prezzo. Attenzione: gli ID del modo test '
        + 'non funzionano in modo live e viceversa.'));
    }
  }

  /* ---- 5. Webhook ---- */
  if (!webhook) {
    controlli.push(esito(ERRORE, 'Segreto del webhook mancante',
      'È il pezzo che si dimentica più spesso. Senza, il cliente paga ma il piano '
      + 'non si attiva: Stripe prova ad avvisare il server e viene respinto.',
      'In locale: lancia "stripe listen --forward-to localhost:3000/api/billing/webhook" '
      + 'e copia il whsec_ che stampa. Online: Dashboard → Webhook → il tuo endpoint → '
      + 'Segreto di firma.'));
  } else if (!webhook.startsWith('whsec_')) {
    controlli.push(esito(ERRORE, 'Segreto del webhook in formato errato',
      'Un segreto di firma inizia sempre con whsec_.',
      'Hai forse copiato l\'ID dell\'endpoint (we_...) invece del segreto di firma.'));
  } else {
    controlli.push(esito(OK, 'Segreto del webhook presente',
      'Gli eventi firmati da Stripe verranno accettati.'));
  }

  /* ---- 6. Webhook registrati su Stripe ---- */
  const EVENTI_NECESSARI = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
  ];

  if (stripe) {
    try {
      const { data: endpoints } = await stripe.webhookEndpoints.list({ limit: 20 });
      const attivi = endpoints.filter((e) => e.status === 'enabled');

      if (!attivi.length) {
        controlli.push(esito(AVVISO, 'Nessun webhook registrato su Stripe',
          'Normale se stai usando "stripe listen" in locale. In produzione invece serve.',
          'Dashboard → Sviluppatori → Webhook → Aggiungi endpoint, puntandolo a '
          + 'https://tuodominio/api/billing/webhook'));
      } else {
        const coperti = new Set(attivi.flatMap((e) => e.enabled_events));
        const mancanti = coperti.has('*')
          ? [] : EVENTI_NECESSARI.filter((ev) => !coperti.has(ev));

        if (mancanti.length) {
          controlli.push(esito(AVVISO, 'Al webhook mancano alcuni eventi',
            `Non sono selezionati: ${mancanti.join(', ')}.`,
            'Aprilo nella dashboard e aggiungi gli eventi mancanti, altrimenti '
            + 'certi cambi di stato non arriveranno mai.'));
        } else {
          controlli.push(esito(OK, `Webhook registrato (${attivi.length})`,
            'Tutti gli eventi necessari sono selezionati.'));
        }
      }
    } catch {
      // Alcune chiavi ristrette non possono elencare i webhook: non è un errore
      controlli.push(esito(AVVISO, 'Webhook non verificabili',
        'La chiave non ha il permesso di elencare gli endpoint. Controllali a mano '
        + 'nella dashboard.'));
    }
  }

  const errori = controlli.filter((c) => c.stato === ERRORE).length;
  const avvisi = controlli.filter((c) => c.stato === AVVISO).length;

  return {
    pronto: errori === 0,
    modo: tipo === 'live' ? 'live' : (tipo === 'test' ? 'test' : 'nessuno'),
    errori,
    avvisi,
    controlli,
    riassunto: errori === 0
      ? (avvisi === 0
        ? 'Tutto configurato: puoi incassare.'
        : `Funziona, ma ci sono ${avvisi} cose da sistemare.`)
      : `Mancano ${errori} pezzi: i pagamenti non funzioneranno finché non li sistemi.`,
  };
}

module.exports = { esegui };
