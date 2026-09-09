# Tutto dall'iPhone

Sì, è fattibile. Ma non nel modo in cui lo era sul tablet Android, e conviene sapere
subito perché — così non perdi mezza giornata a cercare di far girare un server dentro
un telefono che non te lo lascerà fare.

---

## La differenza rispetto ad Android

Su Android c'è **Termux**: un vero Linux dentro il telefono, dove Solvia gira per davvero.

Su iOS **non esiste niente di equivalente**. Apple non permette a un'app di eseguire
codice arbitrario compilato al volo, quindi non c'è un Termux per iPhone. Esistono
emulatori tipo iSH, ma emulano un'architettura diversa: Node ci gira male, lentissimo,
e non è la strada.

**La buona notizia: non ti serve.** Solvia non deve girare sul telefono. Deve girare
sul server. Il telefono ti serve solo per tre cose — scrivere, mandare su GitHub,
premere deploy — e tutte e tre si fanno da Safari.

Il tuo iPhone non è il computer su cui gira Solvia: è il telecomando.

---

## Cosa ti serve (tutto gratis)

| Cosa | Dove | A che serve |
|---|---|---|
| **File** | già sul telefono | Tenere lo zip e scompattarlo |
| **Working Copy** | App Store, gratis per l'uso base | È un client Git completo: importa il progetto, fa commit, manda su GitHub |
| **Safari** | già sul telefono | GitHub, Render, Stripe: tutto da browser |
| Un account **GitHub** | github.com | Dove vive il codice |
| Un account **Render** | render.com | Dove gira il sito |

Working Copy è l'unica app da installare, ed è quella che rende tutto possibile: senza,
ti resterebbe solo il caricamento file per file dal sito di GitHub, che con 600 file non
è una strada.

---

## 1. Dal telefono a GitHub

1. Salva `Solvia.zip` nell'app **File**
2. Toccalo: iOS lo scompatta da solo in una cartella `Solvia`
3. Apri **Working Copy** → `+` → **Clone repository** non serve: scegli
   **Link external directory** e seleziona la cartella scompattata
   *(in alternativa: su GitHub crea un repository vuoto, poi in Working Copy fai
   Clone e ci trascini dentro i file dalla cartella)*
4. Working Copy vede che dentro c'è già un repository git con undici commit di storia:
   non devi ricostruire niente
5. Collega il tuo account GitHub (Working Copy → Settings → GitHub → autorizza)
6. **Push**

Fatto: il codice è online. Da questo momento il telefono e GitHub sono allineati.

> Lo script `github.sh` che trovi nel pacchetto serve solo su Android/Linux. Su iPhone
> fa tutto Working Copy, con i pulsanti.

---

## 2. Da GitHub a online

Tutto in Safari, su [render.com](https://render.com):

1. Accedi **con GitHub**
2. **New** → **Blueprint**
3. Scegli il repository Solvia
4. Render legge `render.yaml` e configura da solo: servizio, disco per il database,
   variabili d'ambiente
5. Ti chiede i valori marcati `sync: false` — inserisci almeno
   **`SOLVIA_CONSOLE_PATH`** (l'indirizzo della tua console: mettici qualcosa di tuo,
   non lasciare `console`). Gli altri, quelli di Stripe, lasciali vuoti finché non hai
   l'account: l'app parte lo stesso in modalità simulazione
6. **Apply**

Cinque minuti e hai un indirizzo pubblico: `solvia-qualcosa.onrender.com`.

Da lì in poi **ogni volta che fai Push da Working Copy, Render ridistribuisce da solo.**
Modifichi dal telefono, premi push, aspetti due minuti, il sito è aggiornato.

### ⚠️ Il piano gratuito di Render non va bene per i dati veri

Questo è importante e non è colpa di Solvia.

Il piano **free** di Render **non ammette dischi persistenti**. Senza disco, il database
sta su un filesystem che si azzera a ogni riavvio, a ogni nuovo deploy e dopo ogni
sospensione per inattività (il free si addormenta dopo 15 minuti senza visite).
Account, clienti e fatture sparirebbero **senza nessun errore**: apri il sito e trovi
tutto vuoto.

Per questo `render.yaml` è impostato su **starter**, il piano più economico che permette
il disco. Se vuoi provare a costo zero prima di spendere, togli la sezione `disk` e metti
`plan: free` — ma sapendo che è una vetrina usa e getta, non un posto dove far entrare
persone vere.

*(Fonte: [Deploy for Free — Render Docs](https://render.com/docs/free))*

---

## 3. Modificare il codice dal telefono

Tre strade, dalla più comoda alla più potente:

**Working Copy.** Ha un editor di testo dentro. Apri il file, modifichi, commit, push.
Per cambiare un prezzo, un testo del sito, un colore, è più che sufficiente.

**GitHub da Safari.** Apri il file sul sito, tocca la matita, modifichi, commit. Zero
app, ma su schermo da telefono è scomodo per file lunghi.

**GitHub Codespaces.** Da `github.com/codespaces` si apre un VS Code completo dentro
Safari, **con un terminale vero**: lì `npm test` gira davvero. È la soluzione più
potente e su iPhone è scomoda — lo schermo è quello che è — ma esiste, e per un
controllo al volo funziona.

### Come sai se hai rotto qualcosa

**Non ti serve eseguire i test sul telefono.** Ci pensa GitHub da solo: nel pacchetto
c'è già `.github/workflows/test.yml`, quindi **a ogni push GitHub esegue i 456 test
lato server** e ti mette una spunta verde o una croce rossa accanto al commit.

La vedi anche dall'app GitHub sul telefono. Croce rossa = non fare deploy, apri e leggi
cosa è fallito. È esattamente il motivo per cui quei test esistono.

---

## 4. Il flusso completo, ogni giorno

```
Working Copy: modifica → commit → push
       ↓
GitHub: esegue i 456 test          ← spunta verde o croce rossa
       ↓
Render: ridistribuisce da solo
       ↓
Safari: iltuosito.it aggiornato
```

Nessun computer, in nessun punto della catena.

---

## 5. Provare Solvia senza deploy

Non puoi far girare il server sull'iPhone, quindi per vedere l'app funzionante hai due
possibilità:

- **Mandala online e usala da lì.** È installabile: Safari → *Condividi* → *Aggiungi
  alla schermata Home*, e ti compare l'icona come un'app vera. È il modo giusto di
  provarla, perché è anche quello che faranno i tuoi clienti.
- **In un Codespace.** Il terminale del browser esegue `npm start` e Codespaces ti dà
  un indirizzo temporaneo da aprire in un'altra scheda.

---

## 6. Le cose che restano invariate

Non cambia niente rispetto a quanto già scritto altrove — la piattaforma non c'entra:

- **Come entrare nella tua console:** vedi [INIZIA-QUI.md](INIZIA-QUI.md), sezione 3.
  Il primo account che registri è l'amministratore.
- **I pagamenti:** vedi [STRIPE.md](STRIPE.md). Si configura tutto dal pannello di
  Render, dal telefono. E ricorda: **le due chiavi segrete non si incollano mai in una
  chat**, a nessuno.
- **Dominio, email, backup:** vedi [PUBBLICARE.md](PUBBLICARE.md).

---

## In una riga

Sì, si fa tutto dall'iPhone: **Working Copy per il codice, Safari per il resto, GitHub
che esegue i test al posto tuo.** L'unica cosa che il telefono non può fare è far girare
il server — e non deve, perché quello è il lavoro di Render.
