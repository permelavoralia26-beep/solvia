/**
 * Genera le pagine statiche di contenuto (legali e newsletter) da un template
 * comune, così intestazione, piè di pagina e stile restano allineati.
 *
 * Uso: node build-pages.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'public');
const LOGO = '<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#4F46E5"/><path d="M34 14 L20 36 H30 L28 50 L44 28 H34 L34 14 Z" fill="#fff"/><circle cx="47" cy="17" r="3.2" fill="#5EEAD4"/></svg>';

const UPDATED = '20 agosto 2026';

/**
 * I dati del titolare arrivano dall'ambiente, non si scrivono a mano dentro
 * l'HTML: così si impostano una volta nel pannello dell'host e le tre pagine
 * legali restano allineate fra loro. Se mancano, al posto del valore resta un
 * segnaposto ben visibile — e `controllo.js` si rifiuta di dire che è tutto a
 * posto finché non li compili.
 */
const TITOLARE = process.env.SOLVIA_TITOLARE || '[Nome e Cognome]';
const CONTATTO = process.env.SOLVIA_CONTATTO_EMAIL || '[tua-email@esempio.it]';
const INDIRIZZO = process.env.SOLVIA_INDIRIZZO || '[indirizzo, città]';
const HOSTING = process.env.SOLVIA_HOSTING || '[nome del servizio di hosting]';
const SMTP_NOME = process.env.SOLVIA_SMTP_NOME || '[nome del servizio SMTP]';

/** Il listino è acceso? Cambia cosa devono dire i termini d'uso. */
const COMMERCIALE = process.env.SOLVIA_COMMERCIAL !== 'false';

function page({ file, title, description, body, extraHead = '', extraScript = '' }) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Solvia</title>
<meta name="description" content="${description}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/css/styles.css">
<link rel="stylesheet" href="/css/pagine.css">
${extraHead}</head>
<body>

<header class="page-head">
  <div class="page-nav">
    <a class="page-brand" href="/">${LOGO} Solvia</a>
    <a class="back" href="/">← Torna al sito</a>
  </div>
</header>

${body}

<footer class="page-foot">
  <div style="margin-bottom:10px">
    <a href="/privacy.html">Privacy</a>
    <a href="/cookie.html">Cookie</a>
    <a href="/termini.html">Termini d'uso</a>
    <a href="/#newsletter">Newsletter</a>
  </div>
  ${COMMERCIALE
    ? `Solvia — servizio fornito da ${TITOLARE}${CONTATTO.startsWith('[') ? '' : ` · ${CONTATTO}`}`
    : 'Solvia — progetto personale e gratuito, senza finalità commerciali.'}
</footer>
${extraScript}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, file), html, 'utf8');
  console.log(`  generata ${file}`);
}

const MANCANO = [TITOLARE, CONTATTO, INDIRIZZO].some((v) => v.startsWith('['));

const TITOLARE_NOTE = !MANCANO ? '' : `
<div class="callout warn">
  <p><strong>Da completare prima di pubblicare.</strong> Imposta le variabili
  <code>SOLVIA_TITOLARE</code>, <code>SOLVIA_CONTATTO_EMAIL</code> e
  <code>SOLVIA_INDIRIZZO</code> nel pannello del tuo host, poi rigenera le pagine con
  <code>npm run build:pages</code>. Finché restano i campi tra parentesi quadre, questo
  riquadro resta visibile ai visitatori. Questo testo è un modello scritto su misura per come
  funziona davvero Solvia, ma non sostituisce il parere di un professionista: se il
  progetto cresce o inizi a trattare dati di terzi in modo strutturato, fallo rivedere
  a chi si occupa di protezione dei dati.</p>
</div>`;

/* ================================================================== */
/* Privacy policy                                                     */
/* ================================================================== */

page({
  file: 'privacy.html',
  title: 'Informativa privacy',
  description: 'Come Solvia tratta i dati personali: finalità, basi giuridiche, conservazione e diritti.',
  body: `
<main class="doc">
  <h1>Informativa privacy</h1>
  <p class="updated">Ultimo aggiornamento: ${UPDATED} · Regolamento UE 2016/679 (GDPR), artt. 13 e 14</p>

  ${TITOLARE_NOTE}

  <div class="toc">
    <strong>Indice</strong>
    <ol>
      <li><a href="#titolare">Chi tratta i tuoi dati</a></li>
      <li><a href="#dati">Quali dati raccogliamo</a></li>
      <li><a href="#finalita">Perché li trattiamo</a></li>
      <li><a href="#conservazione">Per quanto tempo li conserviamo</a></li>
      <li><a href="#destinatari">Chi altro li vede</a></li>
      <li><a href="#trasferimenti">Trasferimenti fuori dall'Unione Europea</a></li>
      <li><a href="#diritti">I tuoi diritti</a></li>
      <li><a href="#sicurezza">Sicurezza</a></li>
      <li><a href="#reclamo">Reclamo al Garante</a></li>
      <li><a href="#modifiche">Modifiche</a></li>
    </ol>
  </div>

  <h2 id="titolare">1. Chi tratta i tuoi dati</h2>
  <p>Il titolare del trattamento è <strong>${TITOLARE}</strong>, che gestisce Solvia
  come progetto personale, senza finalità commerciali.</p>
  <p>Per qualsiasi questione relativa ai tuoi dati puoi scrivere a
  <strong>${CONTATTO}</strong>. Rispondiamo entro un mese, come previsto dal GDPR.</p>
  <p>Non è stato nominato un Responsabile della protezione dei dati (DPO): il progetto non
  rientra nei casi in cui la nomina è obbligatoria.</p>

  <h2 id="dati">2. Quali dati raccogliamo</h2>

  <h3>Se crei un account</h3>
  <ul>
    <li><strong>Dati di registrazione:</strong> indirizzo email, nome, ed eventualmente
    nome dell'attività, partita IVA e indirizzo se scegli di inserirli.</li>
    <li><strong>Password:</strong> non viene mai conservata in chiaro. Custodiamo solo
    un'impronta crittografica (bcrypt) da cui non è possibile risalire alla password
    originale — nemmeno da parte di chi amministra il server.</li>
    <li><strong>Contenuti che inserisci tu:</strong> anagrafica clienti, preventivi,
    fatture, attività ed email che carichi nell'applicazione. Questi contenuti sono
    tuoi: non li leggiamo, non li analizziamo per finalità nostre e non li cediamo
    a nessuno.</li>
  </ul>

  <h3>Se visiti il sito</h3>
  <ul>
    <li><strong>Statistiche in casa, senza cookie.</strong> Registriamo l'apertura delle
    pagine pubbliche, il dominio da cui arrivi (per esempio "google.com", mai l'indirizzo
    completo con la ricerca che avevi digitato) e i clic sui pulsanti principali. Serve a
    capire quali parti del sito funzionano e quali no.</li>
    <li><strong>Il tuo indirizzo IP non viene conservato.</strong> Da IP e browser si
    calcola un'impronta crittografica con un elemento segreto che cambia ogni giorno:
    permette di contare quante persone diverse sono passate oggi, e nient'altro. Domani
    la stessa persona è un'impronta differente, quindi non è possibile seguirla nel tempo
    né collegarla a un'identità — nemmeno da parte di chi amministra il server.</li>
    <li><strong>Nessuno strumento di terze parti.</strong> I dati restano sul nostro
    server: non c'è Google Analytics, non ci sono pixel pubblicitari, nulla viene ceduto
    o venduto.</li>
    <li><strong>Rispettiamo il tuo rifiuto.</strong> Se il tuo browser invia "Do Not Track"
    o il Global Privacy Control, non registriamo nulla del tuo passaggio.</li>
    <li>Le statistiche vengono cancellate automaticamente dopo dodici mesi.</li>
  </ul>

  <h3>Se ti iscrivi alla newsletter</h3>
  <ul>
    <li>Indirizzo email e, facoltativamente, il nome.</li>
    <li><strong>Prova del consenso:</strong> data e ora dell'iscrizione, indirizzo IP,
    browser utilizzato e testo esatto del consenso prestato. Serve a dimostrare che
    l'iscrizione è stata richiesta davvero da te, come richiede il GDPR.</li>
    <li>Data della conferma e, se ti disiscrivi, data della disiscrizione.</li>
  </ul>

  <h3>Dati tecnici</h3>
  <ul>
    <li>Un <strong>cookie tecnico di sessione</strong> che ti tiene collegato. Non serve
    a profilarti. Dettagli nella <a href="/cookie.html">cookie policy</a>.</li>
    <li>I normali log del server (indirizzo IP, data e ora, pagina richiesta), generati
    automaticamente e necessari al funzionamento e alla sicurezza.</li>
  </ul>

  <div class="callout">
    <p><strong>Cosa non facciamo.</strong> Nessun sistema di tracciamento pubblicitario,
    nessuna profilazione, nessuna vendita o cessione di dati a terzi, nessuna decisione
    automatizzata che produca effetti giuridici su di te.</p>
  </div>

  <h2 id="finalita">3. Perché li trattiamo</h2>
  <table>
    <thead><tr><th>Finalità</th><th>Base giuridica</th></tr></thead>
    <tbody>
      <tr><td>Creare e gestire il tuo account, farti usare l'applicazione</td>
          <td>Esecuzione del contratto — art. 6(1)(b)</td></tr>
      <tr><td>Conservare i contenuti che inserisci (clienti, documenti, attività)</td>
          <td>Esecuzione del contratto — art. 6(1)(b)</td></tr>
      <tr><td>Inviarti la newsletter</td>
          <td>Tuo consenso — art. 6(1)(a), revocabile in ogni momento</td></tr>
      <tr><td>Conservare la prova del consenso alla newsletter</td>
          <td>Obbligo di rendicontazione — art. 5(2) e art. 7(1)</td></tr>
      <tr><td>Sicurezza del servizio e prevenzione degli abusi</td>
          <td>Legittimo interesse — art. 6(1)(f)</td></tr>
    </tbody>
  </table>

  <h2 id="conservazione">4. Per quanto tempo li conserviamo</h2>
  <ul>
    <li><strong>Dati dell'account e contenuti:</strong> finché tieni l'account attivo.
    Quando lo elimini, vengono cancellati immediatamente e in modo irreversibile.</li>
    <li><strong>Iscrizione alla newsletter:</strong> finché resti iscritto. Se ti
    disiscrivi, manteniamo l'indirizzo in un elenco di esclusione per non riscriverti
    per errore; puoi chiedere la cancellazione totale dal link nella pagina di
    disiscrizione.</li>
    <li><strong>Iscrizioni mai confermate:</strong> restano in sospeso e non ricevono
    alcuna comunicazione.</li>
    <li><strong>Log del server:</strong> tempo tecnico necessario, di norma pochi giorni.</li>
  </ul>

  <h2 id="destinatari">5. Chi altro li vede</h2>
  <p>Nessuno, salvo i fornitori tecnici indispensabili al funzionamento, che agiscono
  come responsabili del trattamento e solo secondo le nostre istruzioni:</p>
  <ul>
    <li><strong>Fornitore di hosting</strong> — <em>${HOSTING}</em> —
    ospita l'applicazione e il database.</li>
    <li><strong>Servizio di invio email</strong> — <em>${SMTP_NOME}</em> —
    recapita le email di conferma e la newsletter. Attivo solo se l'invio email è configurato.</li>
    <li><strong>Anthropic</strong> — solo se l'assistente con modello linguistico è
    attivato dall'amministratore. In quel caso il testo delle email che analizzi viene
    inviato per l'elaborazione. <strong>Nella configurazione predefinita questa funzione
    è spenta</strong> e l'assistente lavora con regole locali, senza che nessun dato
    esca dal server.</li>
  </ul>

  <h2 id="trasferimenti">6. Trasferimenti fuori dall'Unione Europea</h2>
  <p>Se un fornitore tra quelli sopra elencati tratta dati fuori dallo Spazio Economico
  Europeo, il trasferimento avviene sulla base delle Clausole Contrattuali Standard
  approvate dalla Commissione Europea o di una decisione di adeguatezza. Puoi chiederci
  copia delle garanzie applicate scrivendo all'indirizzo indicato al punto 1.</p>

  <h2 id="diritti">7. I tuoi diritti</h2>
  <p>Il GDPR ti riconosce il diritto di <strong>accedere</strong> ai tuoi dati (art. 15),
  <strong>rettificarli</strong> (art. 16), <strong>cancellarli</strong> (art. 17),
  <strong>limitarne</strong> il trattamento (art. 18), <strong>riceverli</strong> in
  formato leggibile e trasferibile (art. 20), <strong>opporti</strong> al trattamento
  fondato sul legittimo interesse (art. 21) e <strong>revocare il consenso</strong>
  in qualsiasi momento (art. 7).</p>

  <div class="callout">
    <p><strong>Non devi scrivere a nessuno per esercitarli.</strong> Dentro l'applicazione,
    in <em>Impostazioni → I tuoi dati</em>, trovi due pulsanti: <em>Scarica i miei dati</em>,
    che ti restituisce tutto in un file leggibile, e <em>Elimina account</em>, che cancella
    tutto in modo definitivo. Per la newsletter, il link di disiscrizione è in fondo a ogni
    email e funziona con un clic solo.</p>
  </div>

  <h2 id="sicurezza">8. Sicurezza</h2>
  <ul>
    <li>Password protette con bcrypt, mai leggibili in chiaro.</li>
    <li>Sessioni gestite con cookie <code>httpOnly</code>, non accessibili al codice
    JavaScript della pagina, per ridurre il rischio di furto della sessione. Al cambio
    password tutte le sessioni aperte altrove decadono automaticamente.</li>
    <li><strong>Recupero password:</strong> il link inviato per email vale un'ora e una
    volta sola. Nel database non finisce il link, ma solo la sua impronta crittografica:
    nemmeno chi leggesse la tabella potrebbe usarlo per entrare.</li>
    <li><strong>Tentativi di accesso:</strong> dopo cinque password sbagliate di seguito
    l'accesso a quell'account viene sospeso per quindici minuti. Il conteggio sta in
    memoria, non viene salvato e non produce alcun profilo dell'utente.</li>
    <li>Tutte le interrogazioni al database usano parametri separati dal codice, per
    prevenire attacchi di tipo SQL injection.</li>
    <li>Ogni dato è isolato per utente: nessun account può accedere ai contenuti di un
    altro, e questa separazione è verificata da test automatici a ogni modifica del codice.</li>
    <li>In produzione il sito va servito esclusivamente via HTTPS.</li>
    <li>Le statistiche di visita non contengono indirizzi IP: solo impronte
    crittografiche a validità giornaliera, non riconducibili a una persona.</li>
  </ul>

  <h2 id="reclamo">9. Reclamo al Garante</h2>
  <p>Se ritieni che il trattamento dei tuoi dati violi il GDPR, puoi proporre reclamo al
  <strong>Garante per la protezione dei dati personali</strong> (Piazza Venezia 11, 00187
  Roma — <a href="https://www.garanteprivacy.it" target="_blank" rel="noopener">garanteprivacy.it</a>),
  fermo restando ogni altra azione in sede giudiziaria.</p>

  <h2 id="modifiche">10. Modifiche</h2>
  <p>Se questa informativa cambia, aggiorniamo la data in cima alla pagina. Se le
  modifiche riguardano in modo sostanziale il trattamento dei tuoi dati, te lo comunichiamo
  via email prima che diventino efficaci.</p>
</main>`,
});

/* ================================================================== */
/* Cookie policy                                                      */
/* ================================================================== */

page({
  file: 'cookie.html',
  title: 'Cookie policy',
  description: 'Quali cookie usa Solvia: solo un cookie tecnico di sessione, nessun tracciamento.',
  body: `
<main class="doc">
  <h1>Cookie policy</h1>
  <p class="updated">Ultimo aggiornamento: ${UPDATED}</p>

  <div class="callout">
    <p><strong>In breve: Solvia usa un solo cookie, e serve a tenerti collegato.</strong>
    Nessun cookie pubblicitario, nessuna analisi del comportamento, nessun servizio di terze
    parti che ti segue tra un sito e l'altro.</p>
  </div>

  <h2>Perché non vedi il banner dei cookie</h2>
  <p>Le linee guida del Garante privacy prevedono che i <strong>cookie tecnici</strong> —
  quelli strettamente necessari a erogare il servizio che hai richiesto — non richiedano
  il consenso preventivo, ma solo di essere spiegati in un'informativa come questa.</p>
  <p>Solvia usa esclusivamente cookie di questo tipo. Il banner che ti chiede di accettare
  serve a chi installa cookie di profilazione o statistici di terze parti: qui non ce ne
  sono, quindi il banner sarebbe una richiesta di consenso per qualcosa che non facciamo.</p>

  <h2>Il cookie che usiamo</h2>
  <table>
    <thead><tr><th>Nome</th><th>Tipo</th><th>A cosa serve</th><th>Durata</th></tr></thead>
    <tbody>
      <tr>
        <td><code>solvia_token</code></td>
        <td>Tecnico<br>(prima parte)</td>
        <td>Ti mantiene collegato mentre usi l'applicazione. Senza, dovresti inserire
        la password a ogni pagina. Contiene un identificativo firmato della sessione,
        non i tuoi dati personali.</td>
        <td>7 giorni,<br>o fino al logout</td>
      </tr>
    </tbody>
  </table>

  <p>Il cookie è impostato con l'attributo <code>httpOnly</code>, quindi non è leggibile
  dal codice JavaScript della pagina, e con <code>sameSite=lax</code>, che impedisce che
  venga inviato da altri siti. In produzione viaggia solo su connessione HTTPS.</p>

  <h2>Cosa non troverai</h2>
  <ul>
    <li>Nessun cookie di profilazione o pubblicitario.</li>
    <li>Nessuno strumento di statistiche di terze parti (né Google Analytics né equivalenti).</li>
    <li>Le statistiche di visita sono nostre e <strong>non usano cookie</strong>: contano
    le persone con un'impronta calcolata al volo dal server, che cambia ogni giorno e non
    resta sul tuo dispositivo. Per questo non serve chiederti il consenso — e se il tuo
    browser invia "Do Not Track" o il Global Privacy Control, non contiamo nemmeno quella.
    I dettagli sono nell'<a href="/privacy.html">informativa privacy</a>.</li>
    <li>Nessun pulsante social che carichi codice esterno.</li>
    <li>Nessun pixel di tracciamento nelle email.</li>
  </ul>

  <h2>Come rimuoverlo</h2>
  <p>Puoi cancellare il cookie in qualsiasi momento facendo <strong>logout</strong>, oppure
  eliminando i dati del sito dalle impostazioni del tuo browser. Bloccando i cookie tecnici
  l'accesso all'applicazione smette di funzionare, perché non sarebbe più possibile
  riconoscerti tra una pagina e l'altra.</p>

  <p>Per il trattamento dei dati personali in generale, vedi l'
  <a href="/privacy.html">informativa privacy</a>.</p>
</main>`,
});

/* ================================================================== */
/* Termini d'uso                                                      */
/* ================================================================== */

page({
  file: 'termini.html',
  title: "Termini d'uso",
  description: "Condizioni d'uso di Solvia: progetto personale gratuito, senza garanzie commerciali.",
  body: `
<main class="doc">
  <h1>Termini d'uso</h1>
  <p class="updated">Ultimo aggiornamento: ${UPDATED}</p>

  ${TITOLARE_NOTE}

  <h2>1. Cos'è Solvia e chi lo fornisce</h2>
  ${COMMERCIALE ? `
  <p>Solvia è un servizio web fornito da <strong>${TITOLARE}</strong>${
  INDIRIZZO.startsWith('[') ? '' : `, ${INDIRIZZO}`}, contattabile all'indirizzo
  <strong>${CONTATTO}</strong>.</p>
  <p>Il servizio è disponibile in un <strong>piano gratuito</strong>, utilizzabile senza
  limiti di tempo e senza inserire dati di pagamento, e in <strong>piani a pagamento</strong>
  con canone mensile, descritti nella pagina dei prezzi.</p>`
  : `
  <p>Solvia è un <strong>progetto personale</strong> sviluppato e messo a disposizione
  gratuitamente da <strong>${TITOLARE}</strong>. Non è un'attività commerciale, non
  viene venduto e non prevede corrispettivi di alcun tipo.</p>`}
  <p>Usando il servizio accetti queste condizioni. Se non le condividi, non usarlo.</p>

  <h2>2. Come viene fornito il servizio</h2>
  ${COMMERCIALE ? `
  <p>Il <strong>piano gratuito</strong> è offerto "così com'è", senza garanzie di
  funzionamento continuo o di assenza di errori.</p>
  <p>Per i <strong>piani a pagamento</strong> il titolare si impegna a mantenere il
  servizio funzionante e a intervenire in tempi ragionevoli sui malfunzionamenti
  segnalati. Restano ferme le garanzie previste dalla legge, che non vengono escluse.
  In ogni caso:</p>`
  : `
  <p>Solvia è offerto senza alcuna garanzia, espressa o implicita, di funzionamento
  continuo, assenza di errori, o idoneità a uno scopo specifico. Trattandosi di un
  progetto personale gratuito:</p>`}
  <ul>
    <li>può essere modificato, sospeso o interrotto in qualsiasi momento, anche senza preavviso;</li>
    <li>non è previsto alcun livello di servizio garantito né assistenza obbligatoria;</li>
    <li>possono verificarsi malfunzionamenti, interruzioni o perdite di dati.</li>
  </ul>

  <div class="callout warn">
    <p><strong>Tieni sempre una copia dei tuoi dati.</strong> Puoi scaricarli quando vuoi
    da <em>Impostazioni → Scarica i miei dati</em>. Non fare affidamento su Solvia come
    unico archivio di documenti che ti servono davvero.</p>
  </div>

  <h2>3. Non è un servizio di fatturazione elettronica</h2>
  <p>I documenti PDF generati da Solvia sono <strong>documenti di cortesia</strong>. Non
  costituiscono fatture elettroniche valide ai fini fiscali e non vengono trasmessi al
  Sistema di Interscambio (SDI) dell'Agenzia delle Entrate.</p>
  <p>Per gli adempimenti fiscali devi usare i canali previsti dalla legge e confrontarti
  con il tuo commercialista. I calcoli di IVA e ritenuta prodotti dall'applicazione sono
  uno strumento di supporto e vanno sempre verificati: la responsabilità della correttezza
  fiscale dei tuoi documenti resta interamente tua.</p>

  <h2>4. Le tue responsabilità</h2>
  <ul>
    <li>Custodire le credenziali di accesso e non condividerle.</li>
    <li>Inserire solo dati che hai il diritto di trattare. Se carichi dati dei tuoi
    clienti, <strong>il titolare del trattamento di quei dati sei tu</strong>: sei tenuto
    a informarli e ad avere una base giuridica adeguata.</li>
    <li>Non usare il servizio per attività illecite, per inviare comunicazioni indesiderate
    o per tentare di accedere a dati di altri utenti.</li>
    <li>Non sovraccaricare deliberatamente l'infrastruttura.</li>
  </ul>

  <h2>5. Limitazione di responsabilità</h2>
  <p>Nei limiti consentiti dalla legge applicabile, il titolare non risponde di danni
  diretti o indiretti derivanti dall'uso o dal mancato funzionamento del servizio,
  inclusi perdita di dati, mancato guadagno, errori nei documenti generati o conseguenze
  fiscali.</p>
  <p>Restano ferme le responsabilità che la legge non consente di escludere, in particolare
  in caso di dolo o colpa grave.</p>

  <h2>6. Abbonamenti, disdetta e rimborsi</h2>
  ${COMMERCIALE ? `
  <p><strong>Il piano gratuito non richiede alcun pagamento</strong> e non chiede dati di
  pagamento: se resti su quello, non c'è nulla da disdire e nulla da rimborsare.</p>

  <h3>Come funziona l'abbonamento</h3>
  <ul>
    <li>Il canone è <strong>mensile e anticipato</strong>, agli importi indicati nella
    pagina dei prezzi. Gli importi si intendono comprensivi delle imposte applicabili.</li>
    <li>Il rinnovo è <strong>automatico</strong> ogni mese, finché non disdici.</li>
    <li>Puoi <strong>disdire quando vuoi</strong>, dall'applicazione, senza dare
    spiegazioni e senza penali. La disdetta ha effetto alla fine del periodo già pagato:
    fino a quel giorno continui a usare le funzioni del piano.</li>
    <li>Alla scadenza l'account <strong>non viene cancellato</strong>: torna al piano
    gratuito, e i tuoi dati restano dove sono. Restano validi i limiti del piano
    gratuito.</li>
  </ul>

  <h3>Diritto di recesso</h3>
  <p>Se sei un <strong>consumatore</strong> ai sensi del Codice del Consumo, hai diritto di
  recedere entro <strong>14 giorni</strong> dall'acquisto senza doverne indicare il motivo,
  scrivendo a ${CONTATTO}. Se in quel periodo hai già usato il servizio, potremo trattenere
  un importo proporzionato a quanto usufruito.</p>
  <p>La maggior parte di chi usa Solvia lo fa nell'esercizio della propria attività
  professionale: in quel caso il diritto di recesso del consumatore non si applica, ma
  resta valida la disdetta libera descritta sopra.</p>

  <h3>Variazioni di prezzo</h3>
  <p>I prezzi possono cambiare. Le variazioni vengono comunicate <strong>almeno 30 giorni
  prima</strong> all'indirizzo email dell'account e si applicano dal rinnovo successivo:
  se non ti stanno bene, puoi disdire prima che abbiano effetto.</p>

  <h3>Se il servizio viene interrotto</h3>
  <p>Se il servizio dovesse chiudere, riceverai un preavviso ragionevole per esportare i
  tuoi dati e <strong>la parte di canone non goduta ti verrà restituita</strong>.</p>`
  : `
  <p><strong>Solvia è gratuito: non essendoci pagamenti, non c'è nulla da rimborsare.</strong>
  Non vengono richiesti dati di pagamento e non vengono effettuati addebiti.</p>
  <p>Se in futuro venissero attivate funzioni a pagamento, la sezione sarà aggiornata prima
  dell'attivazione e si applicheranno le tutele previste dal Codice del Consumo, tra cui il
  <strong>diritto di recesso entro 14 giorni</strong> dall'acquisto per i consumatori.
  Nessuna funzione a pagamento è attiva oggi.</p>`}

  <h2>7. Newsletter</h2>
  <p>L'iscrizione è volontaria e richiede una conferma esplicita dall'indirizzo indicato.
  Puoi disiscriverti con un clic dal link presente in fondo a ogni email, senza doverci
  contattare e senza motivazione.</p>

  <h2>8. Proprietà intellettuale</h2>
  <p>Il codice sorgente di Solvia è distribuito con licenza MIT: puoi consultarlo, usarlo
  e modificarlo nei termini di quella licenza. <strong>I contenuti che inserisci restano
  tuoi</strong>: non ne acquisiamo alcun diritto e non li usiamo per finalità diverse
  dall'erogazione del servizio.</p>

  <h2>9. Chiusura dell'account</h2>
  <p>Puoi eliminare il tuo account in qualsiasi momento da <em>Impostazioni</em>: la
  cancellazione è immediata e definitiva. Il titolare può sospendere gli account che
  violino queste condizioni o mettano a rischio il funzionamento del servizio.</p>

  <h2>10. Modifiche e legge applicabile</h2>
  <p>Queste condizioni possono essere aggiornate; la data in cima indica l'ultima revisione,
  e le modifiche rilevanti vengono comunicate via email agli utenti registrati.</p>
  <p>Si applica la legge italiana. Per i consumatori resta competente il foro del luogo di
  residenza o domicilio, come previsto dal Codice del Consumo.</p>

  <p style="margin-top:26px">Vedi anche l'<a href="/privacy.html">informativa privacy</a>
  e la <a href="/cookie.html">cookie policy</a>.</p>
</main>`,
});

/* ================================================================== */
/* Conferma iscrizione newsletter                                     */
/* ================================================================== */

page({
  file: 'newsletter-conferma.html',
  title: 'Conferma iscrizione',
  description: 'Conferma della tua iscrizione alla newsletter di Solvia.',
  body: `
<main class="result" id="result">
  <div class="loading"><div class="spinner dark"></div></div>
</main>`,
  extraScript: `<script>
(async function () {
  const box = document.getElementById('result');
  const token = new URLSearchParams(location.search).get('t');

  if (!token) {
    box.innerHTML = '<div class="icon ko">×</div><h1>Link non valido</h1>'
      + '<p>Manca il codice di conferma. Controlla di aver aperto il link completo che ti abbiamo inviato via email.</p>'
      + '<a class="btn btn-primary btn-pill" href="/">Torna al sito</a>';
    return;
  }

  try {
    const res = await fetch('/api/newsletter/confirm?t=' + encodeURIComponent(token));
    const data = await res.json();

    if (data.ok) {
      box.innerHTML = '<div class="icon ok">✓</div>'
        + '<h1>' + (data.already ? 'Eri già iscritto' : 'Iscrizione confermata') + '</h1>'
        + '<p>' + (data.already
            ? 'Il tuo indirizzo era già confermato: non devi fare altro.'
            : 'Perfetto, ci siamo. Ti scriverò quando c\\'è qualcosa di utile da raccontare, non per riempirti la casella.')
        + '</p>'
        + '<p style="font-size:13.5px">Puoi disiscriverti quando vuoi dal link in fondo a ogni email.</p>'
        + '<a class="btn btn-primary btn-pill" href="/">Torna al sito</a>';
    } else {
      box.innerHTML = '<div class="icon ko">×</div><h1>Conferma non riuscita</h1>'
        + '<p>' + (data.error || 'Il link non è valido o è già stato usato.') + '</p>'
        + '<a class="btn btn-primary btn-pill" href="/#newsletter">Iscriviti di nuovo</a>';
    }
  } catch {
    box.innerHTML = '<div class="icon ko">×</div><h1>Qualcosa è andato storto</h1>'
      + '<p>Riprova tra qualche minuto.</p>'
      + '<a class="btn btn-primary btn-pill" href="/">Torna al sito</a>';
  }
})();
</script>`,
});

/* ================================================================== */
/* Disiscrizione newsletter                                           */
/* ================================================================== */

page({
  file: 'newsletter-disiscrizione.html',
  title: 'Disiscrizione',
  description: 'Disiscriviti dalla newsletter di Solvia.',
  body: `
<main class="result" id="result">
  <div class="loading"><div class="spinner dark"></div></div>
</main>`,
  extraScript: `<script>
(async function () {
  const box = document.getElementById('result');
  const token = new URLSearchParams(location.search).get('t');

  if (!token) {
    box.innerHTML = '<div class="icon ko">×</div><h1>Link non valido</h1>'
      + '<p>Manca il codice. Usa il link di disiscrizione che trovi in fondo alla newsletter.</p>';
    return;
  }

  // La disiscrizione avviene subito all'apertura del link: un clic solo, come richiesto.
  try {
    const res = await fetch('/api/newsletter/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    });
    const data = await res.json();

    if (!data.ok) {
      box.innerHTML = '<div class="icon ko">×</div><h1>Disiscrizione non riuscita</h1>'
        + '<p>' + (data.error || 'Il link non è valido.') + '</p>';
      return;
    }

    box.innerHTML = '<div class="icon ok">✓</div><h1>Disiscritto</h1>'
      + '<p>Non riceverai più la newsletter. Nessuna domanda, nessun modulo da compilare.</p>'
      + '<p style="font-size:13.5px">Conserviamo il tuo indirizzo solo per non riscriverti per sbaglio. '
      + 'Se preferisci che sparisca del tutto, cancellalo qui sotto.</p>'
      + '<button class="btn btn-ghost btn-pill" id="erase">Cancella del tutto il mio indirizzo</button>'
      + '<div style="margin-top:16px"><a class="back" href="/" style="font-size:13.5px;color:var(--muted)">Torna al sito</a></div>';

    document.getElementById('erase').addEventListener('click', async function (e) {
      e.target.disabled = true;
      e.target.textContent = 'Cancellazione…';
      const r = await fetch('/api/newsletter/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
      });
      const d = await r.json();
      box.innerHTML = d.ok
        ? '<div class="icon ok">✓</div><h1>Indirizzo cancellato</h1>'
          + '<p>Il tuo indirizzo è stato rimosso definitivamente dai nostri archivi, come previsto dall\\'art. 17 del GDPR.</p>'
          + '<a class="btn btn-primary btn-pill" href="/">Torna al sito</a>'
        : '<div class="icon ko">×</div><h1>Cancellazione non riuscita</h1><p>Riprova più tardi.</p>';
    });
  } catch {
    box.innerHTML = '<div class="icon ko">×</div><h1>Qualcosa è andato storto</h1><p>Riprova tra qualche minuto.</p>';
  }
})();
</script>`,
});

console.log('\nPagine generate in public/\n');
