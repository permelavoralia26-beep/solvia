# Mettere Solvia online

Due cose distinte, spesso confuse: **GitHub** conserva il codice, **l'hosting** lo esegue.
Servono entrambe.

---

## Netlify serve? No.

Netlify, GitHub Pages e Vercel (in modalità statica) sanno servire **file già pronti**:
HTML, CSS, immagini. Prendono i tuoi file e li mandano al browser così come sono.

Solvia non è fatta così. Ha bisogno di:

- un **processo Node sempre acceso**, che riceve le richieste e risponde;
- un **database** che conserva account, clienti, documenti e iscritti alla newsletter;
- una **cartella scrivibile** che sopravvive ai riavvii.

Su un hosting statico non c'è nessuna delle tre cose: il login non funzionerebbe, i
dati non si salverebbero e la newsletter non avrebbe dove tenere gli iscritti.

> **In breve:** GitHub Pages e Netlify no. Serve un host che esegua Node.

---

## Passo 1 — Il codice su GitHub

Il repository è già inizializzato, con un primo commit e i test automatici configurati.
Devi solo collegarlo al tuo account.

1. Vai su [github.com/new](https://github.com/new)
2. Nome: `solvia` · Visibilità: **Public** (o Private, se preferisci tenerlo riservato)
3. **Non** spuntare "Add a README" né "Add .gitignore": ci sono già
4. Crea il repository, poi dal terminale nella cartella del progetto:

```bash
git remote add origin https://github.com/TUO-UTENTE/solvia.git
git branch -M main
git push -u origin main
```

Da quel momento, a ogni `git push` GitHub esegue da solo tutta la suite di test e ti
avvisa se qualcosa si è rotto (il file è `.github/workflows/test.yml`).

### Prima di pubblicare, controlla che non ci siano segreti

```bash
git status              # nessun file .env o data/ deve comparire
grep -rn "sk_live\|whsec_\|SMTP_PASS=" --exclude-dir=node_modules . | grep -v example
```

Il `.gitignore` esclude già `.env`, `data/` e i log. **Se una chiave finisce online,
revocala subito**: rimuoverla con un commit successivo non basta, resta nella cronologia.

---

## Passo 2 — L'applicazione online

Tre opzioni con piano gratuito, dalla più semplice.

> **Prima di tutto, una cosa che costa cara scoprire dopo.**
> Il piano **gratuito** di Render **non ammette dischi persistenti**. Senza disco, il
> database di Solvia sta su un filesystem che si azzera a ogni riavvio, a ogni deploy e
> dopo ogni sospensione per inattività: account, clienti e fatture spariscono **senza
> nessun messaggio d'errore**. Per questo `render.yaml` è impostato su `starter`, il
> piano più economico che permette il disco. Il free resta utile per far vedere il sito
> a qualcuno per mezz'ora, non per farci entrare persone vere.
> ([Deploy for Free — Render Docs](https://render.com/docs/free))

### Render — la più indicata per iniziare

Il file `render.yaml` è già nel progetto: Render lo legge e configura tutto da solo.

1. [render.com](https://render.com) → accedi con GitHub
2. **New** → **Blueprint** → seleziona il repository `solvia`
3. Render legge `render.yaml`, crea il servizio e collega il disco per il database
4. Aggiungi la variabile `SOLVIA_SECRET` (Render può generarla da solo)

Nota sul piano gratuito: dopo un quarto d'ora di inattività il servizio si addormenta,
e la prima visita successiva impiega qualche decina di secondi a rispondere. Per un
progetto personale va benissimo.

### Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Rileva Node da solo e lancia `npm start`
3. Aggiungi un **Volume** montato su `/data` e imposta `SOLVIA_DATA_DIR=/data`
4. Imposta `SOLVIA_SECRET` e `NODE_ENV=production`

### Fly.io — se vuoi il server in Europa

Il file `fly.toml` è già pronto, con la regione impostata su Milano.

```bash
fly launch --no-deploy     # collega l'app al tuo account
fly volumes create solvia_data --size 1 --region mil
fly secrets set SOLVIA_SECRET="$(openssl rand -hex 32)" NODE_ENV=production
fly deploy
```

---

## Passo 3 — Le variabili d'ambiente

Sul pannello dell'host, sezione *Environment* o *Secrets*:

| Variabile | Valore | Obbligatoria |
|---|---|---|
| `SOLVIA_SECRET` | stringa casuale lunga | **sì** |
| `NODE_ENV` | `production` | **sì** |
| `SOLVIA_DATA_DIR` | percorso del disco persistente (es. `/data`) | **sì** |
| `SOLVIA_ADMIN_EMAIL` | la tua email, per essere tu l'amministratore | consigliata |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | invio email reale | per la newsletter |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | mittente delle email | per la newsletter |
| `ANTHROPIC_API_KEY` | assistente con modello linguistico | facoltativa |

Genera il segreto con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Il database è un file dentro `SOLVIA_DATA_DIR`.** Se quella cartella non è su un
> disco persistente, a ogni nuovo deploy account e iscritti spariscono. È l'errore più
> comune: verificalo prima di invitare qualcuno.

---

## Passo 4 — Far partire davvero le email

Finché non configuri l'SMTP, le email non partono: vengono registrate in
`data/outbox/` e le leggi dal pannello newsletter. Va bene per provare, ma le
conferme di iscrizione non arriveranno mai ai destinatari.

Servizi con piano gratuito adatti a un progetto personale:

| Servizio | Piano gratuito |
|---|---|
| [Brevo](https://www.brevo.com) | ~300 email al giorno |
| [Resend](https://resend.com) | ~3.000 email al mese |
| [Mailgun](https://www.mailgun.com) | prova gratuita, poi a consumo |

Configurazione tipica (Brevo):

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=la-tua-utenza
SMTP_PASS=la-tua-chiave-smtp
MAIL_FROM_EMAIL=newsletter@tuodominio.it
MAIL_FROM_NAME=Solvia
```

### Configura SPF, DKIM e DMARC

Senza questi tre record DNS, le tue email finiscono in spam — anche quelle di conferma
iscrizione, il che rende la newsletter inutilizzabile. Il pannello del servizio SMTP ti
dice esattamente quali record aggiungere al dominio. **Fallo prima del primo invio**,
non dopo: una reputazione bruciata è lenta da recuperare.

---

## Passo 5 — Il dominio

1. Compra il dominio (Namecheap, Cloudflare, Aruba, OVH: 10-15 € l'anno)
2. Nel pannello dell'host aggiungi il dominio personalizzato
3. L'host ti dà un record DNS (di solito `CNAME`) da inserire dal registrar
4. Il certificato HTTPS viene emesso in automatico, di solito entro pochi minuti

---

## Lista di controllo prima di dire a qualcuno che esiste

**Non serve tenerla a mente:** un comando la verifica al posto tuo e ti dice cosa manca,
con l'istruzione per sistemarlo. Gira anche da solo all'avvio in produzione.

```bash
npm run controllo
```

- [ ] `SOLVIA_SECRET` impostata (altrimenti tutti vengono disconnessi a ogni riavvio)
- [ ] `NODE_ENV=production` e sito raggiungibile in **https**
- [ ] `SOLVIA_DATA_DIR` su disco persistente — **verifica riavviando e ricontrollando i dati**
- [ ] Dati del titolare impostati in `SOLVIA_TITOLARE`, `SOLVIA_CONTATTO_EMAIL` e
      `SOLVIA_INDIRIZZO` — le pagine legali si rigenerano da sole (`npm run build:pages`,
      che su Render gira a ogni deploy). Nome anche in `LICENSE`
- [ ] SMTP configurato e prova di invio ricevuta davvero nella tua casella
- [ ] SPF, DKIM e DMARC impostati sul dominio
- [ ] Iscrizione alla newsletter provata dall'inizio alla fine, con un indirizzo vero
- [ ] Link di disiscrizione provato: deve funzionare al primo clic
- [ ] Registrazione, esportazione dati e cancellazione account provate una volta
- [ ] Una copia di sicurezza del database (basta copiare il file `.db`)

---

## Copie di sicurezza

Il database è un unico file: per salvarlo basta copiarlo.

```bash
# In locale
cp data/solvia.db backup-$(date +%F).db

# Su Fly.io
fly ssh console -C "cat /data/solvia.db" > backup-$(date +%F).db
```

Fallo ogni tanto. Il giorno che ti serve, sei contento di averlo fatto.
