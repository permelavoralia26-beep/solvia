'use strict';

/**
 * Sostegno volontario — "offrimi un caffè".
 *
 * Spento di default, e resta spento finché non c'è un link vero: senza
 * `SOLVIA_SOSTIENI_URL` sul sito non compare assolutamente niente.
 *
 * Perché così e non con un pulsante sempre presente. Chi riceve i soldi è una
 * persona precisa, con un nome, un conto e una posizione fiscale sua — e non
 * coincide per forza con chi ha scritto il codice. Un pulsante che compare per
 * conto suo, o che non dice a chi vanno i soldi, è il modo più veloce di far
 * sembrare una truffa un progetto onesto.
 *
 * Quindi tre regole, applicate qui e non lasciate alla buona volontà di chi
 * scrive la pagina:
 *
 *   1. senza link configurato non si mostra nulla;
 *   2. il nome di chi riceve è **obbligatorio** quanto il link;
 *   3. si accettano solo indirizzi https di piattaforme note, perché un campo
 *      libero che finisce in un pulsante "paga" è esattamente il posto dove non
 *      si vuole un errore di battitura.
 *
 * Il sostegno non sblocca niente: Solvia è identica per chi dona e per chi no.
 * È scritto nella pagina e vale come promessa.
 */

/* Piattaforme di donazione riconosciute. L'elenco è corto di proposito: sono
   quelle che si occupano loro dell'incasso e dell'identità di chi riceve. */
const PIATTAFORME = [
  'ko-fi.com',
  'buymeacoffee.com',
  'liberapay.com',
  'github.com',        // GitHub Sponsors
  'patreon.com',
];

const URL_GREZZO = (process.env.SOLVIA_SOSTIENI_URL || '').trim();
const NOME = (process.env.SOLVIA_SOSTIENI_NOME || process.env.SOLVIA_TITOLARE || '').trim();

/** Il link è accettabile? Restituisce il motivo del rifiuto, o null se va bene. */
function perche(indirizzo) {
  if (!indirizzo) return 'nessun indirizzo';
  let u;
  try { u = new URL(indirizzo); } catch { return 'non è un indirizzo valido'; }
  if (u.protocol !== 'https:') return 'deve iniziare con https://';
  const host = u.hostname.replace(/^www\./, '');
  if (!PIATTAFORME.includes(host)) {
    return `${host} non è fra le piattaforme riconosciute (${PIATTAFORME.join(', ')})`;
  }
  return null;
}

const problema = URL_GREZZO ? perche(URL_GREZZO) : null;

/* Attivo solo se c'è un link valido **e** si sa chi riceve. Mancando il nome il
   pulsante resterebbe anonimo, che è peggio del non averlo. */
const ATTIVO = Boolean(URL_GREZZO) && !problema && Boolean(NOME);

/** Quel poco che la pagina pubblica deve sapere. Niente di riservato. */
const statoPubblico = () => ({
  attivo: ATTIVO,
  url: ATTIVO ? URL_GREZZO : null,
  nome: ATTIVO ? NOME : null,
});

/** Diagnosi per il controllo prima del volo: dice *perché* è spento. */
function diagnosi() {
  if (!URL_GREZZO) return { stato: 'spento', motivo: 'nessun SOLVIA_SOSTIENI_URL impostato' };
  if (problema) return { stato: 'rotto', motivo: problema };
  if (!NOME) {
    return {
      stato: 'rotto',
      motivo: 'manca il nome di chi riceve (SOLVIA_SOSTIENI_NOME o SOLVIA_TITOLARE)',
    };
  }
  return { stato: 'acceso', motivo: `${URL_GREZZO} — intestato a ${NOME}` };
}

module.exports = { ATTIVO, PIATTAFORME, statoPubblico, diagnosi, perche };
