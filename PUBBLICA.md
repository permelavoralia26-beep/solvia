# Metterlo online

> **C'è anche la versione lunga:** apri **TUTORIAL.html** nel browser.
> È lo stesso percorso, ma tasto per tasto, con scritto cosa vedrai a ogni schermata
> e cosa fare quando qualcosa non va. Se è la prima volta, parti da lì.

Guida unica, dal telefono, senza computer. Leggi solo la parte che ti riguarda.

Solvia esce come **progetto gratuito**: nessun prezzo, nessun piano da comprare,
nessun pagamento da incassare — e quindi nessun obbligo fiscale, nessuna partita IVA,
niente da chiedere a nessuno. Al posto del listino il sito fa una domanda:
*"quanto pagheresti per una cosa così?"*. Le risposte le vedi solo tu, nella console.

È la configurazione già impostata nel pacchetto. Non devi cambiare niente.

---

## Prima di tutto: quale strada

Ci sono tre modi di far vedere Solvia a qualcuno. Non sono uno meglio dell'altro:
dipende da chi lo deve vedere e da cosa hai a disposizione.

| | Cosa serve | Cosa ottieni |
|---|---|---|
| **A. Online sul serio** | Un genitore che apre l'account e una carta (~7 $/mese) | Un indirizzo pubblico che funziona sempre, con i dati che restano |
| **B. Online per far vedere** | Solo un account gratuito | Un indirizzo pubblico, ma **il database si azzera** a ogni riavvio |
| **C. Sul tuo tablet** | Niente, zero account, zero euro | Gira in casa tua: perfetto per farlo provare a qualcuno di persona |

Se devi mostrarlo a un professore, a un amico o a un parente, **C basta e avanza** —
e la fai stasera senza chiedere niente a nessuno. Vedi [SAMSUNG.md](SAMSUNG.md).

Se vuoi che chiunque possa entrarci da internet, servono A o B. E lì c'è una cosa
da sapere prima.

---

## La cosa da sapere sugli account

I servizi che tengono un sito online (Render e simili) chiedono nelle loro condizioni
di essere **maggiorenni**, o di avere il consenso di un genitore. Non è un dettaglio da
aggirare: un account intestato saltando quella regola può sparire da un giorno all'altro,
e con lui il sito.

**La soluzione non è nascondersi, è coinvolgerli.** L'account lo apre un genitore,
con il suo nome, e tu ci lavori dentro. Il codice resta tuo, il progetto resta tuo,
e nessuno ti può togliere niente.

Per aiutarti a spiegarglielo c'è **[PER-I-MIEI.html](PER-I-MIEI.html)**: aprila sul
telefono e fagliela leggere. Ci mettono cinque minuti e c'è scritto tutto — cos'è,
cosa costa, cosa raccoglie, e perché serve loro.

> **GitHub** è più semplice: le sue condizioni permettono l'iscrizione dai 13 anni.
> Quello lo puoi aprire tu.

---

## Passo 1 — GitHub (10 minuti, lo fai tu)

GitHub è il posto dove vive il codice. Da lì Render lo prende e lo pubblica.

1. Apri **github.com** su Safari o Chrome → *Sign up*
2. Email, password, un nome utente (scegline uno serio: te lo porti dietro per anni)
3. Conferma l'email
4. In alto a destra **+** → *New repository*
5. Nome: `solvia` · scegli **Private** se non vuoi che si veda subito · *Create*

Adesso serve caricare i file. Dal telefono:

1. Installa **Working Copy** (App Store, gratis per quello che ti serve)
2. Aprila → **+** → *Clone repository* → scegli il tuo `solvia`
3. Scompatta `Solvia.zip` con l'app **File** e copia tutta la cartella dentro Working Copy
4. Nella schermata delle modifiche: scrivi `primo caricamento` → *Commit* → *Push*

Se qualcosa non torna, i dettagli passo per passo sono in [IPHONE.md](IPHONE.md).

---

## Passo 2 — Render (15 minuti, insieme a un genitore)

1. Su **render.com** → *Get Started* → entra con l'account GitHub
2. *New* → **Blueprint** → scegli il repository `solvia`
3. Render legge da solo il file `render.yaml` e configura tutto: non devi impostare niente

Ti chiederà quattro valori. Compilali così:

```
SOLVIA_TITOLARE       → il nome del genitore intestatario
SOLVIA_CONTATTO_EMAIL → un'email che leggete davvero
SOLVIA_INDIRIZZO      → comune e provincia, basta
SOLVIA_CONSOLE_PATH   → una parola inventata che sai solo tu
```

I primi tre finiscono nelle pagine legali (privacy, cookie, termini), che si
riscrivono da sole a ogni pubblicazione. Il quarto è l'indirizzo segreto della
**tua** console: scegline una che nessuno indovinerebbe, tipo `stanza-di-riccardo`.

Poi *Apply*. Ci mette qualche minuto. Alla fine hai un indirizzo tipo
`solvia.onrender.com`.

### Il piano: la scelta vera

Nel pannello, alla voce **Instance Type**:

- **Starter (~7 $/mese)** — con il disco che tiene i dati. Gli account e le fatture
  restano lì per sempre.
- **Free (0 €)** — nessun disco: il database **si svuota** a ogni riavvio, a ogni
  aggiornamento e dopo qualche ora che nessuno lo apre. Chi si registra oggi domani
  non trova più il suo account.

`render.yaml` è impostato su **starter** perché è l'unico onesto se ci entrano persone
vere. Se in casa quei 7 $ al mese sono un problema, non è un dramma: metti *free*,
usalo per far vedere il progetto, e scrivi tu stesso da qualche parte che i dati si
azzerano. **Dire com'è vale più che fingere.**

---

## Passo 3 — Registrati per primo (2 minuti)

Appena il sito è online:

1. Aprilo → *Inizia gratis* → crea il tuo account **prima di dirlo a chiunque**
2. Il primo account che si registra diventa **amministratore**
3. Vai su `iltuosito.onrender.com/` + la parola che hai scelto (`SOLVIA_CONSOLE_PATH`)
4. Entra con la stessa email e password

Da lì vedi tutto: quante persone arrivano, da dove, cosa premono, quante rispondono
alla domanda sul prezzo e quanto direbbero. Nessun altro la vede, e chi prova
quell'indirizzo senza essere te riceve un 404 identico a una pagina che non esiste.

---

## Passo 4 — Il controllo

Sul primo log di Render, Solvia esegue da solo il controllo prima del volo e scrive
cosa manca ancora, riga per riga. Se vuoi rifarlo a mano da un computer:

```bash
npm run controllo
```

Croce rossa = da sistemare prima. Punto esclamativo giallo = puoi pubblicare, ma sappilo.

---

## Passo 5 — Dillo a qualcuno

Questa è la parte che nessun programma può fare al posto tuo, ed è quella che decide
tutto. I messaggi già scritti, i posti dove cercare e il calendario di una settimana
stanno in **[LANCIO.md](LANCIO.md)**.

Una raccomandazione, visto che ci tieni: **parti da chi ti conosce.** Il fotografo del
matrimonio di tua cugina, il grafico che ha fatto il logo a tuo zio, il tuo professore
di informatica. Tre persone che ti rispondono valgono trenta sconosciuti che ti ignorano.

E quando scrivi, dì la verità — che è già abbastanza forte:

> *"L'ho costruito io. Non è in vendita e non voglio niente: vorrei solo che lo
> provassi e mi dicessi se fa schifo."*

---

## Cosa guardare dopo tre giorni

Apri la console e rispondi a due domande:

**1. Arriva qualcuno?** Se le visite sono zero, il problema sono i messaggi, non il
prodotto. Scrivine altri trenta.

**2. Chi arriva, cosa dice?** Guarda il pannello *"Quanto pagherebbero"*. Se dieci
persone rispondono e la cifra tipica è sopra i 10 €, hai in mano una cosa che vale —
ed è un'informazione che quasi nessuno alla tua età ha su un progetto suo.

Quel numero, il giorno in cui potrai vendere davvero, vale più di qualsiasi discorso.
