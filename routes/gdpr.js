'use strict';

/**
 * Diritti dell'interessato (GDPR, artt. 15-20).
 *
 *  - GET  /api/gdpr/export  → art. 15 (accesso) e art. 20 (portabilità):
 *                             tutti i dati dell'utente in un file JSON leggibile.
 *  - POST /api/gdpr/delete  → art. 17 (cancellazione): elimina l'account e tutto
 *                             il collegato, in modo irreversibile.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { requireAuth, clearAuthCookie } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/export', (req, res) => {
  const uid = req.user.id;
  const all = (sql) => db.prepare(sql).all(uid);

  const documents = all('SELECT * FROM documents WHERE user_id = ?').map((d) => ({
    ...d,
    voci: db.prepare('SELECT description, quantity, unit_price FROM line_items WHERE document_id = ? ORDER BY position').all(d.id),
  }));

  const payload = {
    informazioni: {
      descrizione: 'Copia completa dei dati associati al tuo account Solvia.',
      base_normativa: 'Artt. 15 e 20 del Regolamento UE 2016/679 (GDPR)',
      generato_il: new Date().toISOString(),
      nota: 'La password non è inclusa: è conservata solo come impronta crittografica (bcrypt) e non è leggibile nemmeno da chi gestisce il server.',
    },
    account: {
      id: req.user.id,
      email: req.user.email,
      nome: req.user.name,
      attivita: req.user.business_name,
      partita_iva: req.user.vat_number,
      indirizzo: req.user.address,
      iva_predefinita: req.user.default_vat,
      registrato_il: req.user.created_at,
    },
    clienti: all('SELECT * FROM clients WHERE user_id = ?'),
    documenti: documents,
    attivita: all('SELECT * FROM tasks WHERE user_id = ?'),
    email: all('SELECT * FROM emails WHERE user_id = ?'),
    registro_attivita: all('SELECT * FROM activity WHERE user_id = ?'),
  };

  const filename = `solvia-dati-${req.user.email.replace(/[^a-z0-9]/gi, '_')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

router.post('/delete', (req, res) => {
  // La password è richiesta anche da autenticati: impedisce che una sessione
  // lasciata aperta permetta a chiunque di distruggere l'account.
  // Risponde 403 e non 401: la sessione è valida, è la riconferma della password
  // a fallire. Con un 401 il client interpreterebbe l'errore come sessione
  // scaduta e butterebbe fuori l'utente per un semplice errore di battitura.
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(String(password), req.user.password_hash)) {
    return res.status(403).json({ error: 'Password non corretta' });
  }

  // Se è il titolare di uno studio condiviso, prima libera i collaboratori:
  // resterebbero agganciati a un account che non esiste più, e non potrebbero
  // nemmeno accedere. Escono con un account proprio e vuoto — i dati dello
  // studio erano del titolare e vengono cancellati con lui, come è giusto.
  const liberati = db.prepare(`
    UPDATE users SET studio_id = id, studio_role = 'titolare', plan = 'free',
      subscription_status = 'inattivo', onboarded_at = NULL, token_version = token_version + 1
    WHERE studio_id = ? AND id != ?
  `).run(req.user.id, req.user.id).changes;

  // Le tabelle collegate hanno ON DELETE CASCADE: si elimina tutto in un colpo.
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  if (!info.changes) return res.status(500).json({ error: 'Cancellazione non riuscita' });
  if (liberati) console.log(`Studio sciolto: ${liberati} collaboratori tornati autonomi`);

  clearAuthCookie(res);
  res.json({ ok: true, message: 'Account e dati eliminati definitivamente.' });
});

module.exports = router;
