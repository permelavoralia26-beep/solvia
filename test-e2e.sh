#!/usr/bin/env bash
# Test end-to-end delle API di Solvia.
# Uso: ./test-e2e.sh [base_url]
set -euo pipefail

BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
PASS=0; FAIL=0

check() { # check <descrizione> <condizione booleana già valutata: "ok"/"ko">
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }

echo ""
echo "Test API Solvia su $BASE"
echo "────────────────────────────────────────"

echo "Autenticazione"
EMAIL="test$(date +%s)@example.com"
R=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"passwordsicura\",\"name\":\"Marco Rossi\",\"business_name\":\"Studio Rossi\"}")
check "registrazione nuovo account" "$(has "$R" 'Marco Rossi')"

R=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"passwordsicura\",\"name\":\"Doppione\"}")
check "email duplicata rifiutata" "$(has "$R" 'già')"

R=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"x@y.it","password":"corta","name":"X"}')
check "password troppo corta rifiutata" "$(has "$R" '8 caratteri')"

R=$(curl -s "$BASE/api/clients")
check "accesso senza sessione bloccato (401)" "$(has "$R" 'Non autenticato')"

R=$(curl -s -b "$JAR" "$BASE/api/auth/me")
check "sessione valida riconosciuta" "$(has "$R" "$EMAIL")"

echo ""
echo "Dati dimostrativi"
# I dati di esempio non arrivano più da soli: si chiedono nella schermata di
# benvenuto. Qui li carichiamo esplicitamente, come farebbe un utente nuovo.
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}')
check "i dati di esempio si caricano su richiesta" "$(has "$R" '"demo": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/clients")
check "3 clienti precaricati" "$([ "$(echo "$R" | grep -o '"id":' | wc -l)" -eq 3 ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" "$BASE/api/emails")
check "5 email precaricate" "$([ "$(echo "$R" | grep -o '"from_email"' | wc -l)" -eq 5 ] && echo ok || echo ko)"

echo ""
echo "Clienti"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/clients" -H 'Content-Type: application/json' \
  -d '{"name":"Nuova Azienda Srl","email":"info@nuova.it","vat_number":"IT11122233344"}')
CLIENT_ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
check "creazione cliente" "$(has "$R" 'Nuova Azienda')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/clients" -H 'Content-Type: application/json' -d '{"name":""}')
check "cliente senza nome rifiutato" "$(has "$R" 'obbligatorio')"

echo ""
echo "Preventivi e fatture"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"preventivo\",\"client_id\":$CLIENT_ID,\"vat_rate\":22,
       \"items\":[{\"description\":\"Sviluppo sito\",\"quantity\":1,\"unit_price\":1000},
                  {\"description\":\"Consulenza\",\"quantity\":2,\"unit_price\":250}]}")
QUOTE_ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
check "creazione preventivo" "$(has "$R" 'preventivo')"
check "imponibile calcolato = 1500" "$(has "$R" '"subtotal":1500')"
check "IVA 22% calcolata = 330" "$(has "$R" '"vat_amount":330')"
check "totale calcolato = 1830" "$(has "$R" '"total":1830')"
check "numerazione progressiva assegnata" "$(has "$R" '"number":"P-')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d "{\"kind\":\"fattura\",\"client_id\":$CLIENT_ID,\"vat_rate\":22,\"withholding\":20,
       \"items\":[{\"description\":\"Prestazione\",\"quantity\":1,\"unit_price\":1000}]}")
check "ritenuta d'acconto sottratta dal totale (1000+220-200=1020)" "$(has "$R" '"total":1020')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/$QUOTE_ID/convert")
INV_ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
check "conversione preventivo → fattura" "$(has "$R" '"kind":"fattura"')"
check "totali mantenuti nella conversione" "$(has "$R" '"total":1830')"

R=$(curl -s -b "$JAR" -X PATCH "$BASE/api/documents/$INV_ID/status" \
  -H 'Content-Type: application/json' -d '{"status":"pagata"}')
check "cambio stato a pagata" "$(has "$R" '"status":"pagata"')"
R=$(curl -s -b "$JAR" -X PATCH "$BASE/api/documents/$INV_ID/status" \
  -H 'Content-Type: application/json' -d '{"status":"inventato"}')
check "stato non valido rifiutato" "$(has "$R" 'non valido')"

echo ""
echo "Generazione PDF"
curl -s -b "$JAR" "$BASE/api/documents/$INV_ID/pdf" -o /tmp/solvia-test.pdf
check "PDF generato" "$(head -c 4 /tmp/solvia-test.pdf | grep -q '%PDF' && echo ok || echo ko)"
check "PDF di dimensione plausibile (>1KB)" "$([ "$(stat -c%s /tmp/solvia-test.pdf)" -gt 1000 ] && echo ok || echo ko)"

echo ""
echo "Assistente — triage email e bozze"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/emails/triage-all")
check "analisi in blocco delle email" "$(has "$R" '"processed":5')"
R=$(curl -s -b "$JAR" "$BASE/api/emails")
check "richiesta preventivo classificata" "$(has "$R" 'richiesta_preventivo')"
check "priorità alta assegnata a email urgente" "$(has "$R" '"priority":"alta"')"
check "bozza di risposta generata" "$(has "$R" 'draft_reply":"Gentile')"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/documents/draft" -H 'Content-Type: application/json' \
  -d '{"description":"restyling sito 8 pagine 3.200 €; ottimizzazione SEO 800 €"}')
check "voci preventivo estratte da testo libero" "$(has "$R" '3200')"
check "secondo importo estratto correttamente" "$(has "$R" '800')"

echo ""
echo "Attività"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Chiamare il commercialista","priority":"alta","due_date":"2026-12-01"}')
TASK_ID=$(echo "$R" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
check "creazione attività" "$(has "$R" 'commercialista')"
R=$(curl -s -b "$JAR" -X PATCH "$BASE/api/tasks/$TASK_ID" -H 'Content-Type: application/json' -d '{"done":true}')
check "completamento attività" "$(has "$R" '"done":1')"

echo ""
echo "Dashboard"
num() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)"; }

BEFORE=$(num "$(curl -s -b "$JAR" "$BASE/api/dashboard")" "['stats']['paidThisMonth']")
curl -s -b "$JAR" -X POST "$BASE/api/documents" -H 'Content-Type: application/json' \
  -d '{"kind":"fattura","vat_rate":0,"items":[{"description":"Extra","quantity":1,"unit_price":500}]}' \
  | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2 | {
    read EXTRA_ID
    curl -s -b "$JAR" -X PATCH "$BASE/api/documents/$EXTRA_ID/status" \
      -H 'Content-Type: application/json' -d '{"status":"pagata"}' > /dev/null
  }
R=$(curl -s -b "$JAR" "$BASE/api/dashboard")
AFTER=$(num "$R" "['stats']['paidThisMonth']")

check "statistiche calcolate" "$(has "$R" 'paidThisMonth')"
check "incasso del mese cresce esattamente dell'importo saldato (+500)" \
  "$(python3 -c "print('ok' if abs($AFTER-$BEFORE-500)<0.01 else 'ko')")"
check "andamento incassi su 6 mesi (anche quelli vuoti)" \
  "$(python3 -c "print('ok' if len($(num "$R" "['revenueByMonth']" | tr "'" '"'))==6 else 'ko')")"

echo ""
echo "Isolamento tra account"
JAR2=$(mktemp)
curl -s -c "$JAR2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"altro$(date +%s)@example.com\",\"password\":\"passwordsicura\",\"name\":\"Altro Utente\"}" > /dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/documents/$INV_ID")
check "un utente non può leggere i documenti di un altro" "$(has "$R" 'non trovato')"
R=$(curl -s -b "$JAR2" "$BASE/api/clients")
check "un utente non vede i clienti di un altro" "$(has "$R" 'Nuova Azienda' | grep -q ko && echo ok || echo ko)"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
rm -f "$JAR" "$JAR2"
[ "$FAIL" -eq 0 ]
