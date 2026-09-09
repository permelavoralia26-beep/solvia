#!/usr/bin/env bash
# Test delle funzioni Pro: preventivi condivisi, solleciti, ricorrenti, tasse, spese, ricerca.
# Uso: ./test-pro.sh [base_url]
set -uo pipefail

JAR=$(mktemp); JAR2=$(mktemp)
PASS=0; FAIL=0

# Avvia un server dedicato con la parte commerciale accesa e database vuoto.
OWN_SERVER=0
if [ $# -eq 0 ]; then
  OWN_SERVER=1
  PORT=4900
  BASE="http://localhost:$PORT"
  TMPDATA=$(mktemp -d)
  PORT=$PORT SOLVIA_DATA_DIR="$TMPDATA" SOLVIA_COMMERCIAL=true \
    node "$(dirname "$0")/server.js" > "$TMPDATA/server.log" 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$TMPDATA" "$JAR" "$JAR2"' EXIT
  for _ in $(seq 1 60); do curl -sf "$BASE/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
  if ! curl -sf "$BASE/api/health" >/dev/null 2>&1; then
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
echo "Test funzioni Pro su $BASE"
echo "────────────────────────────────────────"

PRO="pro$(date +%s)@example.com"
curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PRO\",\"password\":\"passwordsicura\",\"name\":\"Anna Pro\",\"business_name\":\"Studio Anna\"}" >/dev/null
curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}' >/dev/null   # i dati di esempio ora si chiedono

echo "Blocchi del piano gratuito"
R=$(curl -s -b "$JAR" "$BASE/api/finance/recurring")
check "ricorrenti riservate al piano Pro" "$(has "$R" '"proOnly": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/reminders")
check "solleciti riservati al piano Pro" "$(has "$R" '"proOnly": *true')"
QID=$(curl -s -b "$JAR" "$BASE/api/documents?kind=preventivo" | jq_ "$(echo)" "['documents'][0]['id']" 2>/dev/null || echo "")
QID=$(curl -s -b "$JAR" "$BASE/api/documents?kind=preventivo" | python3 -c "import sys,json;print(json.load(sys.stdin)['documents'][0]['id'])")
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$QID/condividi")
check "condivisione preventivo riservata al piano Pro" "$(has "$R" '"proOnly": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/expenses")
check "le spese restano incluse nel piano gratuito" "$(has "$R" 'categories')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/tax")
check "il calcolo tasse resta incluso nel piano gratuito" "$(has "$R" 'onCollected')"

echo ""
echo "Attivazione Pro"
curl -s -b "$JAR" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}' >/dev/null
R=$(curl -s -b "$JAR" "$BASE/api/finance/recurring")
check "dopo l'attivazione le ricorrenti si aprono" "$(has "$R" 'monthlyValue')"

echo ""
echo "Preventivo condiviso e accettazione"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$QID/condividi")
TOKEN=$(jq_ "$R" "['token']")
check "link generato" "$([ ${#TOKEN} -eq 64 ] && echo ok || echo ko)"
check "il preventivo passa a 'inviata'" "$(has "$R" '"status": *"inviata"')"

R=$(curl -s "$BASE/api/pubblico/preventivo/$TOKEN")
check "il cliente vede il preventivo senza login" "$(has "$R" '"numero"')"
check "sono presenti le voci e i totali" "$(has "$R" '"totali"')"
check "risulta decidibile" "$(has "$R" '"decidibile": *true')"
check "NON espone dati di altri documenti" "$(echo "$R" | grep -q 'user_id' && echo ko || echo ok)"

R=$(curl -s "$BASE/api/pubblico/preventivo/token-inventato-che-non-esiste")
check "token inventato rifiutato" "$(has "$R" 'non trovato')"

R=$(curl -s -b "$JAR" "$BASE/api/documents/$QID")
check "la prima apertura viene registrata" "$(has "$R" 'viewed_at')"

R=$(curl -s -X POST "$BASE/api/pubblico/preventivo/$TOKEN/decisione" \
  -H 'Content-Type: application/json' -d '{"accetta":true,"nota":"Perfetto, procediamo"}')
check "il cliente accetta con un clic" "$(has "$R" '"stato": *"accettata"')"

R=$(curl -s -X POST "$BASE/api/pubblico/preventivo/$TOKEN/decisione" \
  -H 'Content-Type: application/json' -d '{"accetta":false}')
check "non si può decidere due volte" "$(has "$R" 'già stato deciso')"

R=$(curl -s -b "$JAR" "$BASE/api/tasks")
check "l'accettazione crea l'attività 'emetti fattura'" "$(has "$R" 'accettato')"

curl -s -b "$JAR" -X DELETE "$BASE/api/documents/$QID/condividi" >/dev/null
R=$(curl -s "$BASE/api/pubblico/preventivo/$TOKEN")
check "revocando il link il cliente non vede più nulla" "$(has "$R" 'non trovato')"

echo ""
echo "Fatture ricorrenti"
CID=$(curl -s -b "$JAR" "$BASE/api/clients" | python3 -c "import sys,json;print(json.load(sys.stdin)['clients'][0]['id'])")
R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/recurring" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Manutenzione mensile\",\"client_id\":$CID,\"frequency\":\"mensile\",
       \"next_run\":\"$(date +%Y-%m-%d)\",\"vat_rate\":22,
       \"items\":[{\"description\":\"Manutenzione\",\"quantity\":1,\"unit_price\":200}]}")
RID=$(jq_ "$R" "['id']")
check "creazione abbonamento" "$(has "$R" '"ok": *true')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/recurring" -H 'Content-Type: application/json' \
  -d '{"name":"Senza voci","frequency":"mensile","items":[]}')
check "abbonamento senza voci rifiutato" "$(has "$R" 'almeno una voce')"

R=$(curl -s -b "$JAR" "$BASE/api/finance/recurring")
check "ricavo ricorrente mensile calcolato (244 € con IVA)" \
  "$(python3 -c "print('ok' if abs($(jq_ "$R" "['monthlyValue']")-244)<0.01 else 'ko')")"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/recurring/$RID/genera")
check "genera la fattura" "$(has "$R" '"ok": *true')"
NUM=$(jq_ "$R" "['number']")
R=$(curl -s -b "$JAR" "$BASE/api/finance/recurring")
NEXT=$(echo "$R" | python3 -c "
import sys,json
print(json.load(sys.stdin)['recurring'][0]['next_run'])" 2>/dev/null || echo "")
check "la prossima scadenza avanza di un mese" \
  "$(python3 -c "
from datetime import date
import calendar
t=date.today()
m=t.month%12+1; y=t.year+(1 if t.month==12 else 0)
d=min(t.day, calendar.monthrange(y,m)[1])
print('ok' if '$NEXT'==f'{y:04d}-{m:02d}-{d:02d}' else 'ko:$NEXT')")"
R=$(curl -s -b "$JAR" "$BASE/api/documents?kind=fattura")
check "la fattura generata compare in elenco" "$(has "$R" "$NUM")"

echo ""
echo "Solleciti automatici"
# Fattura scaduta da 40 giorni
OLD=$(python3 -c "from datetime import date,timedelta;print(date.today()-timedelta(days=45))")
DUE=$(python3 -c "from datetime import date,timedelta;print(date.today()-timedelta(days=40))")
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"fattura\",\"client_id\":$CID,\"issue_date\":\"$OLD\",\"due_date\":\"$DUE\",
       \"items\":[{\"description\":\"Lavoro vecchio\",\"quantity\":1,\"unit_price\":900}]}")
INV=$(jq_ "$R" "['document']['id']")
curl -s -b "$JAR" -X PATCH "$BASE/api/documents/$INV/status" -H 'Content-Type: application/json' \
  -d '{"status":"inviata"}' >/dev/null

R=$(curl -s -b "$JAR" "$BASE/api/finance/reminders")
check "sollecito preparato per la fattura scaduta" "$(has "$R" 'da_approvare')"
check "livello 3 per un ritardo di 40 giorni" \
  "$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d['reminders'] if x['document_id']==$INV]
print('ok' if r and r[0]['level']==3 else 'ko')")"
check "il testo cita il numero della fattura" "$(has "$R" 'Sollecito formale')"

REMID=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=[x for x in d['reminders'] if x['document_id']==$INV]
print(r[0]['id'] if r else '')")

R=$(curl -s -b "$JAR" "$BASE/api/finance/reminders")
check "non ne crea un secondo uguale al giro dopo" \
  "$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('ok' if len([x for x in d['reminders'] if x['document_id']==$INV])==1 else 'ko')")"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/reminders/$REMID/invia")
check "invio del sollecito" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/reminders/$REMID/invia")
check "non si invia due volte" "$(has "$R" 'già inviato')"

echo ""
echo "Spese"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/expenses" -H 'Content-Type: application/json' \
  -d '{"description":"Abbonamento Adobe","amount":60,"category":"software"}')
check "creazione spesa" "$(has "$R" 'Adobe')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/finance/expenses" -H 'Content-Type: application/json' \
  -d '{"description":"Spesa a zero","amount":0}')
check "importo zero rifiutato" "$(has "$R" 'maggiore di zero')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/expenses")
check "totale spese calcolato" "$([ "$(jq_ "$R" "['total']")" = "60" ] && echo ok || echo ko)"
check "raggruppamento per categoria" "$(has "$R" 'software')"

echo ""
echo "Stima tasse"
curl -s -b "$JAR" -X PUT "$BASE/api/finance/tax/settings" -H 'Content-Type: application/json' \
  -d '{"tax_regime":"forfettario","tax_coefficient":78,"tax_rate":5,"inps_type":"gestione_separata"}' >/dev/null
R=$(curl -s -b "$JAR" "$BASE/api/finance/tax")
check "impostazioni fiscali salvate" "$(has "$R" 'gestione_separata')"
check "calcolo su 10.000 € di imponibile" \
  "$(python3 -c "
# 10000*0.78 = 7800 imponibile; INPS 26.07% = 2033.46; (7800-2033.46)*5% = 288.33
imponibile = 10000*0.78
inps = round(imponibile*0.2607, 2)
imposta = round((imponibile-inps)*0.05, 2)
print('ok' if abs(inps-2033.46)<0.02 and abs(imposta-288.33)<0.02 else 'ko')")"
check "coefficiente applicato" "$([ "$(jq_ "$R" "['onCollected']['coefficient']")" = "78" ] && echo ok || echo ko)"
check "la stima non supera mai l'incassato" \
  "$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('ok' if d['onCollected']['total'] <= d['collected'] or d['collected']==0 else 'ko')")"

echo ""
echo "Ricerca globale"
R=$(curl -s -b "$JAR" "$BASE/api/finance/search?q=bianchi")
check "trova i clienti per nome" "$(has "$R" 'cliente')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/search?q=adobe")
check "trova le spese" "$(has "$R" 'spesa')"
R=$(curl -s -b "$JAR" "$BASE/api/finance/search?q=a")
check "query troppo corta non restituisce nulla" "$(has "$R" '"results": *\[\]')"

echo ""
echo "Isolamento tra utenti"
curl -s -c "$JAR2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"altro$(date +%s)@example.com\",\"password\":\"passwordsicura\",\"name\":\"Altro\"}" >/dev/null
curl -s -b "$JAR2" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}' >/dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/finance/recurring")
check "un utente non vede gli abbonamenti di un altro" \
  "$(echo "$R" | grep -q 'Manutenzione mensile' && echo ko || echo ok)"
R=$(curl -s -b "$JAR2" "$BASE/api/finance/expenses")
check "un utente non vede le spese di un altro" \
  "$(echo "$R" | grep -q 'Adobe' && echo ko || echo ok)"
R=$(curl -s -b "$JAR2" -X POST "$BASE/api/finance/recurring/$RID/genera")
check "non può generare fatture dagli abbonamenti altrui" "$(has "$R" 'non trovato')"
R=$(curl -s -b "$JAR2" "$BASE/api/finance/search?q=adobe")
check "la ricerca non attraversa gli account" "$(has "$R" '"results": *\[\]')"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$OWN_SERVER" -eq 1 ] || rm -f "$JAR" "$JAR2"
[ "$FAIL" -eq 0 ]
