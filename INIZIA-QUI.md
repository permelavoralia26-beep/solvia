# Inizia qui

Questo pacchetto contiene **tutto**: il sito pubblico, l'applicazione per i clienti,
la tua console di direzione, la documentazione e i 588 test. Un solo file zip, niente
da scaricare a parte.

---

## 0. Cosa manca per pubblicare

> **Vai diretto:** apri **TUTORIAL.html** nel browser — è il tutorial completo,
> schermata per schermata, che non dà niente per scontato. Questo file è il manuale
> di riferimento; quello è la sequenza da seguire stasera.
> (La stessa cosa in versione corta e testuale: **[PUBBLICA.md](PUBBLICA.md)**.)

Solvia esce come **progetto gratuito**: nessun prezzo, nessun piano da comprare,
nessun incasso — e quindi nessun obbligo fiscale e nessuna partita IVA. È già
impostato così (`SOLVIA_COMMERCIAL=false`), non devi cambiare niente.

Al posto del listino il sito fa una domanda — *"quanto pagheresti per una cosa
così?"* — e le risposte le vedi solo tu, in console (§7).

Il codice è pronto: questi sono gli unici passi che dipendono da te.

- [ ] Un account **GitHub** (lo apri tu) e uno **Render** (intestato a un maggiorenne)
- [ ] Scegliere l'indirizzo della tua console: `SOLVIA_CONSOLE_PATH` — vedi §4
- [ ] Decidere il piano di Render: **starter** se ci entrano persone vere, perché il
      free cancella il database (§5)
- [ ] Compilare i dati per le pagine legali — **non si modificano a mano**: basta
      impostare `SOLVIA_TITOLARE`, `SOLVIA_CONTATTO_EMAIL` e `SOLVIA_INDIRIZZO` e le
      pagine si riscrivono da sole a ogni deploy (§8)
- [ ] Registrare **il tuo account per primo**: diventa l'amministratore (§3)

Tutto il resto — dominio, email, e un giorno i pagamenti — si aggiunge dopo, a sito
già online.

**Non tenere a mente questa lista:** c'è un comando che la controlla al posto tuo e ti
dice cosa manca, in italiano e con l'istruzione per sistemarlo (§8).

```bash
npm run controllo
```

**Poi serve la parte difficile:** far sapere a qualcuno che esisti. Il piano concreto,
con i messaggi già scritti, sta in **[LANCIO.md](LANCIO.md)**.

---

## 1. Farlo partire

### Dall'iPhone

Apri **[IPHONE.md](IPHONE.md)**. In breve: il server **non** gira sul telefono (iOS non
lo permette e non serve), ma modifica, push e deploy si fanno tutti da lì — Working Copy
per il codice, Safari per Render, e GitHub che esegue i test al posto tuo a ogni push.

### Sul tablet Samsung, senza PC

Apri **[SAMSUNG.md](SAMSUNG.md)**: è scritto comando per comando per Termux.
In pratica sono tre righe, e ci mette un quarto d'ora la prima volta. Su Android, a
differenza di iOS, Solvia gira anche in locale sul dispositivo.

### Su un computer

```bash
npm install
npm start
```

Se `npm install` segnala errori su `better-sqlite3`, **ignorali**: è una dipendenza
opzionale, l'app usa il database incluso in Node e parte lo stesso.

All'avvio il server stampa tutto quello che ti serve sapere:

```
  Solvia è in ascolto su http://localhost:3000
  Database: better-sqlite3
  Assistente: regole
  Email: outbox (nessun invio reale — le email finiscono in data/outbox/)
  Pagamenti: demo
  Console di direzione: http://localhost:3000/console (solo amministratore)
```

---

## 2. I due indirizzi

Sono **due piattaforme diverse** che girano dallo stesso server e leggono lo stesso
database. Non si parlano: dall'una non si arriva all'altra.

| | Indirizzo | Chi ci entra |
|---|---|---|
| **Il prodotto** | `/` e `/app` | Chiunque: è quello che vendi |
| **La tua console** | `/console` | Solo tu |

### Il sito pubblico e l'applicazione

`http://localhost:3000` (o il tuo dominio quando è online).

È la vetrina: cosa fa, come funziona, i tre piani, le domande frequenti, la newsletter.
Da lì si va su **Inizia gratis** → si crea un account → si entra nell'applicazione su
`/app`. Al primo accesso c'è la configurazione in tre passi.

Questo lo vedono tutti. Anche tu, perché anche tu sei un utente di Solvia.

### La tua console di direzione

`http://localhost:3000/console`

Qui vedi come va il **prodotto**: quante persone arrivano, da dove, chi scorre fino ai
prezzi, cosa preme, chi si registra, chi paga, quanto entra al mese, chi disdice.

**Non è una sezione dell'applicazione.** Dentro Solvia non esiste: nessuna voce nel menù
per nessuno, e il codice dell'app non la nomina. Chi non è amministratore riceve un 404
identico a quello di un indirizzo inventato — non un "vietato", che direbbe comunque
"qui c'è qualcosa".

---

## 3. Come entri nella TUA console

**Il primo account che registri diventa automaticamente l'amministratore.** Quindi:

1. Apri il sito, premi *Inizia gratis*, crea il tuo account **per primo**
2. Vai su `/console`
3. Entra con la stessa email e password

Fatto. Da lì in poi la console è tua e nessun altro la vede.

### Se ti sei registrato con l'indirizzo sbagliato

Capita. Si aggiusta in un comando, con il server anche acceso:

```bash
node amministratore.js                      # elenca gli account (★ = amministratore)
node amministratore.js tua@email.it         # rende amministratore quell'account
node amministratore.js altra@email.it --togli   # glieli toglie
```

### Per decidere l'amministratore prima ancora di registrarti

Metti l'indirizzo in `SOLVIA_ADMIN_EMAIL` nel file `.env`: chi si registra con
quell'email diventa amministratore, in qualunque ordine arrivi.

---

## 4. Prima di pubblicare: sposta la console

Di default la console sta su `/console`, che è il primo indirizzo che chiunque
proverebbe. **Cambialo con qualcosa di tuo:**

```bash
SOLVIA_CONSOLE_PATH=quello-che-vuoi
```

Diventa `iltuosito.it/quello-che-vuoi`. Su Render si imposta dal pannello, e resta fuori
da GitHub. Non serve toccare una riga di codice.

---

## 5. Metterlo online

Segui **[PUBBLICARE.md](PUBBLICARE.md)** (o **[IPHONE.md](IPHONE.md)** se parti dal
telefono). In breve: carichi il progetto su GitHub, poi colleghi Render, che legge
`render.yaml` e configura tutto da solo — disco persistente compreso, senza il quale il
database sparirebbe a ogni aggiornamento.

> **Il piano gratuito di Render non ammette dischi persistenti.** Senza disco il
> database si azzera a ogni riavvio, a ogni deploy e dopo ogni sospensione per
> inattività — senza dare nessun errore. Per questo `render.yaml` è impostato su
> `starter`, il piano più economico che lo permette. Il free va bene solo per far
> vedere il sito a qualcuno, non per farci entrare persone vere.

**Netlify e GitHub Pages non vanno bene:** ospitano solo file statici, e qui serve un
processo Node acceso con un disco che non si svuoti.

---

## 6. Progetto gratuito: come esce il sito

È la configurazione predefinita, ed è quella giusta per chiunque non possa ancora
emettere fattura — che sia perché manca la partita IVA o perché è troppo presto.

```bash
SOLVIA_COMMERCIAL=false
```

Cosa cambia rispetto alla versione commerciale:

- **spariscono i prezzi** e i tre piani: non c'è niente da comprare, nemmeno nascosto
- **spariscono i limiti d'uso**: preventivi, clienti ed email sono illimitati per tutti
- le domande frequenti che parlavano di abbonamenti vengono **sostituite** da quelle
  che raccontano com'è davvero
- i termini d'uso si riscrivono da soli: tornano a dire *"progetto personale e gratuito,
  senza finalità commerciali"*
- il checkout è **chiuso**: non c'è nessun percorso, nemmeno indovinando un indirizzo,
  che porti a un pagamento

Non incassando nulla non c'è nessun obbligo fiscale da rispettare: è l'inquadramento
di un sito personale.

### E al posto del listino?

Una domanda: **"quanto pagheresti per una cosa così?"**. Si risponde toccando una cifra,
si può aggiungere che lavoro si fa e, se si vuole, l'email. Non si paga niente, non si
attiva niente, e chi risponde lo sa.

È la stessa informazione che darebbe un listino vero — *quante persone, e a che prezzo* —
ottenuta senza incassare un euro. Una risposta per visitatore al giorno: chi ricarica e
risponde di nuovo corregge la sua, non ne aggiunge una seconda.

Nella tua console (§2) trovi il pannello **"Quanto pagherebbero"**: quante risposte,
quante persone pagherebbero qualcosa, la **cifra tipica** (la mediana, che un singolo
scherzoso da 500 € non sposta), la distribuzione per fasce e chi ha lasciato l'email.

**Dieci risposte a quella domanda valgono più di cento visite** — ed è il numero da
mettere sul tavolo il giorno in cui si potrà vendere davvero.

### E il "offrimi un caffè"?

C'è, ma è **spento** e resta spento finché non lo accendi con due variabili:

```bash
SOLVIA_SOSTIENI_URL=https://ko-fi.com/nomeprofilo
SOLVIA_SOSTIENI_NOME=Nome Cognome
```

Servono **entrambe**, e il link deve essere un indirizzo `https` di una piattaforma
riconosciuta (Ko-fi, Buy Me a Coffee, Liberapay, GitHub Sponsors, Patreon). Senza, il
pulsante non compare: un bottone "paga" che spunta per una configurazione sbagliata è
esattamente il guasto che non ci si può permettere.

Il nome non è un dettaglio estetico: è **chi riceve davvero i soldi**, e la pagina lo
scrive. Se il sito è intestato a un genitore, il caffè arriva a lui — e chi lo manda
deve poterlo leggere prima di premere.

Il sostegno **non sblocca niente**: Solvia è identica per chi manda due euro e per chi
non manda nulla. Anche questo è scritto nella pagina, e un test verifica che non ci
finisca nessun link di pagamento quando la funzione è spenta.

### Quando sarà il momento di vendere

Metti `SOLVIA_COMMERCIAL=true` e riappare tutto: piani, prezzi, limiti, checkout.
Se i pagamenti non sono ancora collegati, aggiungi anche `SOLVIA_PRELANCIO=true`:
i prezzi si vedono ma i pulsanti raccolgono email invece di aprire un pagamento finto,
e in console compare quanto varrebbe la lista al mese.

---

## 7. Il giorno in cui si potrà incassare

Oggi non è quel giorno, e va bene così: il sito è online, la gente lo usa e tu raccogli
le risposte sul prezzo. Quando i conti torneranno, ecco cosa serve — in ordine.

1. **La possibilità di emettere fattura.** In Italia un abbonamento mensile è attività
   abituale: richiede la partita IVA a prescindere dal servizio di pagamento scelto.
   PayPal, Stripe o un Merchant of Record estero non cambiano questo. Il perché per
   estese sta in **[PAGAMENTI.md](PAGAMENTI.md)**.
2. `SOLVIA_COMMERCIAL=true` — tornano piani, prezzi e limiti.
3. `SOLVIA_PRELANCIO=true` — finché i pagamenti non sono collegati: i prezzi si vedono,
   i pulsanti raccolgono l'email.
4. **[STRIPE.md](STRIPE.md)** — due prodotti, quattro valori nel pannello dell'host, e
   il pulsante *Verifica configurazione* dentro le Impostazioni ti dice se torna tutto.

Finché Stripe non è collegato i pagamenti girano in **simulazione**: il percorso
completo funziona (scelta piano → pagamento → sblocco funzioni → disdetta) ma non
incassa nulla. Si può provare in qualsiasi momento.

**I due valori segreti (`sk_...` e `whsec_...`) non si incollano mai in una chat**, a
nessuno. Vanno solo nel pannello del tuo host.

---

## 8. I tuoi dati sulle pagine legali, e il controllo prima del volo

Privacy, cookie e termini devono dire **chi** tratta i dati: è un obbligo, e finché
restano i segnaposto un potenziale cliente legge "[Nome e Cognome]" nella tua
informativa — che è peggio di non averla.

Non si modificano a mano. Sono generate: imposti tre variabili e si riscrivono.

```bash
SOLVIA_TITOLARE="Nome Cognome"
SOLVIA_CONTATTO_EMAIL=tua@email.it
SOLVIA_INDIRIZZO="via, città"
```

Su Render le imposti dal pannello e basta: `render.yaml` esegue `npm run build:pages`
a ogni deploy, quindi le pagine si aggiornano da sole. In locale lanci il comando tu.

### Il controllo

```bash
npm run controllo
```

Passa in rassegna le cose che rovinano una messa online **in silenzio** — la chiave
delle sessioni generata al volo, il database su una cartella che si azzera, la console
ancora sull'indirizzo predefinito, i segnaposto legali, i prezzi esposti senza incassi,
l'SMTP mancante, nessun amministratore — e distingue ciò che è **rotto** (rosso: non
pubblicare) da ciò che è **da sistemare** (giallo: pubblica pure, ma sappilo). Ogni
riga ha sotto l'istruzione precisa.

Gira anche da solo all'avvio in produzione, così il primo log dopo un deploy ti dice
subito se qualcosa non torna.

---

## 9. Cosa c'è nel pacchetto

| File | Cosa contiene |
|---|---|
| **TUTORIAL.html** | Il tutorial completo di pubblicazione, passo per passo, dando per scontato zero |
| **PUBBLICA.md** | La versione corta della stessa cosa, in testo |
| **PER-I-MIEI.html** | Da far leggere ai genitori: cos'è, cosa costa, cosa serve da loro |
| **INIZIA-QUI.md** | Questo file |
| **STATO.html** | Cosa è fatto e cosa manca, con l'ordine dei prossimi passi |
| **RESOCONTO.html** | Il quadro completo del progetto, da aprire nel browser |
| [README.md](README.md) | Documentazione tecnica: funzioni, architettura, test |
| [IPHONE.md](IPHONE.md) | Fare tutto dall'iPhone: modifiche, push, deploy |
| [SAMSUNG.md](SAMSUNG.md) | Installazione sul tablet Android, comando per comando |
| [PUBBLICARE.md](PUBBLICARE.md) | Mettere il sito online, dominio, email, backup |
| [LANCIO.md](LANCIO.md) | Come arrivare a 10 persone che vogliono pagare, in una settimana |
| [PAGAMENTI.md](PAGAMENTI.md) | PayPal, Stripe e la partita IVA: cosa si può fare oggi |
| [STRIPE.md](STRIPE.md) | Collegare i pagamenti |
| `samsung.sh` | Installatore automatico per Termux |
| `github.sh` | Carica il progetto su GitHub |
| `amministratore.js` | Decide chi entra nella console |
| `controllo.js` | Dice cosa manca prima di pubblicare (`npm run controllo`) |
| `.env.example` | Tutte le variabili, spiegate una per una |

---

## 10. Controllare che sia tutto a posto

```bash
npm test             # 456 test lato server, circa due minuti
npm run test:ui:tutti  # 132 test su browser vero (serve: npm install -D playwright)
```

Se sono tutti verdi, quello che hai in mano funziona davvero.
