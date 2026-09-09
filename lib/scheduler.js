'use strict';

/**
 * Lavori periodici: genera le fatture ricorrenti scadute e prepara i solleciti.
 *
 * Gira dentro il processo del server, non come cron di sistema: per un progetto
 * di queste dimensioni è più semplice da installare e non richiede configurazione.
 * Il controllo è ogni ora, ma ogni lavoro è idempotente — se gira due volte lo
 * stesso giorno non duplica nulla, perché si basa sulle date già registrate.
 */

const { db } = require('./db');
const recurring = require('./recurring');
const reminders = require('./reminders');

const HOUR = 60 * 60 * 1000;
let timer = null;
let lastRun = null;

function runOnce() {
  const started = new Date().toISOString();
  let generated = 0;
  let prepared = 0;

  try {
    generated = recurring.runDue().generated;
  } catch (e) {
    console.error('Generazione fatture ricorrenti non riuscita:', e.message);
  }

  try {
    // I solleciti si preparano per ogni utente che li ha lasciati attivi.
    const users = db.prepare('SELECT id FROM users WHERE reminders_enabled = 1').all();
    for (const u of users) {
      try {
        prepared += reminders.prepareForUser(u.id).prepared;
      } catch (e) {
        console.error(`Solleciti non riusciti per l'utente ${u.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Preparazione solleciti non riuscita:', e.message);
  }

  // Statistiche vecchie: non servono a decidere niente e occupano spazio.
  let potati = 0;
  try {
    potati = require('./analytics').potaVecchi();
  } catch (e) {
    console.error('Pulizia statistiche non riuscita:', e.message);
  }

  lastRun = { started, generated, prepared, potati };
  if (generated || prepared) {
    console.log(`  Lavori periodici: ${generated} fatture generate, ${prepared} solleciti pronti`);
  }
  if (potati) console.log(`  Statistiche: ${potati} eventi oltre l'anno rimossi`);
  return lastRun;
}

function start() {
  if (timer) return;
  // Un primo giro poco dopo l'avvio, così un server riacceso recupera subito
  // ciò che è scaduto mentre era spento.
  setTimeout(runOnce, 5000).unref?.();
  timer = setInterval(runOnce, HOUR);
  timer.unref?.();   // non tiene vivo il processo se tutto il resto è chiuso
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, runOnce, getLastRun: () => lastRun };
