#!/usr/bin/env bash
# Test di abbonamenti, limiti di piano e webhook.
# Uso: ./test-billing.sh [base_url]
set -uo pipefail

JAR=$(mktemp)
PASS=0; FAIL=0

# Senza un indirizzo esplicito avvia un server con la parte commerciale accesa e
# un database vuoto: così questi test girano sempre, anche se la configurazione
# predefinita del progetto è gratuita.
OWN_SERVER=0
if [ $# -eq 0 ]; then
  OWN_SERVER=1
  PORT=4800
  BASE="http://localhost:$PORT"
  TMPDATA=$(mktemp -d)

  PORT=$PORT SOLVIA_DATA_DIR="$TMPDATA" SOLVIA_COMMERCIAL=true \
    node "$(dirname "$0")/server.js" > "$TMPDATA/server.log" 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$TMPDATA" "$JAR"' EXIT

  for _ in $(seq 1 60); do
    curl -sf "$BASE/api/health" > /dev/null 2>&1 && break
    sleep 0.5
  done
  if ! curl -sf "$BASE/api/health" > /dev/null 2>&1; then
    echo "Il server di prova non è partito:"; cat "$TMPDATA/server.log"; exit 1
  fi
else
  BASE="$1"
fi

check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
jq_() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)" 2>/dev/null || echo ERR; }

echo ""
echo "Test abbonamenti e limiti su $BASE"
echo "────────────────────────────────────────"

# Di default Solvia è un progetto gratuito: piani e limiti sono spenti e questi
# test non hanno oggetto. Si eseguono avviando il server con SOLVIA_COMMERCIAL=true.
MODE=$(curl -s "$BASE/api/health" | python3 -c "import sys,json;print(json.load(sys.stdin).get('billingMode',''))" 2>/dev/null || echo '')
if [ "$MODE" = "disattivato" ]; then
  echo "  saltati — la parte commerciale è disattivata (progetto gratuito)."
  echo "  Per eseguirli: SOLVIA_COMMERCIAL=true npm start"
  echo "────────────────────────────────────────"
  echo ""
  exit 0
fi

EMAIL="bill$(date +%s)@example.com"
curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"passwordsicura\",\"name\":\"Test Piano\"}" > /dev/null

echo "Stato iniziale"
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "nuovo account parte dal piano Free" "$([ "$(jq_ "$R" "['plan']")" = "free" ] && echo ok || echo ko)"
check "limite preventivi del piano Free = 3" "$([ "$(jq_ "$R" "['limits']['quotesPerMonth']")" = "3" ] && echo ok || echo ko)"
check "limite clienti del piano Free = 5" "$([ "$(jq_ "$R" "['limits']['clients']")" = "5" ] && echo ok || echo ko)"
check "consumo iniziale calcolato dai dati demo" \
  "$([ "$(jq_ "$R" "['usage']['quotesThisMonth']")" -ge 0 ] && echo ok || echo ko)"
check "listino esposto con 3 piani" "$([ "$(jq_ "$R" "['plans'].__len__()")" = "3" ] && echo ok || echo ko)"

echo ""
echo "Limite preventivi (Free = 3 al mese)"
CREATED=0
for i in 1 2 3 4 5 6 7; do
  R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
    -d '{"kind":"preventivo","items":[{"description":"Voce","quantity":1,"unit_price":100}]}')
  if echo "$R" | grep -q '"kind": *"preventivo"'; then CREATED=$((CREATED+1)); else LAST="$R"; break; fi
done
check "creazione bloccata prima di sforare il limite" "$([ "$CREATED" -lt 7 ] && echo ok || echo ko)"
check "il blocco restituisce 402 con invito all'upgrade" "$(has "${LAST:-}" '"upgrade": *true')"
check "il messaggio di blocco cita il piano Free" "$(has "${LAST:-}" 'Free')"

echo ""
echo "Limite email analizzate (Free = 10 al mese)"
for i in $(seq 1 12); do
  curl -s -b "$JAR" -X POST "$BASE/api/emails" -H 'Content-Type: application/json' \
    -d "{\"subject\":\"Richiesta preventivo $i\",\"body\":\"Buongiorno, vorrei un preventivo.\"}" > /dev/null
done
R=$(curl -s -b "$JAR" -X POST "$BASE/api/emails/triage-all")
PROCESSED=$(jq_ "$R" "['processed']")
check "l'analisi in blocco si ferma al limite del piano" "$([ "$PROCESSED" -le 10 ] && echo ok || echo ko)"
check "segnala il motivo del blocco" "$(has "$R" '"blocked"')"

echo ""
echo "Attivazione abbonamento (modalità demo)"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/billing/checkout" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}')
check "checkout restituisce un URL di pagamento" "$(has "$R" 'pagamento-demo')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/billing/checkout" -H 'Content-Type: application/json' \
  -d '{"plan":"free"}')
check "il piano Free non genera un pagamento" "$(has "$R" 'non richiede pagamento')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}')
check "attivazione del piano Pro" "$([ "$(jq_ "$R" "['plan']")" = "pro" ] && echo ok || echo ko)"
check "limiti rimossi dopo l'attivazione" \
  "$([ "$(jq_ "$R" "['limits']['quotesPerMonth']")" = "None" ] && echo ok || echo ko)"
check "data di rinnovo impostata" "$(has "$R" 'renewsAt')"

echo ""
echo "Le funzioni bloccate si sbloccano"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d '{"kind":"preventivo","items":[{"description":"Dopo upgrade","quantity":1,"unit_price":100}]}')
check "preventivo creato oltre il vecchio limite" "$(has "$R" 'Dopo upgrade')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/emails/triage-all")
check "analisi email non più bloccata" "$([ "$(jq_ "$R" "['blocked']")" = "None" ] && echo ok || echo ko)"

echo ""
echo "Disdetta"
curl -s -b "$JAR" -X POST "$BASE/api/billing/demo-disdici" > /dev/null
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "la disdetta riporta al piano Free" "$([ "$(jq_ "$R" "['plan']")" = "free" ] && echo ok || echo ko)"
check "stato registrato come disdetto" "$([ "$(jq_ "$R" "['status']")" = "disdetto" ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d '{"kind":"preventivo","items":[{"description":"X","quantity":1,"unit_price":1}]}')
check "i limiti tornano attivi dopo la disdetta" "$(has "$R" '"upgrade": *true')"

echo ""
echo "Sicurezza del webhook"
R=$(curl -s -X POST "$BASE/api/billing/webhook" -H 'Content-Type: application/json' \
  -d '{"type":"checkout.session.completed","data":{"object":{"metadata":{"solvia_user_id":"1","plan":"team"}}}}')
check "webhook non firmato rifiutato" \
  "$(echo "$R" | grep -qE 'Stripe non configurato|Firma non valida' && echo ok || echo ko)"
R=$(curl -s "$BASE/api/billing")
check "stato abbonamento non leggibile senza sessione" "$(has "$R" 'Non autenticato')"
R=$(curl -s -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' -d '{"plan":"pro"}')
check "attivazione demo non eseguibile senza sessione" "$(has "$R" 'Non autenticato')"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$OWN_SERVER" -eq 1 ] || rm -f "$JAR"
[ "$FAIL" -eq 0 ]
