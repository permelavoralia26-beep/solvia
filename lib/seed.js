'use strict';

const { db } = require('./db');
const { computeTotals } = require('./totals');

const iso = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const DEMO_CLIENTS = [
  { name: 'Bianchi Costruzioni Srl', email: 'amministrazione@bianchicostruzioni.it', phone: '+39 02 1234567', vat_number: 'IT01234567890', address: 'Via Montenapoleone 12, 20121 Milano' },
  { name: 'Studio Verdi & Associati', email: 'info@studioverdi.it', phone: '+39 06 7654321', vat_number: 'IT09876543210', address: 'Via del Corso 45, 00186 Roma' },
  { name: 'Caffè Aurora', email: 'laura@caffeaurora.it', phone: '+39 011 998877', vat_number: 'IT05566778899', address: 'Corso Vittorio Emanuele 88, 10121 Torino' },
];

const DEMO_EMAILS = [
  {
    from_name: 'Laura Bianchi', from_email: 'laura@bianchicostruzioni.it',
    subject: 'Richiesta preventivo per restyling sito web',
    body: 'Buongiorno, avremmo bisogno di un preventivo per il restyling completo del nostro sito aziendale, circa 8 pagine, con area contatti e blog. Il budget indicativo è di 4.000 €. Ci servirebbe una risposta al più presto perché vorremmo partire il mese prossimo. Grazie.',
  },
  {
    from_name: 'Marco Verdi', from_email: 'marco@studioverdi.it',
    subject: 'Fattura 2026/012 — conferma pagamento',
    body: 'Buongiorno, le confermo che abbiamo disposto il bonifico per la fattura 2026/012. Il pagamento dovrebbe arrivare entro fine settimana. Le chiedo cortesemente di confermarmi la ricezione. Cordiali saluti.',
  },
  {
    from_name: 'Giulia Rossi', from_email: 'giulia@caffeaurora.it',
    subject: 'Disponibilità per una call la prossima settimana',
    body: 'Ciao, avrei piacere di fissare una call la prossima settimana per parlare del progetto insegne e della campagna social. Che disponibilità hai tra martedì e giovedì? Grazie mille.',
  },
  {
    from_name: 'Andrea Conti', from_email: 'a.conti@nordimpianti.it',
    subject: 'Feedback sulla prima revisione del progetto',
    body: 'Buongiorno, abbiamo revisionato la prima bozza consegnata. In generale ci piace molto, avremmo solo qualche modifica sulla sezione servizi e sui colori del header. Quando pensi di poter consegnare la versione aggiornata?',
  },
  {
    from_name: 'Ufficio Contratti', from_email: 'contratti@servizidigitali.it',
    subject: 'Documento da firmare — informativa privacy',
    body: 'Gentile fornitore, le inviamo in allegato l informativa privacy aggiornata da restituire firmata per l anagrafica fornitori. Non ci sono scadenze stringenti. Cordiali saluti.',
  },
];

const DEMO_TASKS = [
  { title: 'Inviare preventivo restyling a Bianchi Costruzioni', due_date: iso(1), priority: 'alta', source: 'email' },
  { title: 'Sollecitare fattura 2026/009 in scadenza', due_date: iso(0), priority: 'alta', source: 'fatture' },
  { title: 'Preparare revisione grafica per Nord Impianti', due_date: iso(3), priority: 'media', source: 'email' },
  { title: 'Aggiornare portfolio con gli ultimi due lavori', due_date: iso(7), priority: 'bassa', source: 'manuale' },
  { title: 'Firmare informativa privacy fornitori', due_date: iso(10), priority: 'bassa', source: 'email' },
];

function insertDocument(userId, clientId, kind, number, issueDate, dueDate, status, items, opts = {}) {
  const vatRate = opts.vat_rate ?? 22;
  const withholding = opts.withholding ?? 0;
  const { subtotal, vatAmount, total } = computeTotals(items, vatRate, withholding);

  const info = db.prepare(`
    INSERT INTO documents (user_id, client_id, kind, number, issue_date, due_date, status,
                           vat_rate, withholding, notes, subtotal, vat_amount, total, paid_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, clientId, kind, number, issueDate, dueDate, status, vatRate, withholding,
    opts.notes || null, subtotal, vatAmount, total, status === 'pagata' ? issueDate : null);

  const stmt = db.prepare(
    'INSERT INTO line_items (document_id, description, quantity, unit_price, position) VALUES (?,?,?,?,?)',
  );
  items.forEach((item, i) => stmt.run(info.lastInsertRowid, item.description, item.quantity, item.unit_price, i));
  return info.lastInsertRowid;
}

/**
 * Popola un nuovo account con dati dimostrativi realistici, così l'applicazione
 * non parte vuota. Si esegue una sola volta, alla registrazione.
 */
function seedDemoData(userId) {
  const already = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE user_id = ?').get(userId);
  if (already.n > 0) return;

  const clientIds = DEMO_CLIENTS.map((c) =>
    db.prepare(`
      INSERT INTO clients (user_id, name, email, phone, vat_number, address)
      VALUES (?,?,?,?,?,?)
    `).run(userId, c.name, c.email, c.phone, c.vat_number, c.address).lastInsertRowid,
  );

  const year = new Date().getFullYear();

  insertDocument(userId, clientIds[0], 'fattura', `${year}/009`, iso(-40), iso(-10), 'inviata', [
    { description: 'Progettazione identità visiva e logo', quantity: 1, unit_price: 1800 },
    { description: 'Manuale d\'uso del marchio', quantity: 1, unit_price: 600 },
  ]);

  insertDocument(userId, clientIds[1], 'fattura', `${year}/012`, iso(-18), iso(12), 'inviata', [
    { description: 'Consulenza strategica — giornate', quantity: 4, unit_price: 450 },
  ]);

  insertDocument(userId, clientIds[2], 'fattura', `${year}/011`, iso(-25), iso(-5), 'pagata', [
    { description: 'Campagna social — gestione mensile', quantity: 2, unit_price: 700 },
    { description: 'Servizio fotografico prodotti', quantity: 1, unit_price: 450 },
  ]);

  insertDocument(userId, clientIds[1], 'fattura', `${year}/013`, iso(-6), iso(24), 'pagata', [
    { description: 'Workshop formativo — giornata', quantity: 1, unit_price: 950 },
  ]);

  insertDocument(userId, clientIds[0], 'preventivo', `P-${year}/004`, iso(-3), iso(27), 'inviata', [
    { description: 'Restyling sito web — 8 pagine', quantity: 1, unit_price: 3200 },
    { description: 'Ottimizzazione SEO di base', quantity: 1, unit_price: 800 },
  ], { notes: 'Preventivo valido 30 giorni. Pagamento 50% all\'accettazione, 50% alla consegna.' });

  const emailStmt = db.prepare(`
    INSERT INTO emails (user_id, from_name, from_email, subject, body, received_at)
    VALUES (?,?,?,?,?,?)
  `);
  DEMO_EMAILS.forEach((e, i) => {
    const received = new Date();
    received.setHours(received.getHours() - (i * 5 + 2));
    emailStmt.run(userId, e.from_name, e.from_email, e.subject, e.body, received.toISOString().slice(0, 19).replace('T', ' '));
  });

  const taskStmt = db.prepare(
    'INSERT INTO tasks (user_id, title, due_date, priority, source) VALUES (?,?,?,?,?)',
  );
  DEMO_TASKS.forEach((t) => taskStmt.run(userId, t.title, t.due_date, t.priority, t.source));

  db.prepare('INSERT INTO activity (user_id, message, icon) VALUES (?,?,?)')
    .run(userId, 'Dati dimostrativi caricati: 3 clienti, 3 fatture, 1 preventivo, 5 email', 'inbox');
}

module.exports = { seedDemoData };
