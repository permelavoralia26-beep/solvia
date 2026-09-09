'use strict';

/**
 * Primo accesso.
 *
 * Chi si registra non finisce sulla dashboard normale, che senza dati sarebbe
 * una distesa di zeri, né su una piena di clienti finti mai chiesti. Atterra su
 * una schermata di benvenuto che gli fa fare tre cose: scegliere se partire da
 * zero o con dati di esempio, compilare i dati che finiscono su fatture e
 * preventivi, e impostare il regime fiscale.
 *
 * Lo stato sta sul server (users.onboarded_at): l'interfaccia lo legge e basta,
 * quindi la schermata riappare identica anche cambiando dispositivo, e non si
 * può saltare svuotando la memoria del browser.
 */

const express = require('express');
const { db, logActivity } = require('../lib/db');
const analytics = require('../lib/analytics');
const { requireAuth } = require('../lib/auth');
const { seedDemoData } = require('../lib/seed');

const router = express.Router();

const conta = (tabella, userId) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${tabella} WHERE user_id = ?`).get(userId).n;

/**
 * Stato dei passi. Serve sia alla schermata di benvenuto sia alla checklist
 * "primi passi" che resta sulla dashboard finché non è tutto fatto.
 */
function stato(user) {
  const clienti = conta('clients', user.id);
  const documenti = conta('documents', user.id);

  const passi = [
    {
      chiave: 'dati',
      titolo: 'Scegli da dove partire',
      dettaglio: 'Account vuoto oppure precaricato con dati di esempio da esplorare.',
      fatto: Boolean(user.onboarded_at) || user.demo_data === 1 || clienti > 0,
    },
    {
      chiave: 'profilo',
      titolo: 'I tuoi dati',
      dettaglio: 'Nome dell\'attività, partita IVA e indirizzo: finiscono su ogni fattura.',
      fatto: Boolean(user.business_name && user.vat_number),
    },
    {
      chiave: 'fisco',
      titolo: 'Regime fiscale',
      dettaglio: 'Serve alla sezione Tasse per dirti quanto accantonare.',
      fatto: Boolean(user.tax_configured),
    },
    {
      chiave: 'cliente',
      titolo: 'Il primo cliente',
      dettaglio: 'Da qui nascono preventivi e fatture.',
      fatto: clienti > 0,
    },
    {
      chiave: 'documento',
      titolo: 'Il primo preventivo',
      dettaglio: 'Lo mandi con un link: il cliente lo firma dal telefono.',
      fatto: documenti > 0,
    },
  ];

  return {
    completato: Boolean(user.onboarded_at),
    demo: Boolean(user.demo_data),
    passi,
    mancanti: passi.filter((p) => !p.fatto).length,
  };
}

router.get('/', requireAuth, (req, res) => res.json(stato(req.user)));

/**
 * Scelta iniziale: account vuoto o con dati di esempio.
 * I dati di esempio si caricano una volta sola — chiamarla due volte non
 * duplica nulla.
 */
router.post('/dati', requireAuth, (req, res) => {
  const modo = req.body?.modo;
  if (!['esempi', 'vuoto'].includes(modo)) {
    return res.status(400).json({ error: 'Scelta non valida' });
  }

  if (modo === 'esempi') {
    if (req.user.demo_data) return res.status(409).json({ error: 'I dati di esempio ci sono già' });
    seedDemoData(req.user.id);
    db.prepare('UPDATE users SET demo_data = 1 WHERE id = ?').run(req.user.id);
    logActivity(req.user.id, 'Caricati i dati di esempio', 'star');
    analytics.registra('dati_esempio', { userId: req.user.id, label: 'esempi', req });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, ...stato(user) });
});

/**
 * Rimuove i dati di esempio quando non servono più.
 * Cancella solo ciò che è stato precaricato, riconoscibile perché generato dal
 * seed: si toglie tutto e si riparte puliti, senza toccare l'account.
 */
router.post('/pulisci', requireAuth, (req, res) => {
  if (!req.user.demo_data) return res.status(409).json({ error: 'Non ci sono dati di esempio' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM documents WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM clients WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM emails WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM tasks WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM expenses WHERE user_id = ?').run(req.user.id);
    db.prepare('UPDATE users SET demo_data = 0 WHERE id = ?').run(req.user.id);
  });
  tx();

  logActivity(req.user.id, 'Dati di esempio rimossi — si riparte da zero', 'dot');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, ...stato(user) });
});

/* Fine del primo accesso: da qui in poi si vede la dashboard normale. */
router.post('/completa', requireAuth, (req, res) => {
  if (!req.user.onboarded_at) {
    db.prepare("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?").run(req.user.id);
    logActivity(req.user.id, 'Configurazione iniziale completata', 'star');
    analytics.registra('benvenuto_completato', { userId: req.user.id, req });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, ...stato(user) });
});

module.exports = router;
