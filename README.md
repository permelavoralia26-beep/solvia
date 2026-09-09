# Solvia

Un copilota per il lavoro amministrativo di chi lavora da solo: smista le email,
prepara preventivi e fatture, tiene traccia di scadenze e incassi.

**Gratis per iniziare, 19 €/mese per le funzioni che fanno risparmiare tempo davvero.**

Non è un prototipo: c'è un backend reale con database e autenticazione, ed è coperto
da **588 test automatici** che girano a ogni modifica del codice.

📱 **Senza PC:** [IPHONE.md](IPHONE.md) per fare tutto dall'iPhone (modifiche, push,
deploy), [SAMSUNG.md](SAMSUNG.md) per farlo girare sul tablet Android.

---

## Avvio rapido

Serve [Node.js 18+](https://nodejs.org).

```bash
npm install
npm start
```

Apri **http://localhost:3000** e crea un account. Al primo accesso Solvia ti guida in
tre passi: scegli se partire da un account vuoto o precaricato con clienti, fatture ed
email di esempio, inserisci i dati che finiscono sulle fatture, imposti il regime fiscale.

> **Se `npm install` mostra errori su `better-sqlite3`, ignorali: l'app parte lo stesso.**
> È una dipendenza opzionale; se non riesce a compilarsi, Solvia usa il modulo
> `node:sqlite` incluso in Node 22+. All'avvio il server stampa quale driver sta usando.

Il **primo account registrato è l'amministratore** e vede il pannello newsletter.
Per fissare l'indirizzo in anticipo, imposta `SOLVIA_ADMIN_EMAIL`.

---

## Cosa fa

| Sezione | Funzioni |
|---|---|
| **Dashboard** | Incassato del mese, crediti aperti e scaduti, grafico a 6 mesi, prossime attività |
| **Inbox** | Classifica le email per categoria e urgenza, prepara le bozze di risposta, le trasforma in attività o preventivi |
| **Attività** | Elenco con priorità e scadenze, evidenza degli scaduti |
| **Preventivi** | Creazione da descrizione in linguaggio naturale, numerazione progressiva, conversione in fattura |
| **Fatture** | IVA e ritenuta d'acconto, stati, rilevamento scadute, export PDF |
| **Ore** | Cronometro per cliente, registro ore, conversione automatica in fattura |
| **Ricorrenti** | Abbonamenti clienti che generano la fattura da soli, con ricavo mensile ricorrente a colpo d'occhio |
| **Solleciti** | Promemoria per le fatture scadute, con tono crescente. Preparati in automatico, inviati solo dopo la tua approvazione |
| **Spese** | Registrazione per categoria e distribuzione, per sapere quanto resta davvero |
| **Tasse** | Quanto accantonare per imposta sostitutiva e contributi, in base al tuo regime |
| **Clienti** | Anagrafica con fatturato per cliente |
| **Newsletter** | Iscrizione con doppia conferma, gestione iscritti, scrittura e invio delle campagne |
| **Studio** | Fino a 5 persone sugli stessi dati, inviti, ruoli, registro di chi ha fatto cosa (piano Team) |
| **Impostazioni** | Dati aziendali, cambio password, esportazione dei propri dati, cancellazione account |

Più: **ricerca globale** con `Ctrl/Cmd + K`, **tema scuro** ricordato sul profilo,
**riepilogo annuale in PDF** per il commercialista, e **app installabile** sulla
schermata home di telefono e tablet.

### Primo accesso e account

Chi si registra non atterra sulla dashboard: vede una **schermata di benvenuto** in tre
passi. La prima domanda è se vuole un account vuoto o precaricato con dati di esempio da
esplorare — che poi si rimuovono con un clic dalle Impostazioni. Lo stato sta sul server,
quindi la configurazione non si salta svuotando il browser e riprende dal punto giusto
anche cambiando dispositivo. Finita, una **checklist dei primi passi** resta sulla
dashboard finché c'è qualcosa da fare, poi sparisce da sola.

Sul fronte accesso: **recupero password via email** (link valido un'ora e una volta sola,
nel database solo la sua impronta), **cambio password** dalle Impostazioni che disconnette
le sessioni aperte altrove, e **blocco dopo cinque tentativi** falliti sullo stesso account.

### Studio condiviso (piano Team)

Fino a cinque persone lavorano sullo **stesso** archivio: stessi clienti, stessi
preventivi, stesse fatture. Non cinque copie da tenere allineate a mano.

Il titolare invita per email; chi accetta crea la propria password e si ritrova dentro,
senza rifare la configurazione iniziale e senza dati di esempio: vede subito il lavoro
vero. Ogni azione resta **firmata da chi l'ha fatta** — nel registro attività compare il
nome, così si sa sempre chi ha mandato cosa. Il collaboratore lavora ma non tocca
abbonamento, dati fiscali e account degli altri; l'accesso si revoca in un clic e il
lavoro fatto resta allo studio, perché era dello studio fin dall'inizio.

Sotto il cofano non c'è una tabella "studi": lo studio **è** l'account del titolare, e
`users.studio_id` punta lì. Nessuna interrogazione al database è stata modificata per far
entrare i collaboratori — l'isolamento fra studi diversi resta quello di sempre, già
coperto dai test. Chi entra lavora con l'identità dello studio sulle rotte dei dati e con
la propria su account, password e pagamenti (`lib/studio.js`).

### La console di direzione — piattaforma separata

Non è una funzione di Solvia e **i clienti non devono nemmeno sapere che esiste**: è lo
strumento con cui chi vende il prodotto guarda come sta andando. Vive su un indirizzo
suo (`/console`, spostabile con `SOLVIA_CONSOLE_PATH`), ha un aspetto diverso apposta —
scuro, denso, senza marchio — e chiede l'accesso per conto proprio.

Dentro: quante persone arrivano sul sito e da dove, chi scorre fino ai prezzi, quali
pulsanti vengono premuti, quali domande frequenti si aprono; e dall'altra parte quanti
account nascono, quanti si fermano al benvenuto, chi paga, quanto entra al mese, chi ha
disdetto. Più un flusso in diretta degli ultimi fatti, che si aggiorna da solo.

L'imbuto ha sei passi. I primi tre contano visitatori anonimi, gli ultimi tre contano
account: sono due misure diverse, e la pagina lo dice invece di far finta che sia la
stessa persona seguita fino in fondo.

**Come sta nascosta.** L'applicazione dei clienti non contiene una riga del suo codice —
`public/js/app.js` non la nomina, e la barra laterale non ha nessuna voce in più per
nessuno. La pagina sta in `riservato/`, fuori dai file statici, quindi non si trova
indovinando un indirizzo. A chi non è amministratore risponde **404, non 403**, con una
risposta identica byte per byte a quella di un indirizzo inventato: un "vietato" direbbe
comunque "qui c'è qualcosa". Anche il nome del prodotto arriva dal server solo a chi ha
diritto: chi apre la console e legge il codice della pagina non trova niente da collegare.

**Come si contano le persone senza spiarle.** Da IP e browser si calcola
`sha256(sale_del_giorno + IP + user-agent)`, e si conserva solo quello. L'IP non viene
mai scritto: nemmeno per un istante. Il sale cambia ogni giorno, quindi la stessa persona
domani è un'impronta diversa e non c'è modo di seguirla nel tempo — nemmeno per chi
amministra il server, perché non esiste nessuna tabella di corrispondenza. Del referrer
resta il dominio, non la ricerca digitata. Chi invia `Do Not Track` o il Global Privacy
Control non viene contato affatto, e il controllo è sia nel browser sia sul server.
Niente cookie di statistica, quindi niente banner. Gli eventi si cancellano da soli dopo
dodici mesi. Si spegne tutto con `SOLVIA_ANALYTICS=false`.

### Pre-lancio: online prima di poter incassare

Con `SOLVIA_PRELANCIO=true` il sito va online e dice la verità: i prezzi restano
scritti, ma i pulsanti dei piani a pagamento diventano *"Avvisami quando apre"* e
raccolgono l'indirizzo email. Il piano gratuito funziona per intero, quindi le persone
entrano e usano il prodotto davvero; chi sbatte contro un limite riceve la stessa
proposta onesta invece di un pagamento che non incasserebbe nulla.

Il checkout e l'attivazione simulata sono **chiusi** in questa modalità: nessuno può
"attivare" un piano che non esiste. La console mostra quante persone sono in lista, per
quale piano e quanto varrebbero al mese. Togliendo la variabile tutto torna normale.

Serve nel periodo fra "il prodotto è pronto" e "posso emettere fattura" — che in Italia
significa avere la partita IVA, indipendentemente dal servizio di pagamento scelto
(vedi [PAGAMENTI.md](PAGAMENTI.md)).

### Portale cliente

Ogni cliente può avere un link personale dove vede tutti i suoi documenti —
fatture, preventivi, cosa resta da saldare — sempre aggiornati e senza registrarsi.
Le bozze non compaiono. Il link si revoca in qualsiasi momento.

### La funzione principale: preventivi con accettazione online

Generi un link, lo mandi al cliente. Lui apre una pagina impaginata bene, senza
registrarsi né scaricare nulla, e accetta o rifiuta con un clic. Tu vedi quando l'ha
aperto e cosa ha risposto; l'accettazione viene registrata con data, ora e IP, e crea
in automatico l'attività "emetti fattura". Il link è revocabile in qualsiasi momento.

Chi accetta può **firmare col dito** direttamente sullo schermo: la firma resta
allegata al documento insieme al nome di chi ha firmato.

### Calcoli fiscali

Imponibile → IVA (aliquota configurabile) → ritenuta d'acconto sottratta dal totale.
Numerazione progressiva per anno: `2026/001` per le fatture, `P-2026/001` per i preventivi.

---

## Privacy e GDPR

La protezione dei dati non è una pagina di testo appiccicata sopra: è implementata.

- **Esportazione dati** (artt. 15 e 20) — un pulsante in Impostazioni restituisce
  account, clienti, documenti, attività ed email in un file leggibile.
- **Cancellazione account** (art. 17) — immediata e definitiva, con riconferma della password.
- **Newsletter a doppia conferma** — l'iscrizione vale solo dopo che il titolare della
  casella ha cliccato il link. Data, IP e testo del consenso vengono registrati come prova.
- **Disiscrizione con un clic**, senza login, più la possibilità di cancellare del tutto
  il proprio indirizzo.
- **Sessioni revocabili** — cambiando password decadono tutti gli accessi aperti altrove,
  senza dover contattare nessuno.
- **Un solo cookie**, tecnico, per tenere la sessione aperta. Nessuna profilazione,
  nessuno strumento di statistiche di terze parti, quindi nessun banner necessario.
- **Statistiche senza cookie e senza IP** — le visite si contano con un'impronta
  crittografica che cambia ogni giorno; chi invia "Do Not Track" o Global Privacy
  Control non viene contato affatto (vedi *la console di direzione* più sotto).

Le pagine `privacy.html`, `cookie.html` e `termini.html` sono scritte su misura per come
funziona davvero l'applicazione, e sono **generate**: i tuoi dati arrivano da
`SOLVIA_TITOLARE`, `SOLVIA_CONTATTO_EMAIL`, `SOLVIA_INDIRIZZO` (più `SOLVIA_HOSTING` e
`SOLVIA_SMTP_NOME` per l'elenco dei fornitori). Finché restano vuote, le pagine mostrano
un avviso "da completare" e `npm run controllo` lo segnala come errore bloccante.
Rigenerale con `npm run build:pages` — su Render succede a ogni deploy.

Il testo cambia anche in base a `SOLVIA_COMMERCIAL`: con il listino acceso i termini
parlano di abbonamento, rinnovo automatico, disdetta, recesso di 14 giorni e preavviso
di 30 giorni sui cambi di prezzo; con il listino spento tornano a descrivere un progetto
personale gratuito.

---

## Newsletter

Non è un modulo che raccoglie indirizzi e basta: è un sistema completo.

1. Il visitatore si iscrive dalla home spuntando il consenso
2. Riceve un'email con il link di conferma — **senza clic, nessuna iscrizione**
3. Confermato, entra nell'elenco dei destinatari
4. Dal pannello scrivi la campagna, la provi su di te, poi la mandi a tutti
5. Ogni email include il motivo per cui la si riceve e il link di disiscrizione

**Senza SMTP configurato le email non partono davvero**: vengono registrate in
`data/outbox/` e le leggi dal pannello, scheda *Email inviate*. Serve a collaudare tutto
prima di collegare un servizio reale. Per attivare gli invii vedi
[PUBBLICARE.md](PUBBLICARE.md).

---

## Configurazione

Copia `.env.example` in `.env`, oppure passa le variabili al comando di avvio.

| Variabile | Predefinito | A cosa serve |
|---|---|---|
| `PORT` | `3000` | Porta del server |
| `SOLVIA_SECRET` | casuale a ogni avvio | Firma delle sessioni. **In produzione va impostata** |
| `SOLVIA_DATA_DIR` | `./data` | Cartella del database |
| `SOLVIA_ADMIN_EMAIL` | primo utente registrato | Chi amministra la newsletter |
| `NODE_ENV` | — | Con `production` i cookie richiedono HTTPS |
| `ANTHROPIC_API_KEY` | non impostata | Attiva l'assistente con modello linguistico |
| `SMTP_HOST` e affini | non impostate | Attiva l'invio email reale |
| `SOLVIA_ANALYTICS` | `true` | Statistiche del sito. `false` le spegne del tutto |
| `SOLVIA_CONSOLE_PATH` | `console` | Indirizzo della console di direzione |
| `SOLVIA_COMMERCIAL` | `true` | Piani e pagamenti. `false` li spegne (vedi sotto) |
| `SOLVIA_PRELANCIO` | `false` | Prezzi visibili ma incassi chiusi: raccoglie una lista d'attesa |
| `STRIPE_SECRET_KEY` | non impostata | Senza, i pagamenti girano in simulazione |
| `STRIPE_WEBHOOK_SECRET` | non impostata | Firma degli eventi Stripe |
| `STRIPE_PRICE_PRO` / `_TEAM` | non impostate | ID dei prezzi (`price_...`) |
| `SOLVIA_TITOLARE` | segnaposto | Chi tratta i dati, nelle pagine legali |
| `SOLVIA_CONTATTO_EMAIL` | segnaposto | Email per privacy, disdette e richieste GDPR |
| `SOLVIA_INDIRIZZO` | segnaposto | Indirizzo del titolare |
| `SOLVIA_HOSTING` | segnaposto | Chi ospita il sito, citato fra i fornitori |
| `SOLVIA_SMTP_NOME` | segnaposto | Chi spedisce le email, citato fra i fornitori |
| `SOLVIA_SOSTIENI_URL` | non impostata | Profilo Ko-fi/Liberapay/… per il sostegno volontario |
| `SOLVIA_SOSTIENI_NOME` | `SOLVIA_TITOLARE` | Chi riceve davvero i soldi: senza, il pulsante non compare |

### Controllo prima di pubblicare

```bash
npm run controllo
```

Gli errori peggiori di una messa online sono silenziosi: il database su una cartella che
si azzera, le sessioni generate al volo, i segnaposto rimasti nell'informativa privacy.
Nessuno di questi dà un errore — danno un sito che *sembra* funzionare. Il comando li
elenca in un colpo solo, separa ciò che è **rotto** (esce con codice 1) da ciò che è solo
**da sistemare**, e sotto ogni riga scrive l'istruzione. Gira anche da solo all'avvio
quando `NODE_ENV=production`.

### L'assistente: due modalità

Senza `ANTHROPIC_API_KEY` l'assistente usa **regole deterministiche**: nessuna chiamata
esterna, nessun costo, nessun dato che esce dal server. Classifica per parole chiave,
riconosce l'urgenza, estrae importi dalle descrizioni.

Con la chiave usa un **modello linguistico reale**, e se la chiamata fallisce ricade
automaticamente sulle regole.

### Piani

| | Gratis | Pro — 19 €/mese | Team — 49 €/mese |
|---|---|---|---|
| Fatture ed export PDF | illimitate | illimitate | illimitate |
| Preventivi | 3 al mese | illimitati | illimitati |
| Clienti | 5 | illimitati | illimitati |
| Email analizzate | 10 al mese | illimitate | illimitate |
| Preventivi con accettazione online | — | ✓ | ✓ |
| Solleciti automatici | — | ✓ | ✓ |
| Fatture ricorrenti | — | ✓ | ✓ |
| Tasse, spese, ricerca, tema scuro | ✓ | ✓ | ✓ |
| Persone nello stesso studio | 1 | 1 | 5 |

I limiti e i blocchi sono applicati **sul server**, non nascondendo pulsanti: superata
la soglia l'API risponde `402` e l'interfaccia propone il passaggio a Pro.
Si configurano in `PLANS` dentro `lib/billing.js`.

Senza chiavi Stripe l'app parte comunque, in **modalità simulazione**: il percorso
completo (scelta piano → pagamento → sblocco funzioni → disdetta) funziona, ma non
incassa nulla. Aggiunte le chiavi diventa reale senza toccare il codice — la
diagnostica in *Impostazioni* verifica che siano giuste (vedi [STRIPE.md](STRIPE.md)).
Con `SOLVIA_COMMERCIAL=false` piani e limiti si spengono del tutto: tutto illimitato
e nessun prezzo esposto dalle API.

### Stima delle tasse

Calcola quanto accantonare partendo dall'incassato reale: coefficiente di redditività,
imposta sostitutiva (5% o 15%) e contributi (Gestione Separata, Artigiani, Commercianti,
cassa professionale), con l'opzione di riduzione del 35%.

**È una stima indicativa, non un calcolo fiscale.** Aliquote e minimali cambiano ogni
anno e il coefficiente dipende dal codice ATECO: tutti i parametri sono modificabili
dall'utente, e l'avvertenza è visibile nella pagina.

---

## Test

```bash
npm test                    # 456 test lato server

npm run test:syntax         #  56 file — sintassi di ogni file JS, anche quello dentro le pagine HTML
npm run test:api            #  35 — calcoli, permessi, PDF, isolamento tra account
npm run test:account        #  47 — primo accesso, cambio e recupero password, sessioni
npm run test:studio         #  43 — studio condiviso: inviti, dati comuni, permessi
npm run test:direzione      #  45 — statistiche, imbuto, conto economico, console nascosta
npm run test:prelancio      #  19 — prezzi visibili, incassi chiusi, lista d'attesa
npm run test:newsletter     #  50 — doppia conferma, disiscrizione, GDPR, pagine legali
npm run test:extra          #  46 — ore, portale cliente, firma, riepilogo annuale, app installabile
npm run test:pro            #  45 — preventivi condivisi, solleciti, ricorrenti, tasse, spese, ricerca
npm run test:billing        #  23 — piani e limiti d'uso
npm run test:diagnostica    #  18 — la diagnostica riconosce gli errori di configurazione
npm run test:controllo      #  27 — il controllo prima del volo e la verità delle pagine legali
npm run test:sondaggio      #  40 — progetto gratuito, domanda sul prezzo e sostegno volontario
npm run test:webhook        #  18 — firme Stripe reali

npm run test:ui             #  18 — interfaccia su browser reale
npm run test:ui:pro         #  16 — funzioni Pro, dal link al cliente fino all'accettazione
npm run test:ui:newsletter  #  13 — newsletter, pagine legali e GDPR
npm run test:ui:extra       #  10 — su schermo tablet: firma col dito, cronometro, portale
npm run test:ui:billing     #   7 — percorso di acquisto
npm run test:ui:account     #  18 — benvenuto, checklist, password dal browser
npm run test:ui:studio      #  13 — due browser insieme: invito, ingresso, rimozione
npm run test:ui:direzione   #  15 — dal sito vero alla console, e che resti invisibile
npm run test:ui:prelancio   #  11 — il sito non promette pagamenti che non può incassare
npm run test:ui:sondaggio   #  11 — da telefono: il listino sparisce, la domanda e "dai una mano"

# Le suite account, studio, direzione, newsletter, extra, pro, billing e webhook avviano un server
# con un
# database vuoto tutto loro: girano in qualsiasi ordine senza interferire.
```

Tutte le suite su browser in un colpo: `npm run test:ui:tutti` (132 test).
Richiedono Playwright (`npm install -D playwright`) e salvano screenshot in `shots/`.
Su GitHub la suite gira da sola a ogni push (`.github/workflows/test.yml`).

---

## Struttura

```
server.js               avvio, rotte, file statici
build-pages.js          genera le pagine legali e di conferma newsletter
lib/
  db.js                 schema SQLite, driver, migrazioni
  auth.js               sessioni JWT su cookie httpOnly
  assistant.js          triage email e bozze (regole o modello)
  newsletter.js         iscrizioni, doppia conferma, campagne
  mailer.js             invio email (SMTP o archiviazione locale)
  recurring.js          abbonamenti e generazione automatica delle fatture
  report.js             riepilogo annuale in PDF
  diagnostica.js        verifica in tempo reale della configurazione Stripe
  reminders.js          solleciti di pagamento a tono crescente
  tax.js                stima di imposte e contributi
  scheduler.js          lavori periodici (ricorrenti e solleciti)
  billing.js            piani, limiti e Stripe
  pdf.js                PDF di preventivi e fatture
  totals.js             imponibile, IVA, ritenuta
  seed.js               dati dimostrativi per i nuovi account
routes/                 auth, clients, documents, emails, tasks, dashboard,
                        finance, time, public, newsletter, gdpr, billing
public/
  index.html            sito pubblico con prezzi e modulo newsletter
  preventivo.html       pagina che vede il cliente, con firma col dito
  portale.html          portale cliente: tutti i suoi documenti
  manifest.json + sw.js app installabile e funzionamento offline
  privacy / cookie / termini      pagine legali
  newsletter-admin.html pannello newsletter
  app.html + js/app.js  applicazione
```

---

## Sicurezza

Password con bcrypt, sessioni in cookie `httpOnly` con `sameSite=lax`, query sempre
parametrizzate, ogni interrogazione filtrata per utente. L'isolamento tra account e i
permessi del pannello amministratore sono verificati dai test a ogni modifica.

Prima di pubblicare: `SOLVIA_SECRET`, `NODE_ENV=production`, HTTPS ovunque, e un limite
di tentativi sul login se il sito diventa pubblico.

---

## Cosa non è collegato

- **Lettura della casella di posta** — serve OAuth con Gmail o Outlook. Oggi le email
  si inseriscono a mano dal pulsante *Simula email*.
- **Invio automatico dei solleciti** — servono le credenziali SMTP. I testi vengono
  preparati e restano in attesa della tua approvazione.
- **Fatturazione elettronica (SDI)** — serve un intermediario accreditato. I PDF sono
  documenti di cortesia, non fatture elettroniche valide.

---

## Pubblicare online

**Netlify e GitHub Pages non funzionano**: servono solo file statici, mentre Solvia ha
bisogno di un processo Node acceso e di un database. Serve un host che esegua Node —
Render, Railway o Fly.io hanno un piano gratuito adatto.

Le configurazioni sono già pronte (`render.yaml`, `fly.toml`, `Dockerfile`).
Procedura completa in **[PUBBLICARE.md](PUBBLICARE.md)**.

---

## Licenza

MIT — vedi [LICENSE](LICENSE). Compila il nome del titolare prima di pubblicare.
