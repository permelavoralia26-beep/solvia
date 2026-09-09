#!/usr/bin/env bash
# Test di newsletter (doppia conferma, disiscrizione) e diritti GDPR.
# Uso: ./test-newsletter.sh [base_url]
set -uo pipefail

JAR=$(mktemp); JAR2=$(mktemp)
PASS=0; FAIL=0

# L'amministratore è il primo account registrato: su un database condiviso con
# altre suite questo test creerebbe un utente non amministratore e fallirebbe per
# un motivo che non c'entra col codice. Quindi, se non viene passato un indirizzo,
# avvia un server tutto suo con un database vuoto.
ADMIN="admin$(date +%s)@example.com"
OWN_SERVER=0

if [ $# -eq 0 ]; then
  OWN_SERVER=1
  PORT=4700
  BASE="http://localhost:$PORT"
  TMPDATA=$(mktemp -d)

  PORT=$PORT SOLVIA_DATA_DIR="$TMPDATA" SOLVIA_ADMIN_EMAIL="$ADMIN" \
    node "$(dirname "$0")/server.js" > "$TMPDATA/server.log" 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$TMPDATA" "$JAR" "$JAR2"' EXIT

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
echo "Test newsletter e GDPR su $BASE"
echo "────────────────────────────────────────"

R=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN\",\"password\":\"passwordsicura\",\"name\":\"Titolare Progetto\"}")

echo "Iscrizione"
SUB="lettore$(date +%s)@example.com"
R=$(curl -s -X POST "$BASE/api/newsletter/subscribe" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SUB\",\"name\":\"Anna\",\"consent\":true}")
check "iscrizione accettata" "$(has "$R" '"ok": *true')"
check "chiede di confermare via email" "$(has "$R" 'confermare')"

R=$(curl -s -X POST "$BASE/api/newsletter/subscribe" -H 'Content-Type: application/json' \
  -d '{"email":"non-una-email","consent":true}')
check "email non valida rifiutata" "$(has "$R" 'valido')"

R=$(curl -s -X POST "$BASE/api/newsletter/subscribe" -H 'Content-Type: application/json' \
  -d '{"email":"senza@consenso.it","consent":false}')
check "iscrizione senza consenso rifiutata" "$(has "$R" 'informativa')"

echo ""
echo "Doppia conferma"
R=$(curl -s -b "$JAR" "$BASE/api/newsletter/admin/overview")
STATUS=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=[x for x in d['subscribers'] if x['email']=='$SUB']
print(s[0]['status'] if s else 'MANCANTE')")
check "iscritto registrato come 'in_attesa'" "$([ "$STATUS" = "in_attesa" ] && echo ok || echo ko)"
check "non conta tra i confermati" "$([ "$(jq_ "$R" "['stats']['confirmed']")" = "0" ] && echo ok || echo ko)"

# Recupera il token di conferma dall'email registrata nell'outbox
TOKEN=$(echo "$R" | python3 -c "
import sys,json,re
d=json.load(sys.stdin)
for m in d.get('outbox',[]):
    if '$SUB' in m['to']:
        g=re.search(r'conferma\?t=([a-f0-9]+)', m['body'])
        if g: print(g.group(1)); break
else: print('')")
check "email di conferma generata con link valido" "$([ -n "$TOKEN" ] && echo ok || echo ko)"

R=$(curl -s "$BASE/api/newsletter/confirm?t=token-inventato")
check "token di conferma falso rifiutato" "$(has "$R" 'non valido')"

R=$(curl -s "$BASE/api/newsletter/confirm?t=$TOKEN")
check "conferma con token valido riuscita" "$(has "$R" '"ok": *true')"
UNSUB=$(jq_ "$R" "['unsubscribeToken']")

R=$(curl -s "$BASE/api/newsletter/confirm?t=$TOKEN")
check "lo stesso link non è riutilizzabile" "$(has "$R" 'non valido')"

R=$(curl -s -b "$JAR" "$BASE/api/newsletter/admin/overview")
check "ora risulta tra i confermati" "$([ "$(jq_ "$R" "['stats']['confirmed']")" = "1" ] && echo ok || echo ko)"

echo ""
echo "Invio di una campagna"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns" -H 'Content-Type: application/json' \
  -d '{"subject":"Prima newsletter","body":"Ciao, ecco le novità del mese."}')
CID=$(jq_ "$R" "['campaign']['id']")
check "creazione campagna" "$(has "$R" 'Prima newsletter')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns" -H 'Content-Type: application/json' \
  -d '{"subject":"","body":"x"}')
check "campagna senza oggetto rifiutata" "$(has "$R" 'oggetto')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns/$CID/send" \
  -H 'Content-Type: application/json' -d '{}')
check "invio a 1 iscritto confermato" "$([ "$(jq_ "$R" "['sent']")" = "1" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns/$CID/send" \
  -H 'Content-Type: application/json' -d '{}')
check "una campagna non si invia due volte" "$(has "$R" 'già inviata')"

R=$(curl -s -b "$JAR" "$BASE/api/newsletter/admin/overview")
check "l'email inviata contiene il link di disiscrizione" "$(has "$R" 'disiscriviti?t=')"
check "l'email spiega perché la si riceve" "$(has "$R" 'Ricevi questa email perch')"

echo ""
echo "Disiscrizione"
R=$(curl -s -X POST "$BASE/api/newsletter/unsubscribe" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$UNSUB\"}")
check "disiscrizione con un clic, senza login" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/newsletter/admin/overview")
check "non è più tra i confermati" "$([ "$(jq_ "$R" "['stats']['confirmed']")" = "0" ] && echo ok || echo ko)"
check "resta nell'elenco esclusioni" "$([ "$(jq_ "$R" "['stats']['unsubscribed']")" = "1" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns" -H 'Content-Type: application/json' \
  -d '{"subject":"Seconda","body":"Testo"}')
CID2=$(jq_ "$R" "['campaign']['id']")
R=$(curl -s -b "$JAR" -X POST "$BASE/api/newsletter/admin/campaigns/$CID2/send" \
  -H 'Content-Type: application/json' -d '{}')
check "chi si è disiscritto non riceve più nulla" "$(has "$R" 'Nessun iscritto confermato')"

R=$(curl -s -X POST "$BASE/api/newsletter/erase" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$UNSUB\"}")
check "cancellazione totale dell'indirizzo (art. 17)" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/newsletter/admin/overview")
check "l'indirizzo è sparito dagli archivi" "$([ "$(jq_ "$R" "['stats']['total']")" = "0" ] && echo ok || echo ko)"

echo ""
echo "Permessi del pannello"
R=$(curl -s "$BASE/api/newsletter/admin/overview")
check "pannello non accessibile senza sessione" "$(has "$R" 'Non autenticato')"
curl -s -c "$JAR2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"normale$(date +%s)@example.com\",\"password\":\"passwordsicura\",\"name\":\"Utente Normale\"}" > /dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/newsletter/admin/overview")
check "un utente normale non vede gli iscritti" "$(has "$R" 'riservata')"
R=$(curl -s -b "$JAR2" -X POST "$BASE/api/newsletter/admin/campaigns" \
  -H 'Content-Type: application/json' -d '{"subject":"Abuso","body":"x"}')
check "un utente normale non può creare campagne" "$(has "$R" 'riservata')"

echo ""
echo "Diritti GDPR nell'app"
curl -s -b "$JAR2" -X POST "$BASE/api/clients" -H 'Content-Type: application/json' \
  -d '{"name":"Cliente Da Esportare","email":"c@esempio.it"}' > /dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/gdpr/export")
check "esportazione dati riuscita" "$(has "$R" 'base_normativa')"
check "include i clienti inseriti" "$(has "$R" 'Cliente Da Esportare')"
check "include i documenti" "$(has "$R" '"documenti"')"
check "NON include l'impronta della password" \
  "$(echo "$R" | grep -q 'password_hash' && echo ko || echo ok)"
R=$(curl -s "$BASE/api/gdpr/export")
check "esportazione bloccata senza sessione" "$(has "$R" 'Non autenticato')"

R=$(curl -s -b "$JAR2" -X POST "$BASE/api/gdpr/delete" -H 'Content-Type: application/json' \
  -d '{"password":"sbagliata"}')
check "cancellazione rifiutata con password errata" "$(has "$R" 'non corretta')"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" -X POST "$BASE/api/gdpr/delete" \
  -H 'Content-Type: application/json' -d '{"password":"sbagliata"}')
check "risponde 403 e non 401 (non disconnette per un errore di battitura)" \
  "$([ "$CODE" = "403" ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR2" "$BASE/api/clients")
check "l'account sopravvive al tentativo fallito" "$(has "$R" 'Cliente Da Esportare')"

R=$(curl -s -b "$JAR2" -X POST "$BASE/api/gdpr/delete" -H 'Content-Type: application/json' \
  -d '{"password":"passwordsicura"}')
check "cancellazione riuscita con password corretta" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$JAR2" "$BASE/api/auth/me")
check "la sessione non è più valida" "$(has "$R" 'Non autenticato')"

echo ""
echo "Interruttore SOLVIA_COMMERCIAL=false"
# La parte commerciale è accesa di default. Questo blocco verifica il kill-switch:
# avvia un server tutto suo con l'interruttore spento e controlla che sparisca
# davvero tutto — prezzi, checkout e limiti d'uso — non solo dall'interfaccia.
SPENTO_DIR=$(mktemp -d); SPENTO_JAR=$(mktemp)
SOLVIA_COMMERCIAL=false PORT=4701 SOLVIA_DATA_DIR="$SPENTO_DIR" \
  node "$(dirname "$0")/server.js" > "$SPENTO_DIR/server.log" 2>&1 &
SPENTO_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:4701/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
SPENTO="http://localhost:4701"
curl -s -c "$SPENTO_JAR" -X POST "$SPENTO/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"spento@example.com","password":"passwordsicura","name":"Spento"}' >/dev/null

R=$(curl -s "$SPENTO/api/health")
check "pagamenti disattivati" "$(has "$R" '"billingMode": *"disattivato"')"
R=$(curl -s -b "$SPENTO_JAR" "$SPENTO/api/billing")
check "nessun piano a pagamento esposto" "$([ "$(jq_ "$R" "['plans'].__len__()")" = "0" ] && echo ok || echo ko)"
R=$(curl -s -b "$SPENTO_JAR" -X POST "$SPENTO/api/billing/checkout" -H 'Content-Type: application/json' \
  -d '{"plan":"pro"}')
check "il checkout è disabilitato" "$(has "$R" 'progetto gratuito')"
for i in 1 2 3 4 5 6 7; do
  R=$(curl -s -b "$SPENTO_JAR" -X POST "$SPENTO/api/documents" -H 'Content-Type: application/json' \
    -d '{"kind":"preventivo","items":[{"description":"V","quantity":1,"unit_price":10}]}')
done
check "nessun limite d'uso applicato" "$(echo "$R" | grep -q '"upgrade"' && echo ko || echo ok)"
kill $SPENTO_PID 2>/dev/null; rm -rf "$SPENTO_DIR" "$SPENTO_JAR"

echo ""
echo "Parte commerciale accesa (predefinito)"
R=$(curl -s "$BASE/api/health")
check "i pagamenti sono attivi" "$(echo "$R" | grep -qE '"billingMode": *"(demo|stripe)"' && echo ok || echo ko)"
R=$(curl -s -b "$JAR" "$BASE/api/billing")
check "il listino espone i piani" "$([ "$(jq_ "$R" "['plans'].__len__()")" -gt 0 ] 2>/dev/null && echo ok || echo ko)"

echo ""
echo "Pagine legali"
for page in privacy cookie termini; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$page.html")
  check "/$page.html raggiungibile" "$([ "$CODE" = "200" ] && echo ok || echo ko)"
done
R=$(curl -s "$BASE/")
check "la home rimanda alle pagine legali" "$(has "$R" 'privacy.html')"
check "la home mostra il piano Pro a 19 €" "$(has "$R" '€19')"
check "la home mostra anche il piano gratuito" "$(has "$R" '€0')"
check "la home ha il modulo newsletter" "$(has "$R" 'news-form')"
check "il consenso newsletter non è preselezionato" \
  "$(echo "$R" | grep -q 'id="n-consent" checked' && echo ko || echo ok)"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$OWN_SERVER" -eq 1 ] || rm -f "$JAR" "$JAR2"
[ "$FAIL" -eq 0 ]
