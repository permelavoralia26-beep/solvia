#!/usr/bin/env bash
# Test della diagnostica di configurazione Stripe.
# Verifica che riconosca gli errori tipici e che sia riservata all'amministratore.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }

# Avvia un server con la configurazione richiesta e restituisce la diagnostica.
diagnostica() {
  local dir port jar
  dir=$(mktemp -d); port=$1; shift
  env "$@" SOLVIA_DATA_DIR="$dir" PORT="$port" \
    node "$(dirname "$0")/server.js" > "$dir/s.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 60); do curl -sf "http://localhost:$port/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
  jar=$(mktemp)
  curl -s -c "$jar" -X POST "http://localhost:$port/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"a$port@t.it\",\"password\":\"passwordsicura\",\"name\":\"A\"}" >/dev/null
  RISPOSTA=$(curl -s -b "$jar" "http://localhost:$port/api/billing/diagnostica")
  BASE_ATTUALE="http://localhost:$port"; JAR_ATTUALE="$jar"
  kill $pid 2>/dev/null
  rm -rf "$dir"
}

echo ""
echo "Test diagnostica configurazione pagamenti"
echo "────────────────────────────────────────"

echo "Nessuna configurazione"
diagnostica 5901 SOLVIA_COMMERCIAL=false
check "segnala che non è pronto" "$(has "$RISPOSTA" '"pronto": *false')"
check "rileva la parte commerciale spenta" "$(has "$RISPOSTA" 'Parte commerciale spenta')"
check "rileva la chiave mancante" "$(has "$RISPOSTA" 'Chiave segreta mancante')"
check "rileva il prezzo Pro mancante" "$(has "$RISPOSTA" 'Prezzo del piano Pro non configurato')"
check "rileva il webhook mancante" "$(has "$RISPOSTA" 'Segreto del webhook mancante')"
check "ogni errore ha un'istruzione" \
  "$(echo "$RISPOSTA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
mancanti=[c['titolo'] for c in d['controlli'] if c['stato']=='errore' and not c.get('azione')]
print('ok' if not mancanti else 'ko: '+str(mancanti))")"

echo ""
echo "Configurazione predefinita (commerciale acceso, Stripe non collegato)"
diagnostica 5906
check "non lamenta la parte commerciale" \
  "$(echo "$RISPOSTA" | grep -q 'Parte commerciale spenta' && echo ko || echo ok)"
check "dice comunque che manca la chiave" "$(has "$RISPOSTA" 'Chiave segreta mancante')"
check "non si dichiara pronto a incassare" "$(has "$RISPOSTA" '"pronto": *false')"

echo ""
echo "Errori tipici di copia-incolla"
diagnostica 5902 SOLVIA_COMMERCIAL=true STRIPE_SECRET_KEY=pk_test_x \
  STRIPE_PRICE_PRO=prod_X STRIPE_WEBHOOK_SECRET=we_X
check "riconosce la chiave pubblicabile al posto di quella segreta" "$(has "$RISPOSTA" 'chiave pubblicabile')"
check "riconosce l'ID prodotto al posto dell'ID prezzo" "$(has "$RISPOSTA" "ID del prodotto invece")"
check "riconosce l'ID endpoint al posto del segreto di firma" "$(has "$RISPOSTA" 'ID dell.endpoint')"

echo ""
echo "Chiave con formato valido ma inesistente"
diagnostica 5903 SOLVIA_COMMERCIAL=true \
  STRIPE_SECRET_KEY=sk_test_chiavecheNONesisteDavvero123456789 \
  STRIPE_PRICE_PRO=price_finto STRIPE_WEBHOOK_SECRET=whsec_finto
check "accetta il formato della chiave" "$(has "$RISPOSTA" 'Chiave segreta presente')"
check "riconosce che Stripe la rifiuta" "$(has "$RISPOSTA" 'Stripe rifiuta la chiave')"
check "accetta il formato del webhook" "$(has "$RISPOSTA" 'Segreto del webhook presente')"
check "non dichiara pronto un sistema che non lo è" "$(has "$RISPOSTA" '"pronto": *false')"

echo ""
echo "Permessi"
diagnostica 5904 SOLVIA_COMMERCIAL=true
R=$(curl -s "$BASE_ATTUALE/api/billing/diagnostica" 2>/dev/null || echo '{"error":"non raggiungibile"}')
check "non accessibile senza sessione" \
  "$(echo "$R" | grep -qE 'Non autenticato|non raggiungibile' && echo ok || echo ko)"

# Un utente normale (non il primo registrato) non deve vederla
DIR=$(mktemp -d)
SOLVIA_COMMERCIAL=true SOLVIA_DATA_DIR="$DIR" PORT=5905 node "$(dirname "$0")/server.js" > "$DIR/s.log" 2>&1 &
PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:5905/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -s -X POST "http://localhost:5905/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"primo@t.it","password":"passwordsicura","name":"Primo"}' >/dev/null
JAR2=$(mktemp)
curl -s -c "$JAR2" -X POST "http://localhost:5905/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@t.it","password":"passwordsicura","name":"Secondo"}' >/dev/null
R=$(curl -s -b "$JAR2" "http://localhost:5905/api/billing/diagnostica")
check "un utente normale non può eseguirla" "$(has "$R" 'riservata')"
kill $PID 2>/dev/null; rm -rf "$DIR" "$JAR2"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
