'use strict';

const express = require('express');
const { requireAdmin } = require('../lib/auth');
const nl = require('../lib/newsletter');
const { listOutbox, MODE: MAIL_MODE, FROM_EMAIL } = require('../lib/mailer');

const router = express.Router();

const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;

/* ================= Parte pubblica ================= */

/** Iscrizione dal sito. */
router.post('/subscribe', async (req, res) => {
  const { email, name, consent } = req.body || {};
  try {
    const result = await nl.subscribe({
      email, name, consent: consent === true || consent === 'on',
      ip: clientIp(req),
      agent: (req.headers['user-agent'] || '').slice(0, 200),
      origin: originOf(req),
    });
    if (!result.ok) return res.status(400).json(result);

    // Messaggio identico in ogni caso: non rivela se l'indirizzo era già iscritto.
    res.json({
      ok: true,
      message: 'Ti abbiamo inviato un\'email: clicca il link dentro per confermare l\'iscrizione.',
    });
  } catch (e) {
    console.error('Iscrizione newsletter non riuscita:', e.message);
    res.status(500).json({ ok: false, error: 'Invio dell\'email di conferma non riuscito. Riprova più tardi.' });
  }
});

router.get('/confirm', (req, res) => res.json(nl.confirm(req.query.t)));
router.post('/unsubscribe', (req, res) => res.json(nl.unsubscribe(req.body?.token || req.query.t)));
router.post('/erase', (req, res) => res.json(nl.erase(req.body?.token || req.query.t)));

/* ================= Pannello amministratore ================= */

router.get('/admin/overview', requireAdmin, (req, res) => {
  res.json({
    stats: nl.stats(),
    subscribers: nl.listSubscribers(),
    campaigns: nl.listCampaigns(),
    mailMode: MAIL_MODE,
    fromEmail: FROM_EMAIL,
    outbox: MAIL_MODE === 'outbox' ? listOutbox(20) : [],
  });
});

router.post('/admin/campaigns', requireAdmin, (req, res) => {
  const result = nl.createCampaign(req.body?.subject, req.body?.body);
  res.status(result.ok ? 201 : 400).json(result);
});

router.put('/admin/campaigns/:id', requireAdmin, (req, res) => {
  const result = nl.updateCampaign(req.params.id, req.body?.subject, req.body?.body);
  res.status(result.ok ? 200 : 400).json(result);
});

router.delete('/admin/campaigns/:id', requireAdmin, (req, res) => {
  const result = nl.deleteCampaign(req.params.id);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/admin/campaigns/:id/send', requireAdmin, async (req, res) => {
  try {
    // testTo: invia solo a un indirizzo di prova, senza marcare la campagna come inviata.
    const result = await nl.sendCampaign(req.params.id, originOf(req), {
      testTo: req.body?.testTo || null,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    console.error('Invio campagna non riuscito:', e.message);
    res.status(500).json({ ok: false, error: 'Invio non riuscito' });
  }
});

module.exports = router;
