'use strict';

/**
 * Studio condiviso: inviti, membri, uscita.
 *
 * Queste rotte NON usano il middleware `studioCondiviso`: qui `req.user` deve
 * restare la persona vera, perché si decide chi può invitare e chi può essere
 * rimosso.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const analytics = require('../lib/analytics');
const { requireAuth, issueToken, setAuthCookie } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');
const studio = require('../lib/studio');

const router = express.Router();

/* ---------------------------------------------------------------- */
/* Pagina pubblica dell'invito — prima dell'accesso                  */
/* ---------------------------------------------------------------- */

/** Chi apre il link vuole sapere chi lo ha invitato, prima di dare una password. */
router.get('/invito', (req, res) => {
  const letto = studio.leggiInvito(req.query.token);
  if (!letto) return res.json({ valido: false });
  res.json({
    valido: true,
    email: letto.invito.email,
    studio: letto.titolare.business_name || letto.titolare.name,
    invitatoDa: letto.titolare.name,
  });
});

/** Accettazione: crea l'account del collaboratore e lo fa entrare. */
router.post('/invito/accetta', (req, res) => {
  const esito = studio.accettaInvito(
    req.body?.token,
    { name: req.body?.name, password: req.body?.password },
    (pw) => bcrypt.hashSync(pw, 10),
  );
  if (esito.errore) return res.status(400).json({ error: esito.errore });

  analytics.registra('invito_accettato', { userId: esito.user.id, req });

  setAuthCookie(res, issueToken(esito.user));
  res.status(201).json({ ok: true, name: esito.user.name });
});

/* ---------------------------------------------------------------- */
/* Gestione dall'interno dell'app                                    */
/* ---------------------------------------------------------------- */

router.use(requireAuth);

router.get('/', (req, res) => res.json(studio.stato(req.user)));

/** Invita una persona. Solo il titolare, solo con il piano Team. */
router.post('/inviti', studio.soloTitolare, async (req, res) => {
  const titolare = studio.titolareDi(req.user);
  const esito = studio.creaInvito(titolare, req.body?.email, req.user.id);

  if (esito.errore) {
    // 402 quando manca il piano: l'interfaccia mostra la proposta di passaggio.
    return res.status(esito.proOnly ? 402 : 400)
      .json({ error: esito.errore, upgrade: Boolean(esito.proOnly), proOnly: esito.proOnly });
  }

  analytics.registra('invito_studio', { userId: req.user.id, req });

  const origin = `${req.protocol}://${req.get('host')}`;
  const link = `${origin}/invito.html?token=${esito.token}`;
  const nomeStudio = titolare.business_name || titolare.name;

  try {
    await sendMail({
      to: esito.email,
      subject: `${titolare.name} ti invita nello studio ${nomeStudio} su Solvia`,
      text: [
        `${titolare.name} ti ha invitato a lavorare nello studio "${nomeStudio}" su Solvia.`,
        '',
        `Accetta entro ${studio.DURATA_INVITO_ORE} ore:`,
        link,
        '',
        'Entrando vedrai gli stessi clienti, preventivi e fatture dello studio.',
        'Se non aspettavi questo invito, ignora il messaggio.',
      ].join('\n'),
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6;color:#0F172A">
          <p><strong>${titolare.name}</strong> ti ha invitato a lavorare nello studio
          <strong>${nomeStudio}</strong> su Solvia.</p>
          <p style="margin:26px 0">
            <a href="${link}" style="background:#4F46E5;color:#fff;padding:12px 22px;
               border-radius:9px;text-decoration:none;font-weight:600">Entra nello studio</a>
          </p>
          <p style="font-size:13px;color:#64748B">L'invito vale ${studio.DURATA_INVITO_ORE} ore.
          Entrando vedrai gli stessi clienti, preventivi e fatture dello studio.</p>
        </div>`,
    });
  } catch (e) {
    console.error('Invio invito non riuscito:', e.message);
  }

  res.status(201).json({ ok: true, ...studio.stato(req.user) });
});

/** Revoca un invito ancora in sospeso. */
router.delete('/inviti/:id', studio.soloTitolare, (req, res) => {
  if (!studio.revocaInvito(studio.studioIdDi(req.user), Number(req.params.id))) {
    return res.status(404).json({ error: 'Invito non trovato o già usato' });
  }
  res.json({ ok: true, ...studio.stato(req.user) });
});

/** Il titolare rimuove un collaboratore. Il lavoro resta allo studio. */
router.delete('/membri/:id', studio.soloTitolare, (req, res) => {
  const esito = studio.rimuoviMembro(studio.studioIdDi(req.user), Number(req.params.id));
  if (esito.errore) return res.status(400).json({ error: esito.errore });
  res.json({ ok: true, nome: esito.nome, ...studio.stato(req.user) });
});

/** Un collaboratore se ne va per scelta sua. */
router.post('/esci', (req, res) => {
  if (req.user.studio_role === 'titolare') {
    return res.status(400).json({ error: 'Sei il titolare: non puoi uscire dal tuo studio' });
  }
  const esito = studio.rimuoviMembro(studio.studioIdDi(req.user), req.user.id);
  if (esito.errore) return res.status(400).json({ error: esito.errore });

  // Uscendo, la sessione non vale più: rimuoviTeam alza token_version.
  res.json({ ok: true, uscito: true });
});

/** Il registro attività dello studio, con il nome di chi ha fatto cosa. */
router.get('/attivita', (req, res) => {
  const righe = db.prepare(`
    SELECT message, icon, actor_name, created_at FROM activity
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 60
  `).all(studio.studioIdDi(req.user));
  res.json({ attivita: righe });
});

module.exports = router;
