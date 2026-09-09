#!/usr/bin/env bash
# Statistiche del sito e quadro di direzione: raccolta eventi, rispetto del
# rifiuto di tracciamento, imbuto, conto economico, riservatezza.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
jq_() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)" 2>/dev/null || echo ERR; }

PORT=4780
BASE="http://localhost:$PORT"
DIR=$(mktemp -d)
PORT=$PORT SOLVIA_DATA_DIR="$DIR" SOLVIA_SECRET=segreto-di-prova \
  node "$(dirname "$0")/server.js" > "$DIR/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$DIR"' EXIT

for _ in $(seq 1 60); do curl -sf "$BASE/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -sf "$BASE/api/health" >/dev/null 2>&1; then
  echo "Il server di prova non è partito:"; cat "$DIR/server.log"; exit 1
fi

evento() { # evento <json> [header...]
  local corpo=$1; shift
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/eventi" \
    -H 'Content-Type: application/json' "$@" -d "$corpo"
}

echo ""
echo "Test statistiche e quadro di direzione"
echo "────────────────────────────────────────"

echo "Raccolta degli eventi"
CODE=$(evento '{"name":"visita","path":"/","referrer":"https://www.google.com/search?q=fatture"}' -H 'User-Agent: uno')
check "la raccolta risponde 204 e non intralcia la pagina" "$([ "$CODE" = "204" ] && echo ok || echo ko)"
CODE=$(evento '{"name":"evento_inventato","label":"spam"}')
check "un evento non previsto risponde comunque 204" "$([ "$CODE" = "204" ] && echo ok || echo ko)"

evento '{"name":"visita","path":"/","referrer":"https://www.google.com/search?q=fatture"}' -H 'User-Agent: due' >/dev/null
evento '{"name":"visita","path":"/prezzi"}' -H 'User-Agent: uno' >/dev/null
evento '{"name":"prezzi_visti","path":"/"}' -H 'User-Agent: uno' >/dev/null
evento '{"name":"prezzi_visti","path":"/"}' -H 'User-Agent: due' >/dev/null
evento '{"name":"clic","path":"/","label":"inizia-piano-pro"}' -H 'User-Agent: uno' >/dev/null
evento '{"name":"faq_aperta","label":"Perché 19 euro?"}' -H 'User-Agent: uno' >/dev/null

echo ""
echo "Chi rifiuta il tracciamento non viene contato"
evento '{"name":"visita","path":"/dnt"}' -H 'DNT: 1' -H 'User-Agent: tre' >/dev/null
evento '{"name":"visita","path":"/gpc"}' -H 'Sec-GPC: 1' -H 'User-Agent: quattro' >/dev/null

ADMIN=$(mktemp)
curl -s -c "$ADMIN" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"capo@solvia.it","password":"passwordsicura","name":"Capo"}' >/dev/null
R=$(curl -s -b "$ADMIN" "$BASE/console/dati?periodo=settimana")

check "chi manda Do Not Track non compare" \
  "$(echo "$R" | grep -q '"/dnt"' && echo ko || echo ok)"
check "chi manda Global Privacy Control non compare" \
  "$(echo "$R" | grep -q '"/gpc"' && echo ko || echo ok)"
check "l'evento inventato è stato scartato" \
  "$(echo "$R" | grep -q 'evento_inventato' && echo ko || echo ok)"

echo ""
echo "I numeri tornano"
check "tre visite contate" "$([ "$(jq_ "$R" "['traffico']['visite']")" = "3" ] && echo ok || echo ko)"
check "due persone diverse" "$([ "$(jq_ "$R" "['traffico']['visitatori']")" = "2" ] && echo ok || echo ko)"
check "la provenienza è il dominio, non l'indirizzo completo" "$(has "$R" '"google.com"')"
check "la ricerca digitata non viene conservata" \
  "$(echo "$R" | grep -q 'q=fatture' && echo ko || echo ok)"
check "il clic è registrato con la sua etichetta" "$(has "$R" 'inizia-piano-pro')"
check "la FAQ aperta è registrata" "$(has "$R" 'Perché 19 euro')"
check "le pagine sono elencate" "$(has "$R" '"/prezzi"')"

echo ""
echo "L'imbuto"
check "sei passi, dal sito al pagamento" \
  "$([ "$(jq_ "$R" "['imbuto'].__len__()")" = "6" ] && echo ok || echo ko)"
check "il primo passo conta le persone, non le visite" \
  "$([ "$(jq_ "$R" "['imbuto'][0]['n']")" = "2" ] && echo ok || echo ko)"
check "chi ha visto i prezzi è contato" \
  "$([ "$(jq_ "$R" "['imbuto'][1]['n']")" = "2" ] && echo ok || echo ko)"
check "chi ha premuto Inizia è contato" \
  "$([ "$(jq_ "$R" "['imbuto'][2]['n']")" = "1" ] && echo ok || echo ko)"
check "la registrazione risulta dall'anagrafica" \
  "$([ "$(jq_ "$R" "['imbuto'][3]['n']")" = "1" ] && echo ok || echo ko)"
# La percentuale sul passo precedente esiste quando quel passo ha almeno una
# persona: se è a zero, un rapporto non vorrebbe dire niente e resta vuoto.
check "ogni passo dice la percentuale sul precedente, quando ha senso" \
  "$(echo "$R" | python3 -c "
import sys,json
p = json.load(sys.stdin)['imbuto']
ok = all((x['suPrecedente'] is not None) == (p[i]['n'] > 0)
         for i, x in enumerate(p[1:]))
print('ok' if ok else 'ko')")"

echo ""
echo "Il conto economico"
curl -s -b "$ADMIN" -X POST "$BASE/api/billing/demo-attiva" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}' >/dev/null
R=$(curl -s -b "$ADMIN" "$BASE/console/dati")
check "l'attivazione del piano viene registrata" \
  "$([ "$(jq_ "$R" "['economia']['attivazioni']")" = "1" ] && echo ok || echo ko)"
check "l'incasso mensile è 19 €, preso dal listino" \
  "$([ "$(jq_ "$R" "['economia']['mrr']")" = "19" ] && echo ok || echo ko)"
check "l'annuo è dodici volte il mensile" \
  "$([ "$(jq_ "$R" "['economia']['arr']")" = "228" ] && echo ok || echo ko)"
check "chi paga compare per nome" "$(has "$R" 'capo@solvia.it')"
check "l'imbuto vede il pagamento" \
  "$([ "$(jq_ "$R" "['imbuto'][5]['n']")" = "1" ] && echo ok || echo ko)"

curl -s -b "$ADMIN" -X POST "$BASE/api/billing/demo-disdici" >/dev/null
R=$(curl -s -b "$ADMIN" "$BASE/console/dati")
check "la disdetta viene registrata" \
  "$([ "$(jq_ "$R" "['economia']['disdette']")" = "1" ] && echo ok || echo ko)"
check "e l'incasso mensile torna a zero" \
  "$([ "$(jq_ "$R" "['economia']['mrr']")" = "0" ] && echo ok || echo ko)"

echo ""
echo "Privacy"
check "nessun indirizzo IP finisce nel database" \
  "$(grep -aq '127.0.0.1' "$DIR"/*.db 2>/dev/null && echo ko || echo ok)"
check "l'impronta del visitatore non è l'IP in chiaro" \
  "$(echo "$R" | grep -qE '"visitor": *"[0-9]{1,3}\.' && echo ko || echo ok)"
# La stessa persona di ieri deve risultare diversa: il sale cambia ogni giorno.
IERI=$(python3 -c "
import hashlib, datetime
ieri = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
print(hashlib.sha256(f'segreto-di-prova|{ieri}|127.0.0.1|uno'.encode()).hexdigest()[:16])")
check "l'impronta di ieri non compare oggi" \
  "$(grep -aq "$IERI" "$DIR"/*.db 2>/dev/null && echo ko || echo ok)"

echo ""
echo "La console è una piattaforma a parte, nascosta ai clienti"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/console/dati")
check "senza sessione i dati non escono (404)" "$([ "$CODE" = "404" ] && echo ok || echo ko)"

NORM=$(mktemp)
curl -s -c "$NORM" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"utente@qualsiasi.it","password":"passwordsicura","name":"Utente"}' >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$NORM" "$BASE/console/dati")
check "un cliente normale riceve 404, non 403" "$([ "$CODE" = "404" ] && echo ok || echo ko)"

# Un 403 direbbe comunque "qui c'è qualcosa": la risposta dev'essere identica,
# byte per byte, a quella di un indirizzo che non esiste.
IMPR1=$(curl -s -b "$NORM" "$BASE/console/dati" | md5sum | cut -d' ' -f1)
IMPR2=$(curl -s -b "$NORM" "$BASE/pagina-che-non-esiste" | md5sum | cut -d' ' -f1)
check "e la risposta è identica a quella di un indirizzo inventato" \
  "$([ "$IMPR1" = "$IMPR2" ] && echo ok || echo ko)"

R=$(curl -s -b "$NORM" "$BASE/console/dati")
check "il cliente non legge gli indirizzi di chi paga" \
  "$(echo "$R" | grep -q 'capo@solvia.it' && echo ko || echo ok)"

R=$(curl -s -b "$NORM" "$BASE/console/stato")
check "lo stato dice al cliente che non è autorizzato" "$(has "$R" '"autorizzato": *false')"
R=$(curl -s -b "$ADMIN" "$BASE/console/stato")
check "e all'amministratore che lo è" "$(has "$R" '"autorizzato": *true')"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/console.html")
check "la pagina non è raggiungibile fra i file statici" \
  "$([ "$CODE" = "404" ] && echo ok || echo ko)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/direzione")
check "il vecchio indirizzo dentro l'app non esiste più" \
  "$([ "$CODE" = "404" ] && echo ok || echo ko)"

R=$(curl -s "$BASE/console")
check "chi apre la console senza diritti vede solo un accesso spoglio" \
  "$(has "$R" 'Accesso riservato')"
check "e nel codice della pagina non trova il nome del prodotto" \
  "$(echo "$R" | grep -q 'Solvia' && echo ko || echo ok)"

echo ""
echo "L'indirizzo della console si sposta"
DIR2=$(mktemp -d)
SOLVIA_CONSOLE_PATH=stanza-segreta PORT=4781 SOLVIA_DATA_DIR="$DIR2" \
  node "$(dirname "$0")/server.js" > "$DIR2/s.log" 2>&1 &
PID2=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:4781/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:4781/stanza-segreta")
check "risponde sul nuovo indirizzo" "$([ "$CODE" = "200" ] && echo ok || echo ko)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:4781/console")
check "e non più su quello predefinito" "$([ "$CODE" = "404" ] && echo ok || echo ko)"
kill $PID2 2>/dev/null; rm -rf "$DIR2"

echo ""
echo "Periodi"
for P in oggi settimana mese trimestre; do
  R=$(curl -s -b "$ADMIN" "$BASE/console/dati?periodo=$P")
  check "il periodo '$P' risponde" "$(has "$R" "\"periodo\": *\"$P\"")"
done
R=$(curl -s -b "$ADMIN" "$BASE/console/dati?periodo=inventato")
check "un periodo inventato ricade sulla settimana" "$(has "$R" '"giorni": *7')"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
