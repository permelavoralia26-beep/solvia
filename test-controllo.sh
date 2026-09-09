#!/usr/bin/env bash
# Controllo prima del volo: deve accorgersi delle cose che rovinano una messa
# online in silenzio, e distinguere ciò che è rotto da ciò che è solo da curare.
set -uo pipefail

PASS=0; FAIL=0
check() {
  if [ "$2" = "ok" ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; fi
}
has() { echo "$1" | grep -q "$2" && echo ok || echo ko; }

QUI="$(dirname "$0")"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

# Esegue il controllo con l'ambiente indicato e cattura testo e codice d'uscita.
# La cartella dati temporanea è solo un valore di comodo: se il test ne indica
# una propria, vince la sua (in "env A=1 A=2" prevale l'ultima assegnazione).
controllo() {
  USCITA=$(env -i PATH="$PATH" HOME="$HOME" SOLVIA_DATA_DIR="$DIR" "$@" \
    node "$QUI/controllo.js" 2>&1)
  CODICE=$?
}

echo ""
echo "Test controllo prima del volo"
echo "────────────────────────────────────────"

echo "In sviluppo è indulgente, ma non muto"
controllo NODE_ENV=sviluppo
check "segnala la chiave delle sessioni generata al volo" "$(has "$USCITA" 'Chiave delle sessioni generata')"
check "segnala la console sull'indirizzo predefinito" "$(has "$USCITA" 'indirizzo predefinito')"
check "segnala che i prezzi sono esposti senza incassi" "$(has "$USCITA" 'nessun incasso configurato')"
check "ogni problema ha un'istruzione" \
  "$(echo "$USCITA" | grep -q '→' && echo ok || echo ko)"

echo ""
echo "In produzione diventa severo"
controllo NODE_ENV=production
check "la chiave mancante diventa un errore" "$(has "$USCITA" 'Chiave delle sessioni mancante')"
check "e blocca: non si pubblica così" "$([ "$CODICE" != "0" ] && echo ok || echo ko)"

controllo NODE_ENV=production SOLVIA_SECRET=abc SOLVIA_DATA_DIR=./data
check "la cartella dati relativa viene bocciata" "$(has "$USCITA" 'non persistente')"
check "spiega che il database si azzera" "$(has "$USCITA" 'si azzera')"

echo ""
echo "Le pagine legali"
controllo NODE_ENV=production SOLVIA_SECRET=abc
check "i segnaposto nelle pagine legali sono un errore" "$(has "$USCITA" 'Pagine legali da compilare')"
check "dice esattamente cosa impostare" "$(has "$USCITA" 'SOLVIA_TITOLARE')"

echo ""
echo "Combinazioni di incasso che si contraddicono"
controllo SOLVIA_PRELANCIO=true STRIPE_SECRET_KEY=sk_test_x
check "pre-lancio acceso con Stripe già configurato è un avviso" \
  "$(has "$USCITA" 'Pre-lancio acceso ma Stripe')"
controllo SOLVIA_PRELANCIO=true
check "solo pre-lancio va bene" "$(has "$USCITA" 'incassi chiusi')"
controllo STRIPE_SECRET_KEY=sk_test_x
check "solo Stripe va bene" "$(has "$USCITA" 'Pagamenti collegati a Stripe')"
controllo SOLVIA_COMMERCIAL=false
check "progetto gratuito: nessun prezzo, nessun problema" "$(has "$USCITA" 'Progetto gratuito')"
controllo SOLVIA_COMMERCIAL=false STRIPE_SECRET_KEY=sk_test_x
check "chiavi Stripe con il listino spento sono un avviso" \
  "$(has "$USCITA" 'le chiavi Stripe sono impostate')"

echo ""
echo "Quando è tutto a posto lo dice"
# Pagine legali compilate + tutto il resto impostato.
BUONO=$(mktemp -d)
cp -r "$QUI/public" "$BUONO/public" 2>/dev/null
SOLVIA_TITOLARE="Mario Rossi" SOLVIA_CONTATTO_EMAIL="mario@esempio.it" \
  SOLVIA_INDIRIZZO="Via Roma 1, Milano" SOLVIA_HOSTING="Render" \
  node "$QUI/build-pages.js" >/dev/null 2>&1

controllo NODE_ENV=production SOLVIA_SECRET=abc SOLVIA_DATA_DIR=/var/data \
  SOLVIA_CONSOLE_PATH=stanza-mia SOLVIA_PRELANCIO=true SMTP_HOST=smtp.esempio.it
check "con tutto impostato non restano errori" "$([ "$CODICE" = "0" ] && echo ok || echo ko)"
check "e lo dichiara" "$(has "$USCITA" 'Si può pubblicare\|Tutto a posto')"
check "la console su indirizzo proprio risulta a posto" "$(has "$USCITA" 'stanza-mia')"

# Ripristina le pagine com'erano nel repository.
node "$QUI/build-pages.js" >/dev/null 2>&1
rm -rf "$BUONO"

echo ""
echo "Le pagine legali dicono la verità sul servizio"
SOLVIA_TITOLARE="Mario Rossi" SOLVIA_CONTATTO_EMAIL="mario@esempio.it" \
  SOLVIA_INDIRIZZO="Via Roma 1, Milano" node "$QUI/build-pages.js" >/dev/null 2>&1
T=$(cat "$QUI/public/termini.html")
check "con il listino acceso parlano di piani a pagamento" "$(has "$T" 'piani a pagamento')"
check "spiegano il rinnovo automatico" "$(has "$T" 'rinnovo è <strong>automatico')"
check "spiegano come disdire" "$(has "$T" 'disdire quando vuoi')"
check "citano il diritto di recesso dei consumatori" "$(has "$T" 'recedere entro <strong>14 giorni')"
check "promettono preavviso sui cambi di prezzo" "$(has "$T" '30 giorni')"
check "il titolare compare per nome" "$(has "$T" 'Mario Rossi')"
check "e l'avviso da compilare sparisce" \
  "$(echo "$T" | grep -q 'Da completare prima di pubblicare' && echo ko || echo ok)"

SOLVIA_COMMERCIAL=false SOLVIA_TITOLARE="Mario Rossi" SOLVIA_CONTATTO_EMAIL="m@e.it" \
  SOLVIA_INDIRIZZO="Via Roma 1" node "$QUI/build-pages.js" >/dev/null 2>&1
T=$(cat "$QUI/public/termini.html")
check "spegnendo il listino tornano a dire 'gratuito'" "$(has "$T" 'progetto personale')"
check "e non parlano più di abbonamenti" \
  "$(echo "$T" | grep -q 'rinnovo è <strong>automatico' && echo ko || echo ok)"

node "$QUI/build-pages.js" >/dev/null 2>&1   # ripristino

echo "────────────────────────────────────────"
printf "  %s test superati, %s falliti\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
