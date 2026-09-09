#!/usr/bin/env bash
# Test di ore lavorate, portale cliente, firma, riepilogo annuale e app installabile.
# Uso: ./test-extra.sh [base_url]
set -uo pipefail

JAR=$(mktemp); JAR2=$(mktemp)
PASS=0; FAIL=0

OWN_SERVER=0
if [ $# -eq 0 ]; then
  OWN_SERVER=1
  PORT=5200
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
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

echo ""
echo "Test funzioni aggiuntive su $BASE"
echo "────────────────────────────────────────"

EMAIL="extra$(date +%s)@example.com"
curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"passwordsicura\",\"name\":\"Anna Extra\",\"business_name\":\"Studio Anna\"}" >/dev/null
curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}' >/dev/null   # i dati di esempio ora si chiedono
curl -s -b "$JAR" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}' >/dev/null
CID=$(curl -s -b "$JAR" "$BASE/api/clients" | python3 -c "import sys,json;print(json.load(sys.stdin)['clients'][0]['id'])")

echo "App installabile sul tablet"
check "manifest raggiungibile" "$([ "$(code "$BASE/manifest.json")" = "200" ] && echo ok || echo ko)"
R=$(curl -s "$BASE/manifest.json")
check "si apre a schermo intero" "$(has "$R" '"display": *"standalone"')"
check "punto di ingresso sull'app" "$(has "$R" '"start_url": *"/app"')"
check "icona 512 dichiarata" "$(has "$R" 'icon-512.png')"
check "icona ritagliabile per Android" "$(has "$R" 'maskable')"
check "scorciatoie rapide presenti" "$(has "$R" 'shortcuts')"
check "service worker servito" "$([ "$(code "$BASE/sw.js")" = "200" ] && echo ok || echo ko)"
R=$(curl -s "$BASE/sw.js")
check "il service worker NON mette in cache i dati" "$(has "$R" "pathname.startsWith('/api/')")"
check "pagina offline presente" "$([ "$(code "$BASE/offline.html")" = "200" ] && echo ok || echo ko)"
for i in 192 512; do
  check "icona ${i}px generata" "$([ "$(code "$BASE/icon-$i.png")" = "200" ] && echo ok || echo ko)"
done
R=$(curl -s "$BASE/app" -b "$JAR")
check "l'app dichiara il manifest" "$(has "$R" 'rel="manifest"')"

echo ""
echo "Ore lavorate — cronometro"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/start" -H 'Content-Type: application/json' \
  -d "{\"description\":\"Revisione grafica\",\"client_id\":$CID,\"hourly_rate\":50}")
check "cronometro avviato" "$(has "$R" '"running": *true')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/start" -H 'Content-Type: application/json' -d '{}')
check "non se ne avviano due insieme" "$(has "$R" 'già un cronometro')"
R=$(curl -s -b "$JAR" "$BASE/api/time")
check "il cronometro in corso è visibile" "$(has "$R" 'Revisione grafica')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/stop")
check "fermando si registra almeno un minuto" \
  "$([ "$(jq_ "$R" "['entry']['minutes']")" -ge 1 ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/stop")
check "senza cronometro in corso risponde chiaramente" "$(has "$R" 'Nessun cronometro')"

echo ""
echo "Ore lavorate — inserimento e fatturazione"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time" -H 'Content-Type: application/json' \
  -d "{\"description\":\"Consulenza strategica\",\"client_id\":$CID,\"hours\":3,\"minutes\":30,\"hourly_rate\":60}")
check "ore inserite a mano" "$(has "$R" 'Consulenza strategica')"
check "3h30 salvate come 210 minuti" "$([ "$(jq_ "$R" "['entry']['minutes']")" = "210" ] && echo ok || echo ko)"
check "importo calcolato (3,5 × 60 = 210 €)" \
  "$(echo "$R" | python3 -c "
import sys,json
print('ok' if abs(json.load(sys.stdin)['entry']['amount'] - 210) < 0.01 else 'ko')")"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/time" -H 'Content-Type: application/json' \
  -d '{"description":"Vuoto","hours":0,"minutes":0}')
check "tempo a zero rifiutato" "$(has "$R" 'maggiore di zero')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/time" -H 'Content-Type: application/json' \
  -d "{\"description\":\"Consulenza strategica\",\"client_id\":$CID,\"hours\":1,\"minutes\":30,\"hourly_rate\":60}")
R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/fattura" -H 'Content-Type: application/json' -d "{\"client_id\":$CID}")
check "ore trasformate in fattura" "$(has "$R" '"ok": *true')"
NUM=$(jq_ "$R" "['number']")
check "voci uguali raggruppate in una riga" "$([ "$(jq_ "$R" "['items']")" -le 2 ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/time/fattura" -H 'Content-Type: application/json' -d "{\"client_id\":$CID}")
check "le stesse ore non si fatturano due volte" "$(has "$R" 'Nessuna ora da fatturare')"

R=$(curl -s -b "$JAR" "$BASE/api/time")
check "le ore fatturate risultano marcate" "$(has "$R" 'billed_on')"

echo ""
echo "Portale cliente"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/clients/$CID/portale")
PT=$(jq_ "$R" "['token']")
check "link del portale generato" "$([ ${#PT} -eq 64 ] && echo ok || echo ko)"

R=$(curl -s "$BASE/api/pubblico/cliente/$PT")
check "il cliente vede i suoi documenti senza login" "$(has "$R" 'documenti')"
check "vede il riepilogo degli importi" "$(has "$R" 'totaleFatturato')"
check "NON vede le bozze" \
  "$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('ko' if any(x['stato']=='bozza' for x in d['documenti']) else 'ok')")"
check "NON espone identificativi interni" "$(echo "$R" | grep -q '"user_id"' && echo ko || echo ok)"

R=$(curl -s "$BASE/api/pubblico/cliente/token-falso")
check "token falso rifiutato" "$(has "$R" 'non trovato')"

curl -s -b "$JAR" -X DELETE "$BASE/api/clients/$CID/portale" >/dev/null
R=$(curl -s "$BASE/api/pubblico/cliente/$PT")
check "revocando il portale il link muore" "$(has "$R" 'non trovato')"

echo ""
echo "Firma sul preventivo"
QID=$(curl -s -b "$JAR" "$BASE/api/documents?kind=preventivo" | python3 -c "import sys,json;print(json.load(sys.stdin)['documents'][0]['id'])")
TOKEN=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$QID/condividi" | jq_ "$(echo)" 2>/dev/null || true)
TOKEN=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$QID/condividi" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# PNG 1x1 valido, usato come firma di prova
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
R=$(curl -s -X POST "$BASE/api/pubblico/preventivo/$TOKEN/decisione" \
  -H 'Content-Type: application/json' \
  -d "{\"accetta\":true,\"firmatario\":\"Mario Bianchi\",\"firma\":\"$PNG\"}")
check "accettazione con firma registrata" "$(has "$R" '"stato": *"accettata"')"

R=$(curl -s "$BASE/api/pubblico/preventivo/$TOKEN")
check "la firma viene restituita" "$(has "$R" 'data:image/png;base64')"
check "il nome del firmatario è salvato" "$(has "$R" 'Mario Bianchi')"

# Un preventivo nuovo per provare i casi limite
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d '{"kind":"preventivo","items":[{"description":"Prova","quantity":1,"unit_price":100}]}')
Q2=$(jq_ "$R" "['document']['id']")
T2=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$Q2/condividi" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
R=$(curl -s -X POST "$BASE/api/pubblico/preventivo/$T2/decisione" \
  -H 'Content-Type: application/json' \
  -d '{"accetta":true,"firma":"<script>alert(1)</script>"}')
check "una firma non valida viene scartata" "$(has "$R" '"stato": *"accettata"')"
R=$(curl -s "$BASE/api/pubblico/preventivo/$T2")
check "il contenuto non valido NON viene conservato" \
  "$(echo "$R" | python3 -c "
import sys,json
print('ok' if json.load(sys.stdin).get('firma') is None else 'ko')")"

echo ""
echo "Riepilogo annuale"
curl -s -b "$JAR" "$BASE/api/finance/riepilogo/2026" -o /tmp/solvia-riep.pdf
check "PDF generato" "$(head -c 4 /tmp/solvia-riep.pdf | grep -q '%PDF' && echo ok || echo ko)"
check "dimensione plausibile" "$([ "$(stat -c%s /tmp/solvia-riep.pdf)" -gt 2000 ] && echo ok || echo ko)"
if command -v pdftotext >/dev/null 2>&1; then
  pdftotext /tmp/solvia-riep.pdf /tmp/solvia-riep.txt 2>/dev/null
  check "contiene l'avvertenza sulla stima" \
    "$(grep -q 'non una dichiarazione fiscale' /tmp/solvia-riep.txt && echo ok || echo ko)"
  check "riporta il nome dell'attività" \
    "$(grep -q 'Studio Anna' /tmp/solvia-riep.txt && echo ok || echo ko)"
fi
check "anno inventato non manda in errore" \
  "$([ "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/finance/riepilogo/pippo")" = "200" ] && echo ok || echo ko)"
check "riepilogo non scaricabile senza sessione" \
  "$(has "$(curl -s "$BASE/api/finance/riepilogo/2026")" 'Non autenticato')"

echo ""
echo "Isolamento tra utenti"
curl -s -c "$JAR2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"altro$(date +%s)@example.com\",\"password\":\"passwordsicura\",\"name\":\"Altro\"}" >/dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/time")
check "un utente non vede le ore di un altro" \
  "$(echo "$R" | grep -q 'Consulenza strategica' && echo ko || echo ok)"
R=$(curl -s -b "$JAR2" -X POST "$BASE/api/clients/$CID/portale")
check "non può creare portali sui clienti altrui" "$(has "$R" 'non trovato')"
R=$(curl -s -b "$JAR2" "$BASE/api/finance/riepilogo/2026" -o /tmp/altro.pdf -w '%{http_code}')
check "il riepilogo di un altro utente non contiene i suoi dati" \
  "$(pdftotext /tmp/altro.pdf - 2>/dev/null | grep -q 'Studio Anna' && echo ko || echo ok)"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$OWN_SERVER" -eq 1 ] || rm -f "$JAR" "$JAR2"
[ "$FAIL" -eq 0 ]
