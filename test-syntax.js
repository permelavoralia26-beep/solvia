/**
 * Controlla la sintassi di tutto il JavaScript del progetto, incluso quello
 * scritto dentro i tag <script> delle pagine HTML.
 *
 * Serve a intercettare errori che il browser scopre solo a pagina aperta —
 * per esempio un apostrofo protetto male dentro una stringa, che manda in
 * pezzi l'intero script della pagina senza che nulla lo segnali prima.
 *
 * Non richiede un server in esecuzione.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0; let fail = 0;
const ok = (label) => { pass += 1; console.log(`  \x1b[32m✓\x1b[0m ${label}`); };
const ko = (label, detail) => { fail += 1; console.log(`  \x1b[31m✗\x1b[0m ${label} — ${detail}`); };

console.log('\nControllo sintassi\n────────────────────────────────────────');

/* --- Moduli del server --- */
const serverFiles = [
  'server.js', 'build-pages.js',
  ...fs.readdirSync('lib').map((f) => path.join('lib', f)),
  ...fs.readdirSync('routes').map((f) => path.join('routes', f)),
].filter((f) => f.endsWith('.js'));

for (const file of serverFiles) {
  try {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    ok(file);
  } catch (e) {
    ko(file, e.message);
  }
}

/* --- JavaScript del browser: file esterni --- */
const jsDir = path.join('public', 'js');
if (fs.existsSync(jsDir)) {
  for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'))) {
    const file = path.join(jsDir, f);
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
      ok(file);
    } catch (e) {
      ko(file, e.message);
    }
  }
}

/* --- JavaScript scritto dentro le pagine HTML --- */
// La console di direzione sta fuori da public/ apposta, ma il suo codice va
// controllato come tutti gli altri.
const paginePages = [
  ...fs.readdirSync('public').filter((x) => x.endsWith('.html')).map((f) => path.join('public', f)),
  ...(fs.existsSync('riservato')
    ? fs.readdirSync('riservato').filter((x) => x.endsWith('.html')).map((f) => path.join('riservato', f))
    : []),
];
for (const file of paginePages) {
  const html = fs.readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

  if (!blocks.length) { ok(`${file} (nessuno script interno)`); continue; }

  let broken = null;
  blocks.forEach((block, i) => {
    if (broken) return;
    try {
      new vm.Script(block[1], { filename: `${file}#script${i + 1}` });
    } catch (e) {
      broken = `blocco ${i + 1}: ${e.message}`;
    }
  });

  if (broken) ko(file, broken);
  else ok(`${file} (${blocks.length} script)`);
}

console.log('────────────────────────────────────────');
console.log(`  ${pass} file validi, ${fail} con errori\n`);
process.exit(fail === 0 ? 0 : 1);
