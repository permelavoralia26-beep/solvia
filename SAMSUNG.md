# Solvia sul tablet Samsung

Tutto dal tablet, senza PC. Due strade: **provarla subito** sul tablet stesso,
oppure **metterla online** per usarla ovunque e mandare i link ai clienti.
Puoi fare entrambe, in quest'ordine.

---

## Strada A — Provarla subito sul tablet (15 minuti)

### 1. Installa Termux

Termux è un terminale per Android. **Scaricalo da [F-Droid](https://f-droid.org/packages/com.termux/)**,
non dal Play Store: la versione del Play Store è ferma al 2022 e non funziona più.

Sul tablet: apri il link, scarica `Termux.apk`, aprilo, e quando Android chiede
"consenti installazione da questa fonte" dai OK.

### 2. Dai a Termux accesso ai file

Apri Termux e scrivi (poi Invio):

```
termux-setup-storage
```

Android chiede il permesso: concedilo. Serve perché Termux possa leggere lo zip
dalla cartella Download.

### 3. Metti lo zip in Download

Scarica `Solvia.zip` dalla chat e lascialo nella cartella **Download** del tablet.
Non serve estrarlo: lo fa lo script.

### 4. Lancia l'installazione

In Termux:

```
cd /sdcard/Download
unzip -o Solvia.zip
bash */samsung.sh
```

> Se la seconda riga dice *"unzip: command not found"*, prima installalo:
> `pkg install unzip` e poi riprova.

Da qui fa tutto da solo: installa Node, estrae il progetto, installa le
dipendenze, genera la chiave di sicurezza e avvia il server.

Quando finisce vedrai:

```
Apri il browser del tablet su: http://localhost:3000
```

### 5. Aprila e installala

Apri **Chrome** sul tablet su `http://localhost:3000`, crea l'account, e poi dal
menu ⋮ di Chrome scegli **Installa app**. Solvia finisce sulla schermata home
con la sua icona e si apre a schermo intero, senza barra del browser.

> **Da sapere:** finché gira così, Solvia vive dentro Termux sul tuo tablet.
> Se chiudi Termux si ferma. Per riavviarla: apri Termux e scrivi `cd ~/solvia && npm start`.
> I link ai clienti non funzionano da fuori casa: per quello serve la Strada B.

---

## Strada B — Metterla online (20 minuti)

Serve perché i clienti possano aprire i preventivi e il portale da casa loro.

### 1. Carica su GitHub

Sempre in Termux:

```
bash ~/solvia/github.sh
```

Ti chiede nome utente e un token. Per il token, dal browser del tablet:
**github.com → Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token**. Spunta la casella **repo** e copia il
token che compare (viene mostrato una volta sola).

Prima crea il repository vuoto su **github.com/new**, chiamandolo `solvia`,
senza spuntare README né .gitignore.

### 2. Pubblica su Render

Dal browser del tablet:

1. **render.com** → accedi con GitHub
2. **New** → **Blueprint** → scegli il repository `solvia`
3. Render legge il file `render.yaml` già presente e configura tutto da solo
4. Dopo qualche minuto hai il tuo indirizzo, tipo `solvia-xxxx.onrender.com`

Da quel momento tutto si gestisce dal browser: i clienti aprono i link, tu usi
l'app da qualunque dispositivo, e ogni modifica che fai su GitHub si pubblica da sola.

> Sul piano gratuito di Render il servizio si addormenta dopo un quarto d'ora di
> inattività e la prima visita successiva impiega una trentina di secondi. Per un
> progetto che parte va benissimo.

### 3. Compila i tuoi dati

Le pagine legali **non si modificano a mano**: sono generate. Su Render vai in
*Environment* e imposta tre variabili —

```
SOLVIA_TITOLARE=Nome Cognome
SOLVIA_CONTATTO_EMAIL=tua@email.it
SOLVIA_INDIRIZZO=via, città
```

— e al deploy successivo privacy, cookie e termini escono con i tuoi dati dentro.
In locale lo fai con `npm run build:pages`.

Resta solo `LICENSE` da aprire su GitHub con la matita, per metterci il tuo nome.

---

## Comandi utili

| Cosa | Comando in Termux |
|---|---|
| Avviare Solvia | `cd ~/solvia && npm start` |
| Fermarla | `Ctrl + C` |
| Copia di sicurezza | `cp ~/solvia/data/solvia.db /sdcard/Download/backup.db` |
| Aggiornarla dopo modifiche su GitHub | `cd ~/solvia && git pull && npm install` |
| Vedere se qualcosa si è rotto | `cd ~/solvia && npm run test:syntax` |

---

## Se qualcosa non va

**"pkg: command not found"** — non sei in Termux, o hai installato la versione
del Play Store. Disinstalla e riprendila da F-Droid.

**"Non trovo Solvia.zip"** — lo zip non è in Download, oppure non hai dato il
permesso ai file. Rilancia `termux-setup-storage` e riprova.

**Errori su `better-sqlite3` durante l'installazione** — normali su Android e
del tutto innocui: quel modulo è opzionale e Solvia usa quello incluso in Node.
All'avvio infatti leggerai `Database: node:sqlite`.

**Termux si chiude da solo dopo un po'** — è Android che risparmia batteria.
Nelle impostazioni del tablet, alla voce Batteria, togli le restrizioni per Termux.

**La pagina non si apre** — controlla che nel terminale ci sia scritto
"Solvia è in ascolto". Se il server si è fermato, riavvialo con `npm start`.
