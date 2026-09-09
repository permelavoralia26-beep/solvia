#!/data/data/com.termux/files/usr/bin/bash
#
# Pubblica Solvia su GitHub dal tablet, senza PC.
#
# Uso:  bash github.sh
#
# Ti chiede nome utente e token, poi carica tutto. Da lì potrai collegare
# Render e avere il sito online.

set -u

VERDE='\033[0;32m'; GIALLO='\033[0;33m'; ROSSO='\033[0;31m'; GRASSETTO='\033[1m'; FINE='\033[0m'
ok()    { printf "  ${VERDE}✓${FINE} %s\n" "$1"; }
info()  { printf "  ${GIALLO}•${FINE} %s\n" "$1"; }
errore(){ printf "  ${ROSSO}✗${FINE} %s\n" "$1"; }

CARTELLA="$HOME/solvia"
cd "$CARTELLA" 2>/dev/null || { errore "Non trovo ~/solvia. Lancia prima samsung.sh"; exit 1; }

printf "\n${GRASSETTO}Pubblicazione su GitHub${FINE}\n────────────────────────────────────────\n"

if [ ! -d .git ]; then
  errore "Manca la cronologia git. Rilancia samsung.sh."
  exit 1
fi
ok "repository pronto ($(git rev-list --count HEAD) commit)"

# Controllo che non stiano per finire online cose che devono restare private
if git ls-files | grep -qE '^\.env$|^data/'; then
  errore "Attenzione: ci sono file privati tracciati. Fermati e controlla."
  exit 1
fi
ok "nessun file privato in partenza"

printf "\n${GRASSETTO}Prima di continuare, sul tablet:${FINE}\n"
printf "  1. Apri github.com e crea un repository chiamato ${GRASSETTO}solvia${FINE}\n"
printf "     (non aggiungere README né .gitignore: ci sono già)\n"
printf "  2. Vai su github.com/settings/tokens → Generate new token (classic)\n"
printf "     Spunta ${GRASSETTO}repo${FINE} e copia il token che appare\n\n"

printf "Nome utente GitHub: "
read -r UTENTE
[ -z "$UTENTE" ] && { errore "Nome utente obbligatorio"; exit 1; }

printf "Token (non si vede mentre lo incolli): "
read -rs TOKEN
printf "\n\n"
[ -z "$TOKEN" ] && { errore "Token obbligatorio"; exit 1; }

git config user.name "$UTENTE" 2>/dev/null
if [ -z "$(git config user.email)" ]; then
  printf "Email GitHub: "
  read -r EMAIL
  git config user.email "$EMAIL"
fi

# Il token finisce solo nella riga di comando del push, mai salvato su disco
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$UTENTE/solvia.git"
git branch -M main

info "Carico su GitHub…"
if git push -u "https://$UTENTE:$TOKEN@github.com/$UTENTE/solvia.git" main 2>&1 | tail -4; then
  # Rimette l'indirizzo pulito, senza token dentro
  git remote set-url origin "https://github.com/$UTENTE/solvia.git"
  ok "caricato"
  printf "\n${GRASSETTO}Fatto.${FINE}\n"
  printf "  Il codice è su:  https://github.com/%s/solvia\n" "$UTENTE"
  printf "\n${GRASSETTO}Per metterlo online (dal browser del tablet):${FINE}\n"
  printf "  1. render.com → accedi con GitHub\n"
  printf "  2. New → Blueprint → scegli il repository solvia\n"
  printf "  3. Render legge render.yaml e configura tutto da solo\n"
  printf "  4. In pochi minuti hai il tuo indirizzo pubblico\n\n"
else
  errore "Caricamento non riuscito."
  printf "  Cause tipiche: token senza permesso 'repo', oppure repository non creato.\n\n"
  exit 1
fi
