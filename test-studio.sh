#!/usr/bin/env bash
# Studio condiviso (piano Team): inviti, dati davvero comuni, permessi,
# separazione fra account e uscita dallo studio.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
jq_() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)" 2>/dev/null || echo ERR; }

PORT=4770
BASE="http://localhost:$PORT"
DIR=$(mktemp -d)
PORT=$PORT SOLVIA_DATA_DIR="$DIR" node "$(dirname "$0")/server.js" > "$DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$DIR"' EXIT

for _ in $(seq 1 60); do curl -sf "$BASE/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "$BASE/api/health" >/dev/null 2>&1; then
  echo "Il server di prova non è partito:"; cat "$DIR/server.log"; exit 1
fi

echo ""
echo "Test studio condiviso (piano Team)"
echo "────────────────────────────────────────"

TIT=$(mktemp); COL=$(mktemp)

# ─────────────────────────────────────── Il titolare
curl -s -c "$TIT" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"titolare@studio.it","password":"passwordsicura","name":"Marco Titolare","business_name":"Studio Marco"}' >/dev/null
curl -s -b "$TIT" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}' >/dev/null
curl -s -b "$TIT" -X POST "$BASE/api/onboarding/completa" >/dev/null

echo "Senza piano Team non si condivide niente"
R=$(curl -s -b "$TIT" "$BASE/api/studio")
check "un account normale è uno studio da una persona sola" \
  "$([ "$(jq_ "$R" "['posti']['totale']")" = "1" ] && echo ok || echo ko)"
check "e non risulta condivisibile" "$(has "$R" '"condivisibile": *false')"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$TIT" -X POST "$BASE/api/studio/inviti" \
  -H 'Content-Type: application/json' -d '{"email":"anna@studio.it"}')
check "l'invito risponde 402, non un errore generico" "$([ "$CODE" = "402" ] && echo ok || echo ko)"

echo ""
echo "Con il piano Team"
curl -s -b "$TIT" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"team"}' >/dev/null
R=$(curl -s -b "$TIT" "$BASE/api/studio")
check "i posti diventano cinque" "$([ "$(jq_ "$R" "['posti']['totale']")" = "5" ] && echo ok || echo ko)"

R=$(curl -s -b "$TIT" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' \
  -d '{"email":"non-una-email"}')
check "un indirizzo non valido viene rifiutato" "$(has "$R" 'email valido')"

R=$(curl -s -b "$TIT" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' \
  -d '{"email":"titolare@studio.it"}')
check "non si invita chi ha già un account" "$(has "$R" 'già un account')"

R=$(curl -s -b "$TIT" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' \
  -d '{"email":"anna@studio.it"}')
check "l'invito parte" "$([ "$(jq_ "$R" "['inviti'].__len__()")" = "1" ] && echo ok || echo ko)"
check "e occupa un posto" "$([ "$(jq_ "$R" "['posti']['liberi']")" = "3" ] && echo ok || echo ko)"

R=$(curl -s -b "$TIT" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' \
  -d '{"email":"anna@studio.it"}')
check "non si invita due volte lo stesso indirizzo" "$(has "$R" 'già un invito')"

EML=$(ls -t "$DIR/outbox" | head -1)
check "l'email di invito viene generata" "$([ -n "$EML" ] && echo ok || echo ko)"
TOKEN=$(grep -o 'token=[a-f0-9]\{64\}' "$DIR/outbox/$EML" | head -1 | cut -d= -f2)
check "contiene un link con un token lungo" "$([ ${#TOKEN} -eq 64 ] && echo ok || echo ko)"
check "nel database c'è solo l'impronta, non il token" \
  "$(grep -q "$TOKEN" "$DIR"/*.db 2>/dev/null && echo ko || echo ok)"

R=$(curl -s "$BASE/api/studio/invito?token=$TOKEN")
check "la pagina dell'invito dice chi invita e in quale studio" "$(has "$R" 'Studio Marco')"
R=$(curl -s "$BASE/api/studio/invito?token=inventato")
check "un token inventato non è valido" "$(has "$R" '"valido": *false')"

echo ""
echo "Accettazione"
R=$(curl -s -X POST "$BASE/api/studio/invito/accetta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"name\":\"Anna Collab\",\"password\":\"corta\"}")
check "la password deve essere lunga anche qui" "$(has "$R" '8 caratteri')"

R=$(curl -s -c "$COL" -X POST "$BASE/api/studio/invito/accetta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"name\":\"Anna Collab\",\"password\":\"passwordsicura\"}")
check "l'accettazione crea l'account ed entra" "$(has "$R" '"ok": *true')"

R=$(curl -s -X POST "$BASE/api/studio/invito/accetta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"name\":\"Furbo\",\"password\":\"passwordsicura\"}")
check "lo stesso invito non si riusa" "$(has "$R" 'non valido')"

R=$(curl -s -b "$COL" "$BASE/api/auth/me")
check "il collaboratore ha un account suo" "$(has "$R" 'anna@studio.it')"
check "con ruolo collaboratore" "$(has "$R" '"studio_role": *"collaboratore"')"
check "e non deve rifare la configurazione iniziale" "$(has "$R" '"onboarded": *true')"

echo ""
echo "I dati sono davvero gli stessi"
PRIMA=$(jq_ "$(curl -s -b "$TIT" "$BASE/api/documents")" "['documents'].__len__()")
DOC=$(curl -s -b "$COL" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d '{"kind":"fattura","notes":"Fattura scritta da Anna","items":[{"description":"Consulenza","quantity":1,"unit_price":500}]}')
ID=$(jq_ "$DOC" "['document']['id']")
DOPO=$(jq_ "$(curl -s -b "$TIT" "$BASE/api/documents")" "['documents'].__len__()")
check "la fattura del collaboratore compare al titolare" \
  "$([ "$DOPO" = "$((PRIMA+1))" ] && echo ok || echo ko)"
R=$(curl -s -b "$TIT" "$BASE/api/documents/$ID")
check "e il titolare può aprirla" "$(has "$R" 'Fattura scritta da Anna')"

R=$(curl -s -b "$COL" "$BASE/api/clients")
check "il collaboratore vede i clienti dello studio" "$(has "$R" 'Caffè Aurora')"
R=$(curl -s -b "$COL" "$BASE/api/dashboard")
check "e la dashboard è quella dello studio" \
  "$([ "$(jq_ "$R" "['stats']['outstanding']")" != "0" ] && echo ok || echo ko)"

R=$(curl -s -b "$TIT" "$BASE/api/studio/attivita")
check "il registro dice chi ha fatto cosa" "$(has "$R" '"actor_name": *"Anna Collab"')"
check "le azioni del titolare restano senza firma" "$(has "$R" '"actor_name": *null')"

echo ""
echo "Il collaboratore non è il titolare"
R=$(curl -s -b "$COL" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' \
  -d '{"email":"terzo@studio.it"}')
check "non può invitare altre persone" "$(has "$R" 'Solo il titolare')"
R=$(curl -s -b "$COL" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}')
check "non può toccare l'abbonamento" "$(has "$R" 'gestito dal titolare')"
R=$(curl -s -b "$COL" -X POST "$BASE/api/billing/demo-disdici")
check "né disdire quello dello studio" "$(has "$R" 'gestito dal titolare')"
R=$(curl -s -b "$COL" "$BASE/api/billing")
check "ma vede a che piano sta lavorando" "$(has "$R" '"planName": *"Team"')"
check "in sola lettura" "$(has "$R" '"readOnly": *true')"

MID=$(curl -s -b "$COL" "$BASE/api/studio" | python3 -c "
import sys,json
print([m['id'] for m in json.load(sys.stdin)['membri'] if m['studio_role'] == 'titolare'][0])")
R=$(curl -s -b "$COL" -X DELETE "$BASE/api/studio/membri/$MID")
check "non può rimuovere il titolare" "$(has "$R" 'Solo il titolare')"

echo ""
echo "Gli account restano separati"
curl -s -b "$COL" -c "$COL" -X POST "$BASE/api/auth/password" -H 'Content-Type: application/json' \
  -d '{"current":"passwordsicura","password":"soloditanna"}' >/dev/null
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"titolare@studio.it","password":"passwordsicura"}')
check "cambiando la sua password, quella del titolare non si tocca" "$(has "$R" 'titolare@studio.it')"
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"anna@studio.it","password":"soloditanna"}')
check "il collaboratore entra con la nuova sua" "$(has "$R" 'anna@studio.it')"

echo ""
echo "Uno studio non vede l'altro"
EST=$(mktemp)
curl -s -c "$EST" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"estraneo@altro.it","password":"passwordsicura","name":"Estraneo"}' >/dev/null
curl -s -b "$EST" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"vuoto"}' >/dev/null
R=$(curl -s -b "$EST" "$BASE/api/documents")
check "chi sta fuori non vede i documenti dello studio" \
  "$([ "$(jq_ "$R" "['documents'].__len__()")" = "0" ] && echo ok || echo ko)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$EST" "$BASE/api/documents/$ID")
check "e non può aprirne uno per id" "$([ "$CODE" = "404" ] && echo ok || echo ko)"

echo ""
echo "Uscita dallo studio"
CID=$(curl -s -b "$TIT" "$BASE/api/studio" | python3 -c "
import sys,json
print([m['id'] for m in json.load(sys.stdin)['membri'] if m['studio_role'] == 'collaboratore'][0])")
R=$(curl -s -b "$TIT" -X DELETE "$BASE/api/studio/membri/$CID")
check "il titolare rimuove il collaboratore" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$COL" "$BASE/api/clients")
check "la sessione del rimosso decade subito" "$(has "$R" 'Non autenticato')"

COL2=$(mktemp)
curl -s -c "$COL2" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"anna@studio.it","password":"soloditanna"}' >/dev/null
R=$(curl -s -b "$COL2" "$BASE/api/documents")
check "rientrando trova un account vuoto, non cancellato" \
  "$([ "$(jq_ "$R" "['documents'].__len__()")" = "0" ] && echo ok || echo ko)"
R=$(curl -s -b "$TIT" "$BASE/api/documents/$ID")
check "il lavoro che aveva fatto resta allo studio" "$(has "$R" 'Fattura scritta da Anna')"
R=$(curl -s -b "$TIT" "$BASE/api/studio")
check "il posto torna libero" "$([ "$(jq_ "$R" "['posti']['liberi']")" = "4" ] && echo ok || echo ko)"

echo ""
echo "Se il titolare cancella l'account"
T2=$(mktemp); C2=$(mktemp)
curl -s -c "$T2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"capo@due.it","password":"passwordsicura","name":"Capo Due"}' >/dev/null
curl -s -b "$T2" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' -d '{"modo":"vuoto"}' >/dev/null
curl -s -b "$T2" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' -d '{"plan":"team"}' >/dev/null
curl -s -b "$T2" -X POST "$BASE/api/studio/inviti" -H 'Content-Type: application/json' -d '{"email":"socio@due.it"}' >/dev/null
TOKEN2=$(grep -oh 'token=[a-f0-9]\{64\}' "$DIR/outbox/"* | tail -1 | cut -d= -f2)
curl -s -c "$C2" -X POST "$BASE/api/studio/invito/accetta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN2\",\"name\":\"Socio\",\"password\":\"passwordsicura\"}" >/dev/null
curl -s -b "$T2" -X POST "$BASE/api/gdpr/delete" -H 'Content-Type: application/json' \
  -d '{"password":"passwordsicura"}' >/dev/null

C3=$(mktemp)
R=$(curl -s -c "$C3" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"socio@due.it","password":"passwordsicura"}')
check "il collaboratore rimasto orfano riesce ancora ad accedere" "$(has "$R" 'socio@due.it')"
R=$(curl -s -b "$C3" "$BASE/api/studio")
check "e si ritrova titolare di uno studio suo" "$(has "$R" '"sonoTitolare": *true')"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
