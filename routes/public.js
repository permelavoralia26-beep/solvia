'use strict';

/**
 * Preventivi condivisibili.
 *
 * Il cliente riceve un link con un token lungo e casuale, apre il preventivo
 * impaginato e lo accetta o rifiuta con un clic. Nessuna registrazione, nessuna
 * password: il token È la credenziale, quindi va trattato come tale (non
 * indovinabile, revocabile, e non espone dati oltre a quel documento).
 */

const express = require('express');
const { db, logActivity } = require('../lib/db');
const { computeTotals } = require('../lib/totals');

const router = express.Router();

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;

function load(token) {
  const document = db.prepare(
    "SELECT * FROM documents WHERE public_token = ? AND kind = 'preventivo'",
  ).get(String(token || ''));
  if (!document) return null;

  const items = db.prepare(
    'SELECT description, quantity, unit_price FROM line_items WHERE document_id = ? ORDER BY position',
  ).all(document.id);
  const client = document.client_id
    ? db.prepare('SELECT name, email, address, vat_number FROM clients WHERE id = ?').get(document.client_id)
    : null;
  const owner = db.prepare(
    'SELECT name, business_name, vat_number, address, email FROM users WHERE id = ?',
  ).get(document.user_id);

  return { document, items, client, owner };
}

/** Dati del preventivo per la pagina pubblica. */
router.get('/preventivo/:token', (req, res) => {
  const data = load(req.params.token);
  if (!data) return res.status(404).json({ error: 'Preventivo non trovato o link non più valido' });

  // Prima apertura: registra la visualizzazione, così chi l'ha inviato lo sa.
  if (!data.document.viewed_at) {
    db.prepare("UPDATE documents SET viewed_at = datetime('now') WHERE id = ?").run(data.document.id);
    logActivity(data.document.user_id,
      `Il cliente ha aperto il preventivo ${data.document.number}`, 'doc');
  }

  const totals = computeTotals(data.items, data.document.vat_rate, data.document.withholding);
  const d = data.document;

  res.json({
    numero: d.number,
    data: d.issue_date,
    validoFinoAl: d.due_date,
    stato: d.status,
    decisoIl: d.decided_at,
    note: d.notes,
    notaCliente: d.client_note,
    voci: data.items,
    totali: totals,
    ivaPercentuale: d.vat_rate,
    ritenutaPercentuale: d.withholding,
    cliente: data.client,
    mittente: {
      nome: data.owner.business_name || data.owner.name,
      partitaIva: data.owner.vat_number,
      indirizzo: data.owner.address,
      email: data.owner.email,
    },
    firmatario: d.signed_name,
    firma: d.signature,
    // Decidibile solo finché non è già stato deciso e non è scaduto
    decidibile: ['bozza', 'inviata'].includes(d.status),
  });
});

/* ==================== Portale cliente ==================== */

/**
 * Tutti i documenti di un cliente dietro un unico link.
 * Espone solo ciò che il cliente ha già ricevuto o riceverà: niente bozze,
 * niente margini, niente dati di altri clienti.
 */
router.get('/cliente/:token', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE portal_token = ?')
    .get(String(req.params.token || ''));
  if (!client) return res.status(404).json({ error: 'Portale non trovato o link revocato' });

  db.prepare("UPDATE clients SET portal_opened_at = datetime('now') WHERE id = ?").run(client.id);

  const owner = db.prepare(
    'SELECT name, business_name, vat_number, address, email FROM users WHERE id = ?',
  ).get(client.user_id);

  // Le bozze restano fuori: sono lavoro non ancora finito.
  const documents = db.prepare(`
    SELECT id, kind, number, issue_date, due_date, status, total, public_token, decided_at
    FROM documents
    WHERE client_id = ? AND user_id = ? AND status != 'bozza'
    ORDER BY issue_date DESC, id DESC
  `).all(client.id, client.user_id);

  const invoices = documents.filter((d) => d.kind === 'fattura');

  res.json({
    cliente: { nome: client.name, indirizzo: client.address, partitaIva: client.vat_number },
    mittente: {
      nome: owner.business_name || owner.name,
      partitaIva: owner.vat_number,
      indirizzo: owner.address,
      email: owner.email,
    },
    documenti: documents.map((d) => ({
      tipo: d.kind,
      numero: d.number,
      data: d.issue_date,
      scadenza: d.due_date,
      stato: d.status,
      totale: d.total,
      decisoIl: d.decided_at,
      // Il link diretto compare solo per i preventivi effettivamente condivisi
      link: d.kind === 'preventivo' && d.public_token ? `/p/${d.public_token}` : null,
    })),
    riepilogo: {
      totaleFatturato: Math.round(invoices.reduce((s, d) => s + d.total, 0) * 100) / 100,
      daPagare: Math.round(invoices.filter((d) => d.status === 'inviata')
        .reduce((s, d) => s + d.total, 0) * 100) / 100,
      numeroFatture: invoices.length,
    },
  });
});

/** Accettazione o rifiuto da parte del cliente. */
router.post('/preventivo/:token/decisione', (req, res) => {
  const data = load(req.params.token);
  if (!data) return res.status(404).json({ error: 'Preventivo non trovato' });

  const d = data.document;
  if (!['bozza', 'inviata'].includes(d.status)) {
    return res.status(409).json({ error: 'Questo preventivo è già stato deciso' });
  }

  const accept = req.body?.accetta === true;
  const note = String(req.body?.nota || '').trim().slice(0, 1000) || null;
  const name = String(req.body?.firmatario || '').trim().slice(0, 120) || null;

  // Firma tracciata col dito, come immagine PNG. Si accetta solo se plausibile:
  // formato corretto e sotto i 200 KB, per non trasformare il campo in un
  // canale per caricare file arbitrari.
  let signature = null;
  const raw = req.body?.firma;
  if (accept && typeof raw === 'string' && raw.startsWith('data:image/png;base64,')
      && raw.length < 200_000) {
    signature = raw;
  }

  db.prepare(`
    UPDATE documents
    SET status = ?, decided_at = datetime('now'), decided_ip = ?, client_note = ?,
        signature = ?, signed_name = ?
    WHERE id = ?
  `).run(accept ? 'accettata' : 'rifiutata', clientIp(req), note, signature, name, d.id);

  logActivity(d.user_id,
    `Preventivo ${d.number} ${accept ? 'ACCETTATO' : 'rifiutato'} dal cliente`,
    accept ? 'star' : 'dot');

  // Un preventivo accettato genera l'attività di follow-up: emettere la fattura.
  if (accept) {
    const due = new Date();
    due.setDate(due.getDate() + 2);
    db.prepare(`
      INSERT INTO tasks (user_id, client_id, title, due_date, priority, source)
      VALUES (?,?,?,?,'alta','preventivi')
    `).run(d.user_id, d.client_id,
      `Emettere fattura per il preventivo ${d.number} (accettato)`,
      due.toISOString().slice(0, 10));
  }

  res.json({ ok: true, stato: accept ? 'accettata' : 'rifiutata' });
});

/**
 * Sondaggio sul prezzo — "quanto pagheresti?".
 *
 * Pubblico di proposito: la domanda si fa a chi passa dal sito, non a chi ha
 * già un account. Non incassa nulla e non promette nulla; i risultati si
 * leggono solo dalla console di direzione.
 */
router.post('/sondaggio', (req, res) => {
  const sondaggio = require('../lib/sondaggio');
  const { impronta } = require('../lib/analytics');

  const esito = sondaggio.rispondi({
    importo: req.body?.importo,
    mestiere: req.body?.mestiere,
    email: req.body?.email,
    origine: req.body?.origine || 'sito',
    visitatore: impronta(req),
  });

  res.status(esito.ok ? 200 : 400).json(esito);
});

module.exports = router;
