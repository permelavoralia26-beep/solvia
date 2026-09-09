#!/usr/bin/env bash
# Modalità pre-lancio: il sito è online, i prezzi si vedono, ma non si incassa
# ancora e chi vorrebbe pagare finisce in lista d'attesa invece che davanti a
# un pagamento finto.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
jq_() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)" 2>/dev/null || echo ERR; }

PORT=4790
BASE="http://localhost:$PORT"
DIR=$(mktemp -d)
SOLVIA_PRELANCIO=true PORT=$PORT SOLVIA_DATA_DIR="$DIR" \
  node "$(dirname "$0")/server.js" > "$DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$DIR"' EXIT

for _ in $(seq 1 60); do curl -sf "$BASE/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "$BASE/api/health" >/dev/null 2>&1; then
  echo "Il server di prova non è partito:"; cat "$DIR/server.log"; exit 1
fi

echo ""
echo "Test modalità pre-lancio"
echo "────────────────────────────────────────"

JAR=$(mktemp)
curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"capo@solvia.it","password":"passwordsicura","name":"Capo"}' >/dev/null
curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"vuoto"}' >/dev/null
curl -s -b "$JAR" -X POST "$BASE/api/onboarding/completa" >/dev/null

echo "Il sito dice la verità"
R=$(curl -s "$BASE/api/stato-pubblico")
check "la landing sa che è pre-lancio" "$(has "$R" '"prelancio": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "anche l'app lo sa" "$(has "$R" '"prelancio": *true')"
R=$(curl -s "$BASE/")
check "i prezzi restano scritti sul sito" "$(has "$R" '€19')"

echo ""
echo "Nessun pagamento, nemmeno finto"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/billing/checkout" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}')
check "il checkout è chiuso, con un motivo chiaro" "$(has "$R" 'non sono ancora aperti')"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/billing/demo-attiva" \
  -H 'Content-Type: application/json' -d '{"plan":"pro"}')
check "l'attivazione simulata risponde 409" "$([ "$CODE" = "409" ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "e il piano resta Free" "$(has "$R" '"plan": *"free"')"

echo ""
echo "Chi voleva pagare finisce in lista"
R=$(curl -s -X POST "$BASE/api/billing/attesa" -H 'Content-Type: application/json' \
  -d '{"email":"tizio@example.com","plan":"team"}')
check "dal sito, senza account" "$(has "$R" '"ok": *true')"
R=$(curl -s -X POST "$BASE/api/billing/attesa" -H 'Content-Type: application/json' \
  -d '{"email":"tizio@example.com","plan":"team"}')
check "ripetere non è un errore: risulta già in lista" "$(has "$R" '"gia": *true')"
R=$(curl -s -X POST "$BASE/api/billing/attesa" -H 'Content-Type: application/json' \
  -d '{"email":"non-una-email"}')
check "un indirizzo non valido viene rifiutato" "$(has "$R" 'email valido')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/billing/attesa" -H 'Content-Type: application/json' \
  -d '{"plan":"pro","source":"app"}')
check "da dentro l'app l'email si prende dall'account" "$(has "$R" '"ok": *true')"

echo ""
echo "Il limite del piano gratuito propone la lista, non un pagamento"
for _ in 1 2 3 4; do
  R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
    -d '{"kind":"preventivo","items":[{"description":"X","quantity":1,"unit_price":10}]}')
done
check "il rifiuto arriva col limite raggiunto" "$(has "$R" 'limite di 3 preventivi')"
check "e porta con sé il flag del pre-lancio" "$(has "$R" '"prelancio": *true')"

echo ""
echo "La console vede la lista"
R=$(curl -s -b "$JAR" "$BASE/console/dati")
check "totale in lista" "$([ "$(jq_ "$R" "['attesa']['totale']")" = "2" ] && echo ok || echo ko)"
check "quanto varrebbe al mese (49 + 19)" \
  "$([ "$(jq_ "$R" "['attesa']['potenziale']")" = "68" ] && echo ok || echo ko)"
check "gli indirizzi sono elencati" "$(has "$R" 'tizio@example.com')"
check "l'iscrizione è anche un evento" "$(has "$R" 'lista_attesa')"

echo ""
echo "Quando i pagamenti aprono, tutto torna normale"
DIR2=$(mktemp -d)
PORT=4791 SOLVIA_DATA_DIR="$DIR2" node "$(dirname "$0")/server.js" > "$DIR2/s.log" 2>&1 &
PID2=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:4791/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
J2=$(mktemp)
curl -s -c "$J2" -X POST "http://localhost:4791/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"x@y.it","password":"passwordsicura","name":"X"}' >/dev/null

R=$(curl -s "http://localhost:4791/api/stato-pubblico")
check "senza la variabile il pre-lancio è spento" "$(has "$R" '"prelancio": *false')"
R=$(curl -s -b "$J2" -X POST "http://localhost:4791/api/billing/demo-attiva" \
  -H 'Content-Type: application/json' -d '{"plan":"pro"}')
check "l'attivazione torna a funzionare" "$(has "$R" '"ok": *true')"
R=$(curl -s -X POST "http://localhost:4791/api/billing/attesa" -H 'Content-Type: application/json' \
  -d '{"email":"tardi@example.com"}')
check "e la lista d'attesa non accetta più nessuno" "$(has "$R" 'già aperti')"
kill $PID2 2>/dev/null; rm -rf "$DIR2"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
