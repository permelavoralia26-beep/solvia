#!/usr/bin/env node
'use strict';

/**
 * Chi comanda: assegna (o toglie) i diritti di amministratore a un account.
 *
 * L'amministratore è quello che entra nella console di direzione e nel pannello
 * newsletter. Di norma è il primo account registrato, ma se ti registri con un
 * indirizzo e poi cambi idea, senza questo strumento resteresti chiuso fuori
 * da casa tua.
 *
 * Uso:
 *   node amministratore.js                      elenca gli account
 *   node amministratore.js tua@email.it         lo rende amministratore
 *   node amministratore.js tua@email.it --togli gli toglie i diritti
 */

const { db } = require('./lib/db');

const email = process.argv[2];
const togli = process.argv.includes('--togli');

const elenca = () => {
  const righe = db.prepare(`
    SELECT id, email, name, is_admin, plan, created_at FROM users ORDER BY id
  `).all();

  if (!righe.length) {
    console.log('\n  Nessun account registrato: apri il sito e creane uno.\n');
    return;
  }

  console.log('\n  Account registrati\n  ──────────────────');
  for (const r of righe) {
    console.log(`  ${r.is_admin ? '★' : ' '} ${r.email}  (${r.name}, piano ${r.plan})`);
  }
  console.log('\n  ★ = amministratore: vede la console di direzione e la newsletter.');
  console.log('  Per cambiarlo:  node amministratore.js tua@email.it\n');
};

if (!email) {
  elenca();
  process.exit(0);
}

const utente = db.prepare('SELECT * FROM users WHERE email = ?')
  .get(String(email).toLowerCase().trim());

if (!utente) {
  console.error(`\n  Nessun account con l'indirizzo "${email}".`);
  elenca();
  process.exit(1);
}

db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(togli ? 0 : 1, utente.id);

console.log(togli
  ? `\n  ${utente.email} non è più amministratore.\n`
  : `\n  ${utente.email} ora è amministratore: può aprire la console di direzione.\n`);
