'use strict';

/**
 * Console di direzione — piattaforma separata, non fa parte di Solvia.
 *
 * I clienti che usano Solvia non devono nemmeno sospettare che esista: non è
 * una funzione del prodotto, è lo strumento con cui chi lo vende guarda come
 * sta andando. Perciò:
 *
 *  · vive su un indirizzo suo (SOLVIA_CONSOLE_PATH, predefinito "/console"),
 *    non collegato da nessuna pagina e marcato "noindex" per i motori di ricerca
 *  · a chi non è amministratore risponde **404**, non 403: un "vietato" direbbe
 *    comunque "qui c'è qualcosa", che è esattamente l'informazione da non dare
 *  · l'applicazione dei clienti non contiene una riga del suo codice
 *
 * Qui dentro c'è anche la raccolta degli eventi, che invece è pubblica: sta
 * nello stesso file perché legge e scrive la stessa tabella.
 */

const express = require('express');
const path = require('path');
const { readUserFromRequest } = require('../lib/auth');
const analytics = require('../lib/analytics');

const router = express.Router();

/** L'indirizzo della console. Cambiarlo la sposta, senza toccare altro. */
const PERCORSO = `/${(process.env.SOLVIA_CONSOLE_PATH || 'console').replace(/^\/+/, '')}`;

/* ---------------------------------------------------------------- */
/* Raccolta degli eventi — pubblica                                  */
/* ---------------------------------------------------------------- */

/**
 * Un tetto per indirizzo, in memoria: senza, chiunque potrebbe gonfiare i
 * numeri con un ciclo di richieste e rendere le statistiche inutili.
 * Volutamente generoso: una visita normale manda pochi eventi.
 */
const TETTO_AL_MINUTO = 60;
const contatori = new Map();

function troppiEventi(ip) {
  const minuto = Math.floor(Date.now() / 60000);
  const voce = contatori.get(ip);
  if (!voce || voce.minuto !== minuto) {
    contatori.set(ip, { minuto, n: 1 });
    if (contatori.size > 10000) {
      for (const [k, v] of contatori) if (v.minuto !== minuto) contatori.delete(k);
    }
    return false;
  }
  voce.n += 1;
  return voce.n > TETTO_AL_MINUTO;
}

/**
 * Risponde sempre 204, anche quando scarta l'evento.
 * Il browser non deve sapere se è stato contato: non cambia nulla per la
 * persona, e un errore visibile in console sembrerebbe un guasto del sito.
 */
router.post('/api/eventi', (req, res) => {
  try {
    if (!troppiEventi(req.ip)) {
      req.user = readUserFromRequest(req) || undefined;
      analytics.registraPubblico(req, {
        name: req.body?.name,
        path: req.body?.path,
        label: req.body?.label,
        referrer: req.body?.referrer,
      });
    }
  } catch (e) {
    console.error('Evento non registrato:', e.message);
  }
  res.status(204).end();
});

/* ---------------------------------------------------------------- */
/* La console — riservata                                            */
/* ---------------------------------------------------------------- */

/**
 * Chi non è amministratore riceve la stessa risposta che riceverebbe per un
 * indirizzo inventato. Passa al gestore successivo, che è il 404 generale:
 * così la pagina di errore è identica, byte per byte, e non c'è modo di
 * dedurre l'esistenza della console confrontando le risposte.
 */
function soloAmministratore(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user || !user.is_admin) return next('router');
  req.admin = user;
  next();
}

/**
 * La pagina. Senza sessione mostra solo un modulo di accesso spoglio.
 *
 * Il file sta in `riservato/`, non in `public/`: se fosse fra i file statici
 * sarebbe raggiungibile anche indovinando "/console.html", e l'indirizzo
 * segreto non servirebbe più a niente.
 */
router.get(PERCORSO, (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, '..', 'riservato', 'console.html'));
});

/* I dati veri: qui il controllo è serio. */
router.get(`${PERCORSO}/dati`, soloAmministratore, (req, res) => {
  try {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.json(analytics.quadro(req.query.periodo));
  } catch (e) {
    console.error('Quadro di direzione non riuscito:', e.message);
    res.status(500).json({ error: 'Statistiche non disponibili', dettaglio: e.message });
  }
});

/**
 * Dice alla pagina se chi la sta guardando ha diritto ai dati.
 * Non rivela nulla: risponde lo stesso a tutti, con un booleano.
 */
router.get(`${PERCORSO}/stato`, (req, res) => {
  const user = readUserFromRequest(req);
  const ammesso = Boolean(user && user.is_admin);
  res.json({
    autorizzato: ammesso,
    autenticato: Boolean(user),
    nome: ammesso ? user.name : null,
    // Perfino il nome del prodotto arriva solo a chi ha diritto: chi apre la
    // console e legge il codice della pagina non trova niente da collegare.
    prodotto: ammesso ? 'Solvia' : null,
  });
});

module.exports = { router, PERCORSO };
