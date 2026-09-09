#!/usr/bin/env bash
# Progetto gratuito: niente da vendere, quindi al posto del listino c'è la
# domanda "quanto pagheresti?". Deve raccogliere risposte vere, non incassare
# niente, e non promettere nulla a chi risponde.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
non_ha() { echo "$1" | grep -q "$2" && echo ko || echo ok; }

PORT=4800
BASE="http://localhost:$PORT"
DIR=$(mktemp -d)
SOLVIA_COMMERCIAL=false PORT=$PORT SOLVIA_DATA_DIR="$DIR" \
  node "$(dirname "$0")/server.js" > "$DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$DIR"' EXIT

for _ in $(seq 1 60); do curl -sf "$BASE/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "$BASE/api/health" >/dev/null 2>&1; then
  echo "Il server di prova non è partito:"; cat "$DIR/server.log"; exit 1
fi

# Ogni risposta arriva da un "visitatore" diverso: l'impronta si calcola anche
# dallo user-agent, quindi cambiarlo simula persone diverse dallo stesso IP.
rispondi() { # $1 = user-agent, $2 = corpo JSON
  curl -s -X POST "$BASE/api/pubblico/sondaggio" -H 'Content-Type: application/json' \
    -H "User-Agent: $1" -d "$2"
}

echo ""
echo "Test sondaggio sul prezzo (progetto gratuito)"
echo "────────────────────────────────────────"

echo "Il sito non vende niente e non lo nasconde"
R=$(curl -s "$BASE/api/stato-pubblico")
check "la landing sa che la parte commerciale è spenta" "$(has "$R" '"commerciale": *false')"
check "e che non è pre-lancio" "$(has "$R" '"prelancio": *false')"
R=$(curl -s "$BASE/")
check "la pagina contiene la sezione del sondaggio" "$(has "$R" 'id="sondaggio"')"
check "e la domanda è scritta per intero" "$(has "$R" 'Quanto pagheresti')"
check "dice chiaro che non si paga niente" "$(has "$R" 'non un carrello')"

R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/billing/checkout" \
  -H 'Content-Type: application/json' -d '{"plan":"pro"}')
check "il checkout resta chiuso" "$([ "$R" != "200" ] && echo ok || echo ko)"

echo ""
echo "Raccoglie le risposte"
R=$(rispondi "prova-uno" '{"importo":19,"mestiere":"fotografo"}')
check "accetta una cifra valida" "$(has "$R" '"ok": *true')"
check "e ringrazia" "$(has "$R" 'Grazie')"

R=$(rispondi "prova-due" '{"importo":0}')
check "accetta anche \"non pagherei\"" "$(has "$R" '"ok": *true')"
check "e lo tratta come una risposta utile, non come un rifiuto" "$(has "$R" 'utile quanto il contrario')"

R=$(rispondi "prova-tre" '{"importo":29,"mestiere":"grafica","email":"grafica@esempio.it"}')
check "accetta l'email quando c'è" "$(has "$R" '"ok": *true')"

echo ""
echo "Rifiuta quello che non ha senso"
R=$(rispondi "prova-quattro" '{"importo":-5}')
check "una cifra negativa viene respinta" "$(has "$R" '"ok": *false')"
R=$(rispondi "prova-quattro" '{"importo":99999}')
check "una cifra assurda viene respinta" "$(has "$R" 'fra 0 e 500')"
R=$(rispondi "prova-quattro" '{"importo":"venti"}')
check "il testo al posto del numero viene respinto" "$(has "$R" '"ok": *false')"
R=$(rispondi "prova-quattro" '{"importo":10,"email":"non-una-email"}')
check "un'email storta viene respinta" "$(has "$R" 'non sembra valido')"
R=$(rispondi "prova-quattro" '{}')
check "una risposta vuota viene respinta" "$(has "$R" '"ok": *false')"

echo ""
echo "Non si può gonfiare ricaricando"
rispondi "ripetuto" '{"importo":5}' >/dev/null
R=$(rispondi "ripetuto" '{"importo":49}')
check "rispondere di nuovo aggiorna invece di aggiungere" "$(has "$R" '"aggiornata": *true')"

echo ""
echo "I risultati si leggono solo dalla console"
R=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/console/dati")
check "senza essere amministratore non si vedono" "$([ "$R" = "404" ] && echo ok || echo ko)"

JAR=$(mktemp)
curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"capo@solvia.it","password":"passwordsicura","name":"Capo"}' >/dev/null
D=$(curl -s -b "$JAR" "$BASE/console/dati")
check "l'amministratore vede il quadro" "$(has "$D" '"sondaggio"')"

# Le risposte valide arrivate fin qui: 19, 0, 29 e il 49 che ha sostituito il 5.
campo() { echo "$D" | python3 -c "import sys,json;print(json.load(sys.stdin)['sondaggio']['$1'])"; }
check "conta 4 risposte, una per visitatore" "$([ "$(campo totale)" = "4" ] && echo ok || echo ko)"
check "di cui 3 pagherebbero qualcosa" "$([ "$(campo disposti)" = "3" ] && echo ok || echo ko)"
check "la mediana di chi pagherebbe è 29 €" "$([ "$(campo mediana)" = "29" ] && echo ok || echo ko)"
check "il massimo indicato è 49 €" "$([ "$(campo massimo)" = "49" ] && echo ok || echo ko)"
check "sa quanti hanno lasciato l'email" "$([ "$(campo conEmail)" = "1" ] && echo ok || echo ko)"
check "riporta il mestiere di chi l'ha scritto" "$(has "$D" 'fotografo')"
check "e le fasce per leggere la distribuzione" "$(has "$D" 'Non pagherei')"

echo ""
echo "Quello che il sondaggio NON fa"
check "non promette un abbonamento" "$(non_ha "$(curl -s "$BASE/")" 'diventa investitore')"
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "l'app resta senza piani a pagamento" "$(has "$R" '"mode": *"disattivato"')"
check "e senza limiti d'uso" "$(has "$R" '"quotesPerMonth": *null')"

echo ""
echo "Sostegno volontario: spento finché non è configurato davvero"
check "senza configurazione il server dice che è spento" "$(has "$(curl -s "$BASE/api/stato-pubblico")" '"attivo": *false')"
check "e non passa nessun indirizzo" "$(has "$(curl -s "$BASE/api/stato-pubblico")" '"url": *null')"

# Un server a parte, acceso come lo accenderebbe un genitore.
DIR2=$(mktemp -d)
SOLVIA_COMMERCIAL=false PORT=4801 SOLVIA_DATA_DIR="$DIR2" \
  SOLVIA_SOSTIENI_URL="https://ko-fi.com/mariorossi" SOLVIA_SOSTIENI_NOME="Mario Rossi" \
  node "$(dirname "$0")/server.js" > "$DIR2/log" 2>&1 &
PID2=$!
trap 'kill $SERVER_PID $PID2 2>/dev/null; rm -rf "$DIR" "$DIR2"' EXIT
for _ in $(seq 1 60); do curl -sf "http://localhost:4801/api/health" >/dev/null 2>&1 && break; sleep 0.5; done

R=$(curl -s "http://localhost:4801/api/stato-pubblico")
check "con link e nome validi risulta acceso" "$(has "$R" '"attivo": *true')"
check "espone l'indirizzo configurato" "$(has "$R" 'ko-fi.com/mariorossi')"
check "e dice a chi vanno i soldi" "$(has "$R" 'Mario Rossi')"
R=$(curl -s "http://localhost:4801/")
check "la pagina dice che non compra niente" "$(has "$R" 'non compra niente')"
check "e che l'incasso non passa da questo sito" "$(has "$R" 'non questo sito')"
kill $PID2 2>/dev/null

echo ""
echo "Configurazioni sbagliate non accendono niente"
prova() { # $1 = variabili, restituisce "attivo" o "spento"
  env -i PATH="$PATH" HOME="$HOME" $1 node -e \
    "console.log(require('$(cd "$(dirname "$0")" && pwd)/lib/sostegno').ATTIVO ? 'attivo' : 'spento')"
}
check "un link http (non https) viene rifiutato" \
  "$([ "$(prova 'SOLVIA_SOSTIENI_URL=http://ko-fi.com/x SOLVIA_SOSTIENI_NOME=Mario')" = "spento" ] && echo ok || echo ko)"
check "un sito qualunque viene rifiutato" \
  "$([ "$(prova 'SOLVIA_SOSTIENI_URL=https://sito-strano.xyz/paga SOLVIA_SOSTIENI_NOME=Mario')" = "spento" ] && echo ok || echo ko)"
check "senza il nome di chi riceve non si accende" \
  "$([ "$(prova 'SOLVIA_SOSTIENI_URL=https://ko-fi.com/x')" = "spento" ] && echo ok || echo ko)"
check "una piattaforma riconosciuta con il nome si accende" \
  "$([ "$(prova 'SOLVIA_SOSTIENI_URL=https://liberapay.com/x SOLVIA_SOSTIENI_NOME=Mario')" = "attivo" ] && echo ok || echo ko)"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
