#!/usr/bin/env bash
# Test del primo accesso e della sicurezza dell'account:
# schermata di benvenuto, dati di esempio a scelta, cambio password,
# recupero via email, sessioni che decadono, limite ai tentativi.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }
jq_() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)$2)" 2>/dev/null || echo ERR; }

PORT=4750
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
echo "Test primo accesso e sicurezza account"
echo "────────────────────────────────────────"

# ─────────────────────────────────────────── Primo accesso
echo "Registrazione e schermata di benvenuto"
JAR=$(mktemp)
R=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"nuovo@test.it","password":"passwordsicura","name":"Nuovo Utente"}')
check "il nuovo account non risulta configurato" "$(has "$R" '"onboarded": *false')"
check "non ha dati di esempio" "$(has "$R" '"demo_data": *false')"

R=$(curl -s -b "$JAR" "$BASE/api/clients")
check "l'account nasce davvero vuoto" "$([ "$(jq_ "$R" "['clients'].__len__()")" = "0" ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" "$BASE/api/emails")
check "nessuna email precaricata senza averlo chiesto" \
  "$([ "$(jq_ "$R" "['emails'].__len__()")" = "0" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" "$BASE/api/onboarding")
check "i passi da fare sono cinque" "$([ "$(jq_ "$R" "['passi'].__len__()")" = "5" ] && echo ok || echo ko)"
check "nessun passo è già fatto per finta" "$([ "$(jq_ "$R" "['mancanti']")" = "5" ] && echo ok || echo ko)"

echo ""
echo "Scelta dei dati iniziali"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}')
check "i dati di esempio si caricano su richiesta" "$(has "$R" '"demo": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/clients")
check "arrivano i tre clienti di esempio" "$([ "$(jq_ "$R" "['clients'].__len__()")" = "3" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"esempi"}')
check "un secondo caricamento non duplica nulla" "$(has "$R" 'già')"
R=$(curl -s -b "$JAR" "$BASE/api/clients")
check "i clienti restano tre" "$([ "$(jq_ "$R" "['clients'].__len__()")" = "3" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"qualcosaltro"}')
check "una scelta inventata viene rifiutata" "$(has "$R" 'non valida')"

echo ""
echo "Il regime fiscale conta solo se scelto davvero"
R=$(curl -s -b "$JAR" "$BASE/api/onboarding")
check "il passo fiscale non si dà per fatto da solo" \
  "$(echo "$R" | python3 -c "
import sys,json
p={x['chiave']:x['fatto'] for x in json.load(sys.stdin)['passi']}
print('ok' if p['fisco'] is False else 'ko')")"
curl -s -b "$JAR" -X PUT "$BASE/api/finance/tax/settings" -H 'Content-Type: application/json' \
  -d '{"tax_regime":"forfettario","tax_rate":5,"inps_type":"gestione_separata"}' >/dev/null
R=$(curl -s -b "$JAR" "$BASE/api/onboarding")
check "dopo il salvataggio risulta fatto" \
  "$(echo "$R" | python3 -c "
import sys,json
p={x['chiave']:x['fatto'] for x in json.load(sys.stdin)['passi']}
print('ok' if p['fisco'] is True else 'ko')")"

echo ""
echo "Fine della configurazione"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/completa")
check "la configurazione si chiude" "$(has "$R" '"completato": *true')"
R=$(curl -s -b "$JAR" "$BASE/api/auth/me")
check "l'utente risulta configurato anche da un altro dispositivo" "$(has "$R" '"onboarded": *true')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/completa")
check "richiamarla non rompe niente" "$(has "$R" '"completato": *true')"

echo ""
echo "Rimozione dei dati di esempio"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/pulisci")
check "i dati di esempio si rimuovono" "$(has "$R" '"demo": *false')"
R=$(curl -s -b "$JAR" "$BASE/api/clients")
check "i clienti finti spariscono" "$([ "$(jq_ "$R" "['clients'].__len__()")" = "0" ] && echo ok || echo ko)"
R=$(curl -s -b "$JAR" "$BASE/api/auth/me")
check "l'account sopravvive alla pulizia" "$(has "$R" 'nuovo@test.it')"
R=$(curl -s -b "$JAR" -X POST "$BASE/api/onboarding/pulisci")
check "pulire due volte non è un errore silenzioso" "$(has "$R" 'Non ci sono dati')"

echo ""
echo "Chi si registra dopo non eredita nulla"
JAR2=$(mktemp)
curl -s -c "$JAR2" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@test.it","password":"passwordsicura","name":"Secondo"}' >/dev/null
curl -s -b "$JAR2" -X POST "$BASE/api/onboarding/dati" -H 'Content-Type: application/json' \
  -d '{"modo":"vuoto"}' >/dev/null
R=$(curl -s -b "$JAR2" "$BASE/api/clients")
check "sceglie l'account vuoto e resta vuoto" "$([ "$(jq_ "$R" "['clients'].__len__()")" = "0" ] && echo ok || echo ko)"
R=$(curl -s "$BASE/api/onboarding")
check "senza sessione non si legge lo stato" "$(has "$R" 'Non autenticato')"

# ─────────────────────────────────────────── Password
echo ""
echo "Cambio password"
R=$(curl -s -b "$JAR2" -X POST "$BASE/api/auth/password" -H 'Content-Type: application/json' \
  -d '{"current":"sbagliata","password":"nuovapasswordlunga"}')
check "password attuale errata rifiutata" "$(has "$R" 'non è corretta')"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" -X POST "$BASE/api/auth/password" \
  -H 'Content-Type: application/json' -d '{"current":"sbagliata","password":"nuovapasswordlunga"}')
check "risponde 403 e non 401 (non butta fuori chi sbaglia a digitare)" \
  "$([ "$CODE" = "403" ] && echo ok || echo ko)"

R=$(curl -s -b "$JAR2" -X POST "$BASE/api/auth/password" -H 'Content-Type: application/json' \
  -d '{"current":"passwordsicura","password":"corta"}')
check "nuova password troppo corta rifiutata" "$(has "$R" '8 caratteri')"
R=$(curl -s -b "$JAR2" -X POST "$BASE/api/auth/password" -H 'Content-Type: application/json' \
  -d '{"current":"passwordsicura","password":"passwordsicura"}')
check "non si può 'cambiare' con la stessa password" "$(has "$R" 'uguale')"

# Due sessioni aperte per lo stesso utente: dopo il cambio ne resta una sola.
JAR3=$(mktemp)
curl -s -c "$JAR3" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@test.it","password":"passwordsicura"}' >/dev/null
R=$(curl -s -b "$JAR3" "$BASE/api/auth/me")
check "la seconda sessione parte valida" "$(has "$R" 'secondo@test.it')"

R=$(curl -s -b "$JAR2" -c "$JAR2" -X POST "$BASE/api/auth/password" \
  -H 'Content-Type: application/json' \
  -d '{"current":"passwordsicura","password":"nuovapasswordlunga"}')
check "il cambio va a buon fine" "$(has "$R" '"ok": *true')"
R=$(curl -s -b "$JAR2" "$BASE/api/auth/me")
check "chi ha cambiato la password resta dentro" "$(has "$R" 'secondo@test.it')"
R=$(curl -s -b "$JAR3" "$BASE/api/auth/me")
check "le altre sessioni vengono disconnesse" "$(has "$R" 'Non autenticato')"

R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@test.it","password":"passwordsicura"}')
check "la vecchia password non funziona più" "$(has "$R" 'non corretti')"
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@test.it","password":"nuovapasswordlunga"}')
check "la nuova password funziona" "$(has "$R" 'secondo@test.it')"

# ─────────────────────────────────────────── Recupero password
echo ""
echo "Recupero password via email"
R=$(curl -s -X POST "$BASE/api/auth/password/richiesta" -H 'Content-Type: application/json' \
  -d '{"email":"inesistente@test.it"}')
check "un indirizzo inesistente riceve la stessa risposta" "$(has "$R" 'Se esiste un account')"
check "nessuna email generata per un indirizzo inesistente" \
  "$([ "$(ls "$DIR/outbox" 2>/dev/null | wc -l)" -eq 0 ] && echo ok || echo ko)"

curl -s -X POST "$BASE/api/auth/password/richiesta" -H 'Content-Type: application/json' \
  -d '{"email":"nuovo@test.it"}' >/dev/null
EML=$(ls -t "$DIR/outbox" 2>/dev/null | head -1)
check "l'email di recupero viene generata" "$([ -n "$EML" ] && echo ok || echo ko)"
TOKEN=$(grep -o 'token=[a-f0-9]\{64\}' "$DIR/outbox/$EML" 2>/dev/null | head -1 | cut -d= -f2)
check "contiene un link con un token lungo" "$([ ${#TOKEN} -eq 64 ] && echo ok || echo ko)"

R=$(curl -s "$BASE/api/auth/password/verifica?token=$TOKEN")
check "il token risulta valido" "$(has "$R" '"valido": *true')"
R=$(curl -s "$BASE/api/auth/password/verifica?token=inventato")
check "un token inventato non è valido" "$(has "$R" '"valido": *false')"

# Il token non deve stare in chiaro nel database.
check "nel database c'è solo l'impronta, non il token" \
  "$(grep -q "$TOKEN" "$DIR"/*.db 2>/dev/null && echo ko || echo ok)"

R=$(curl -s -X POST "$BASE/api/auth/password/reimposta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"corta\"}")
check "anche dal link la password deve essere lunga" "$(has "$R" '8 caratteri')"

R=$(curl -s -X POST "$BASE/api/auth/password/reimposta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"passwordreimpostata\"}")
check "la reimpostazione riesce" "$(has "$R" '"ok": *true')"
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"nuovo@test.it","password":"passwordreimpostata"}')
check "si entra con la nuova password" "$(has "$R" 'nuovo@test.it')"

R=$(curl -s -X POST "$BASE/api/auth/password/reimposta" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"ancoraunaltra\"}")
check "lo stesso link non si riusa" "$(has "$R" 'non valido')"
R=$(curl -s -b "$JAR" "$BASE/api/auth/me")
check "la reimpostazione chiude le sessioni aperte" "$(has "$R" 'Non autenticato')"

# ─────────────────────────────────────────── Tentativi ripetuti
echo ""
echo "Limite ai tentativi di accesso"
for _ in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"nuovo@test.it","password":"tentativosbagliato"}'
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"nuovo@test.it","password":"tentativosbagliato"}')
check "dopo cinque errori l'accesso è bloccato (429)" "$([ "$CODE" = "429" ] && echo ok || echo ko)"
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"nuovo@test.it","password":"passwordreimpostata"}')
check "il blocco vale anche con la password giusta" "$(has "$R" 'Troppi tentativi')"
R=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"secondo@test.it","password":"nuovapasswordlunga"}')
check "gli altri account non vengono bloccati" "$(has "$R" 'secondo@test.it')"

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
