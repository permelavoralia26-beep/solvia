#!/data/data/com.termux/files/usr/bin/bash
#
# Installazione di Solvia su tablet Samsung, dentro Termux.
#
# Uso:  bash samsung.sh
#
# Fa tutto da solo: installa quel che serve, prepara il progetto, avvia il
# server e ti dice l'indirizzo da aprire nel browser del tablet.
# Si può rilanciare quante volte vuoi: non rompe nulla e non duplica nulla.

set -u

VERDE='\033[0;32m'; GIALLO='\033[0;33m'; ROSSO='\033[0;31m'; GRASSETTO='\033[1m'; FINE='\033[0m'
ok()    { printf "  ${VERDE}✓${FINE} %s\n" "$1"; }
info()  { printf "  ${GIALLO}•${FINE} %s\n" "$1"; }
errore(){ printf "  ${ROSSO}✗${FINE} %s\n" "$1"; }
titolo(){ printf "\n${GRASSETTO}%s${FINE}\n────────────────────────────────────────\n" "$1"; }

CARTELLA="$HOME/solvia"

printf "\n${GRASSETTO}Solvia — installazione sul tablet${FINE}\n"
printf "Ci vogliono cinque minuti. Tieni il tablet collegato al wifi.\n"

# ─────────────────────────────────────────────────────────────
titolo "1. Programmi necessari"

if ! command -v pkg > /dev/null 2>&1; then
  errore "Questo script va eseguito dentro Termux."
  errore "Installa Termux da F-Droid (non dal Play Store: quella versione è vecchia)."
  exit 1
fi

info "Aggiorno l'elenco dei pacchetti…"
pkg update -y > /dev/null 2>&1
ok "elenco aggiornato"

for programma in nodejs git unzip; do
  if command -v "$programma" > /dev/null 2>&1; then
    ok "$programma già presente"
  else
    info "Installo $programma…"
    pkg install -y "$programma" > /dev/null 2>&1
    if command -v "$programma" > /dev/null 2>&1; then
      ok "$programma installato"
    else
      errore "installazione di $programma non riuscita"
      exit 1
    fi
  fi
done

printf "  Node %s · npm %s\n" "$(node -v)" "$(npm -v)"

# ─────────────────────────────────────────────────────────────
titolo "2. Il progetto"

if [ -d "$CARTELLA/.git" ]; then
  ok "progetto già presente in ~/solvia"
else
  # Cerca lo zip dove Android lo mette di solito
  ZIP=""
  for percorso in \
      "$HOME/storage/downloads/Solvia.zip" \
      "/sdcard/Download/Solvia.zip" \
      "$HOME/Solvia.zip" \
      "$(pwd)/Solvia.zip"; do
    [ -f "$percorso" ] && ZIP="$percorso" && break
  done

  if [ -z "$ZIP" ]; then
    errore "Non trovo Solvia.zip."
    printf "\n  Fai così:\n"
    printf "  1. In Termux scrivi:  ${GRASSETTO}termux-setup-storage${FINE}  e concedi il permesso\n"
    printf "  2. Sposta Solvia.zip nella cartella Download del tablet\n"
    printf "  3. Rilancia questo script\n\n"
    exit 1
  fi

  ok "trovato: $ZIP"
  info "Estraggo…"
  TMP=$(mktemp -d)
  unzip -q "$ZIP" -d "$TMP"

  # Lo zip contiene una sola cartella con dentro il repository completo, ma il
  # suo nome può cambiare fra una versione e l'altra: invece di indovinarlo, si
  # cerca la cartella che contiene package.json. Così non si finisce con un
  # ~/solvia/solvia-app/ annidato, che è il modo silenzioso di rompere tutto.
  RADICE=""
  [ -f "$TMP/package.json" ] && RADICE="$TMP"
  if [ -z "$RADICE" ]; then
    for candidata in "$TMP"/*/; do
      [ -f "${candidata}package.json" ] && RADICE="${candidata%/}" && break
    done
  fi

  if [ -z "$RADICE" ]; then
    errore "Nello zip non trovo il progetto (manca package.json)."
    printf "  Lo zip potrebbe essere incompleto: riscaricalo.\n\n"
    rm -rf "$TMP"; exit 1
  fi

  if [ "$RADICE" = "$TMP" ]; then
    mkdir -p "$CARTELLA" && mv "$TMP"/* "$TMP"/.[!.]* "$CARTELLA/" 2>/dev/null
  else
    mv "$RADICE" "$CARTELLA"
  fi
  rm -rf "$TMP"
  ok "progetto estratto in ~/solvia"
fi

cd "$CARTELLA" || exit 1

# ─────────────────────────────────────────────────────────────
titolo "3. Dipendenze"

if [ -d node_modules ]; then
  ok "dipendenze già installate"
else
  info "Installo le dipendenze (è il passaggio più lento, 2-3 minuti)…"
  # better-sqlite3 su Android non si compila: si salta e si usa il modulo
  # sqlite incluso in Node, che qui funziona benissimo.
  npm install --omit=optional --no-audit --no-fund 2>&1 | tail -3
  if [ -d node_modules ]; then
    ok "dipendenze installate"
  else
    errore "installazione non riuscita — controlla la connessione e riprova"
    exit 1
  fi
fi

# ─────────────────────────────────────────────────────────────
titolo "4. Configurazione"

if [ -f .env ]; then
  ok "configurazione già presente"
else
  SEGRETO=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env <<EOF
# Generato automaticamente sul tablet
PORT=3000
SOLVIA_SECRET=$SEGRETO
SOLVIA_DATA_DIR=./data

# Piani e limiti accesi: vedi l'app esattamente come la vedrà un cliente.
# Senza chiavi Stripe il pagamento è simulato, quindi "Passa a Pro" funziona
# subito e non incassa nulla. Metti "false" per togliere limiti e prezzi.
SOLVIA_COMMERCIAL=true
EOF
  ok "chiave di sicurezza generata"
fi

# .env non viene letto da solo: si esporta prima dell'avvio
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ─────────────────────────────────────────────────────────────
titolo "5. Controllo"

if node test-syntax.js > /dev/null 2>&1; then
  ok "codice integro"
else
  errore "controllo del codice fallito — l'estrazione potrebbe essere incompleta"
fi

IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
[ -z "$IP" ] && IP=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' \
  | grep -v '127.0.0.1' | awk '{print $2}' | head -1)

printf "\n${GRASSETTO}Tutto pronto.${FINE}\n────────────────────────────────────────\n"
printf "  Apri il browser del tablet su:  ${GRASSETTO}http://localhost:3000${FINE}\n"
[ -n "$IP" ] && printf "  Dal telefono sulla stessa rete:  ${GRASSETTO}http://%s:3000${FINE}\n" "$IP"
printf "\n  Per fermare il server: premi Ctrl+C\n"
printf "  Per riavviarlo domani:  ${GRASSETTO}cd ~/solvia && npm start${FINE}\n"
printf "\n  ${GIALLO}Suggerimento:${FINE} dopo aver aperto la pagina, dal menu di Chrome\n"
printf "  scegli \"Installa app\" per averla sulla schermata home.\n\n"

exec npm start
