# Configurare Stripe — guida passo passo

L'integrazione è **già scritta e testata**, e la parte commerciale è **accesa di
default**: piani, limiti e pagina prezzi sono già attivi. Questa guida serve solo a
collegare il tuo account Stripe. Finché non lo fai, l'app gira in **modalità
simulazione**: il flusso di pagamento funziona per intero (scelta piano → pagamento →
sblocco funzioni → disdetta) ma non viene incassato nulla. Puoi provare tutto adesso.

**Prerequisito:** Stripe in Italia richiede la **partita IVA** in fase di registrazione,
insieme a codice fiscale, documento d'identità e IBAN intestato a te o alla tua attività.
Senza P.IVA non completi la verifica dell'account. Tutti i passi qui sotto restano validi:
li esegui il giorno in cui hai la P.IVA, senza toccare una riga di codice.

---

## I quattro valori (e a chi si danno)

Tutta la configurazione sta in quattro variabili d'ambiente. Il codice non va toccato.

| Valore | Esempio | Segreto? |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | **Sì.** Chi ce l'ha può muovere soldi sul tuo account |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | **Sì.** Chi ce l'ha può fingere pagamenti mai avvenuti |
| `STRIPE_PRICE_PRO` | `price_...` | No. È solo l'identificativo di un listino |
| `STRIPE_PRICE_TEAM` | `price_...` | No |

**I due segreti non si incollano da nessuna parte se non nel pannello del tuo host.**
Non in un file del repository, non in una chat, non in un'email — nemmeno a chi ti sta
aiutando col codice. Su Render li inserisci in *Environment*: `render.yaml` li dichiara
già con `sync: false`, così Render te li chiede al primo deploy e li tiene nel suo
archivio cifrato, fuori da GitHub.

Se un segreto ti scappa: Dashboard → *Sviluppatori* → *Chiavi API* → revoca e rigenera.
Non c'è altro da fare, e non è un dramma se lo fai subito.

Finché le variabili sono vuote l'app funziona lo stesso, in **modalità simulazione**.

---

## 1. Crea l'account

Vai su [dashboard.stripe.com/register](https://dashboard.stripe.com/register).

In alto trovi l'interruttore **"Modalità test"**. Tienilo **attivo** per tutta questa
guida: userai carte finte e nessun soldo si muove.

Durante l'attivazione ti chiederanno tipo di attività (*Azienda individuale* se sei
freelance con P.IVA), P.IVA e codice fiscale, documento d'identità, e IBAN per gli accrediti.
La verifica richiede da poche ore a qualche giorno.

---

## 2. Crea i due prodotti

Dashboard → **Catalogo prodotti** → **Aggiungi prodotto**.

**Prodotto 1**

- Nome: `Solvia Pro`
- Modello di determinazione prezzi: **Ricorrente**
- Importo: `19,00` EUR — Periodo di fatturazione: **Mensile**

Salva, poi apri il prodotto e copia l'**ID del prezzo**: inizia con `price_`.
Attenzione: serve l'ID del *prezzo* (`price_...`), non quello del prodotto (`prod_...`).

**Prodotto 2**

Stessa cosa con nome `Solvia Team` e importo `49,00` EUR mensile. Copia anche questo `price_`.

---

## 3. Prendi la chiave segreta

Dashboard → **Sviluppatori** → **Chiavi API** → copia la **Chiave segreta**.

In modalità test inizia con `sk_test_`. **Non metterla mai in un file che finisce su
GitHub e non incollarla in una chat.** Se ti scappa, revocala dalla stessa pagina e generane una nuova.

---

## 4. Configura il webhook

Il webhook è come Stripe ti avvisa che un pagamento è andato a buon fine, che un rinnovo
è fallito o che qualcuno ha disdetto. **Senza, gli abbonamenti non si attivano.**

### In locale, mentre sviluppi

Installa la [Stripe CLI](https://stripe.com/docs/stripe-cli), poi:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Il comando stampa un segreto che inizia con `whsec_`: è quello che ti serve.
Lascia il comando aperto in un terminale mentre provi.

### Online, in produzione

Dashboard → **Sviluppatori** → **Webhook** → **Aggiungi endpoint**.

- URL: `https://iltuodominio.it/api/billing/webhook`
- Eventi da ascoltare (seleziona esattamente questi cinque):
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Salva e copia il **Segreto di firma** (`whsec_...`).

---

## 5. Avvia con le variabili

```bash
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_WEBHOOK_SECRET=whsec_... \
STRIPE_PRICE_PRO=price_... \
STRIPE_PRICE_TEAM=price_... \
npm start
```

All'avvio il server stampa `Pagamenti: stripe`. Se stampa ancora `demo`, la chiave
non è stata letta.

Verifica anche da browser: `http://localhost:3000/api/health` deve rispondere
`"billingMode":"stripe"`.

---

## 6. Prova un pagamento vero (con carta finta)

1. Entra nell'app → **Impostazioni** → **Passa a Pro**
2. Ti porta sul vero Checkout di Stripe
3. Usa la carta di test: **`4242 4242 4242 4242`**, scadenza qualsiasi data futura,
   CVC qualsiasi, CAP qualsiasi
4. Completa il pagamento

Dopo il redirect il piano deve risultare **Pro** e i limiti spariti.

Altre carte di test utili:

| Numero | Cosa simula |
|---|---|
| `4242 4242 4242 4242` | Pagamento riuscito |
| `4000 0000 0000 9995` | Fondi insufficienti |
| `4000 0025 0000 3155` | Richiede autenticazione 3D Secure |
| `4000 0000 0000 0341` | La carta fallisce al primo rinnovo |

Se il piano non si aggiorna, il problema è quasi sempre il webhook: controlla che
`stripe listen` sia in esecuzione, o guarda Dashboard → Webhook → il tuo endpoint →
**Tentativi**, dove vedi le risposte del tuo server.

---

## 7. Passare in produzione

1. Completa la verifica dell'account (P.IVA, documento, IBAN)
2. Disattiva **Modalità test** nella dashboard
3. Ricrea i due prodotti in modalità live — **gli ID `price_` del modo test non funzionano in live**
4. Prendi la chiave `sk_live_...` e crea un nuovo webhook sul dominio di produzione
5. Riavvia con le variabili live e `NODE_ENV=production`

Fai una prova con carta reale da 1 € (poi rimborsala dalla dashboard) prima di annunciare.

---

## Se qualcosa non torna: usa la diagnostica

Dentro l'app, in **Impostazioni → Configurazione pagamenti**, c'è un pulsante
*Verifica configurazione*. Non si limita a controllare che le variabili esistano:
interroga Stripe per accertarsi che la chiave sia valida, che l'account possa
incassare, che i prezzi esistano davvero, che siano ricorrenti e in euro, e che
il webhook sia registrato con tutti gli eventi giusti.

Ogni problema che trova arriva con l'istruzione precisa per risolverlo.
Riconosce da sola gli errori più comuni:

- chiave pubblicabile (`pk_`) al posto di quella segreta (`sk_`)
- ID del prodotto (`prod_`) al posto dell'ID del prezzo (`price_`)
- ID dell'endpoint (`we_`) al posto del segreto di firma (`whsec_`)
- prezzo archiviato, non ricorrente, o in valuta diversa dall'euro
- prezzo del modo test usato in modo live (o viceversa)
- account Stripe non ancora abilitato a incassare o ad accreditare sull'IBAN

È riservata all'amministratore, perché mostra dettagli dell'account.

## Come funziona sotto il cofano

| Cosa | Dove |
|---|---|
| Piani, limiti, logica abbonamenti | `lib/billing.js` |
| Endpoint checkout, portale, webhook | `routes/billing.js` |
| Webhook montato con `express.raw` **prima** di `express.json` | `server.js` |
| Stato del piano sull'utente | tabella `users` |
| Pagina di pagamento simulata | `public/pagamento-demo.html` |

**Perché il webhook è montato prima di `express.json`:** la verifica della firma
richiede il corpo grezzo della richiesta. Se il JSON viene interpretato prima, la firma
non torna e ogni evento viene rifiutato. È l'errore più comune con Stripe.

**Sicurezza:** ogni webhook non firmato o firmato con un segreto sbagliato viene
respinto con un 400. Senza questa verifica, chiunque conoscesse l'indirizzo potrebbe
regalarsi un abbonamento Pro con una singola richiesta.

**Limiti dei piani:** definiti in `PLANS` dentro `lib/billing.js`. Per cambiare i
limiti del piano Free modifica solo quell'oggetto — i controlli nelle rotte li leggono
da lì. Ricordati di aggiornare anche i prezzi su Stripe se cambi gli importi.

---

## Test

```bash
npm run test:billing      # 23 test: limiti, attivazione, disdetta, permessi
npm run test:diagnostica  # 18 test: la diagnostica riconosce gli errori tipici
npm run test:webhook      # 18 test: firme reali e ciclo di vita dell'abbonamento
npm run test:ui:billing   #  7 test su browser: dal limite raggiunto alla disdetta
```

I test webhook usano chiavi finte e la libreria ufficiale Stripe per generare firme
valide: verificano il percorso di produzione senza bisogno di un account reale.
