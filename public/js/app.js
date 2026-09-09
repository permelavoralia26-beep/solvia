'use strict';

/* ================================================================
   Solvia — applicazione client
   ================================================================ */

const state = { user: null, view: 'dashboard', cache: {}, prelancio: false };

/* ----------------------------- API ----------------------------- */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/accedi'; throw new Error('Non autenticato'); }
  const data = await res.json().catch(() => ({}));

  // 402 = limite del piano raggiunto: mostra la proposta di passaggio a Pro
  // invece di un errore generico.
  if (res.status === 402 && data.upgrade) {
    upgradeModal(data.error, data.prelancio);
    const err = new Error(data.error);
    err.handled = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || 'Si è verificato un errore');
  return data;
}

/* --------------------------- Utility --------------------------- */

const eur = (n) => new Intl.NumberFormat('it-IT',
  { style: 'currency', currency: 'EUR', useGrouping: true }).format(Number(n) || 0);
const eur0 = (n) => new Intl.NumberFormat('it-IT',
  { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: true }).format(Number(n) || 0);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dmy(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function relativeTime(value) {
  const then = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min fa`;
  if (mins < 1440) return `${Math.round(mins / 60)} h fa`;
  return `${Math.round(mins / 1440)} g fa`;
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; };

const STATUS_BADGE = {
  bozza: ['badge-gray', 'Bozza'],
  inviata: ['badge-blue', 'Inviata'],
  accettata: ['badge-green', 'Accettata'],
  rifiutata: ['badge-red', 'Rifiutata'],
  pagata: ['badge-green', 'Pagata'],
};
function statusBadge(status, overdue) {
  if (overdue) return '<span class="badge badge-red">Scaduta</span>';
  const [cls, label] = STATUS_BADGE[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

const PRIORITY_BADGE = {
  alta: ['badge-red', 'Alta'], media: ['badge-amber', 'Media'], bassa: ['badge-gray', 'Bassa'],
};
function priorityBadge(p) {
  const [cls, label] = PRIORITY_BADGE[p] || PRIORITY_BADGE.media;
  return `<span class="badge ${cls}">${label}</span>`;
}

const CATEGORY_LABEL = {
  richiesta_preventivo: 'Richiesta preventivo', pagamento: 'Pagamento / fattura',
  appuntamento: 'Appuntamento', progetto: 'Progetto', amministrativo: 'Amministrativo',
  da_smistare: 'Da smistare',
};

/* ---------------------- Toast e modale ---------------------- */

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal({ title, body, footer, wide = false }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-foot').innerHTML = footer || '';
  document.getElementById('modal').classList.toggle('wide', wide);
  document.getElementById('modal-backdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function emptyState(message, actionLabel, actionId) {
  return `<div class="empty">
    <svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M4 7l8 6 8-6"/></svg>
    <p>${esc(message)}</p>
    ${actionLabel ? `<button class="btn btn-primary btn-sm" id="${actionId}">${esc(actionLabel)}</button>` : ''}
  </div>`;
}

const setContent = (html) => { document.getElementById('content').innerHTML = html; };
const setLoading = () => setContent('<div class="loading"><div class="spinner dark"></div></div>');

function setHeader(title, sub, actions = '') {
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub || '';
  document.getElementById('page-actions').innerHTML = actions;
}

/* ======================== PRIMO ACCESSO ======================== */

/**
 * Chi si è appena registrato non vede la dashboard: vede questa.
 * Lo stato vero sta sul server (users.onboarded_at), qui teniamo solo il passo
 * corrente — ricaricando la pagina si riparte dal punto giusto, perché ogni
 * passo salva subito.
 */
let onbPasso = 1;

const ONB_PASSI = [
  { n: 1, titolo: 'Da dove parti' },
  { n: 2, titolo: 'I tuoi dati' },
  { n: 3, titolo: 'Il fisco' },
];

function onbBarra() {
  return `<div class="onb-steps">${ONB_PASSI.map((p) => `
    <div class="onb-step ${p.n === onbPasso ? 'active' : ''} ${p.n < onbPasso ? 'done' : ''}">
      <span class="onb-num">${p.n < onbPasso ? '✓' : p.n}</span>${p.titolo}
    </div>`).join('')}</div>`;
}

async function viewBenvenuto() {
  setLoading();
  const stato = await api('/onboarding');

  // Configurazione già completata: non c'è motivo di restare qui.
  if (stato.completato) { state.user.onboarded = true; return navigate('dashboard'); }

  const nome = state.user.name.split(' ')[0];
  setHeader(`Benvenuto, ${nome}`, 'Tre passi e Solvia è pronto su misura per te.');
  document.getElementById('page-actions').innerHTML = '';

  if (onbPasso === 1) return onbPasso1(stato);
  if (onbPasso === 2) return onbPasso2();
  return onbPasso3();
}

/* Passo 1 — account vuoto oppure con dati di esempio da esplorare */
function onbPasso1(stato) {
  setContent(`
    ${onbBarra()}
    <div class="onb-card">
      <h2>Vuoi guardarti intorno, o partire subito col tuo lavoro?</h2>
      <p class="onb-lead">Puoi cambiare idea dopo: i dati di esempio si cancellano
        con un clic dalle Impostazioni.</p>

      <div class="onb-choices">
        <button class="onb-choice" id="onb-esempi" ${stato.demo ? 'disabled' : ''}>
          <span class="onb-choice-tag">Consigliato la prima volta</span>
          <strong>Con dati di esempio</strong>
          <span>Tre clienti, qualche fattura, preventivi e cinque email da smistare.
            Vedi come funziona tutto senza dover inventare nulla.</span>
        </button>
        <button class="onb-choice" id="onb-vuoto">
          <strong>Account vuoto</strong>
          <span>Nessun dato finto. Inserisci il primo cliente e cominci
            a fatturare davvero da subito.</span>
        </button>
      </div>
    </div>`);

  const avanti = async (modo) => {
    await api('/onboarding/dati', { method: 'POST', body: { modo } });
    onbPasso = 2;
    viewBenvenuto();
  };
  document.getElementById('onb-esempi').addEventListener('click', () => avanti('esempi'));
  document.getElementById('onb-vuoto').addEventListener('click', () => avanti('vuoto'));
}

/* Passo 2 — i dati che finiscono stampati su fatture e preventivi */
function onbPasso2() {
  const u = state.user;
  setContent(`
    ${onbBarra()}
    <div class="onb-card">
      <h2>Cosa scriviamo sulle tue fatture</h2>
      <p class="onb-lead">Compaiono in alto su ogni documento che mandi.
        Puoi lasciare vuoto e completare dopo.</p>

      <div class="grid grid-2">
        <div class="field"><label for="onb-nome">Nome e cognome</label>
          <input class="input" id="onb-nome" value="${esc(u.name)}"></div>
        <div class="field"><label for="onb-attivita">Attività / studio</label>
          <input class="input" id="onb-attivita" value="${esc(u.business_name || '')}"
            placeholder="Studio Rossi"></div>
        <div class="field"><label for="onb-piva">Partita IVA</label>
          <input class="input" id="onb-piva" value="${esc(u.vat_number || '')}"
            placeholder="IT01234567890"></div>
        <div class="field"><label for="onb-iva">IVA predefinita %</label>
          <input class="input" type="number" id="onb-iva" value="${u.default_vat ?? 22}"></div>
      </div>
      <div class="field"><label for="onb-indirizzo">Indirizzo</label>
        <input class="input" id="onb-indirizzo" value="${esc(u.address || '')}"
          placeholder="Via Roma 1, 20121 Milano"></div>
      <div class="field"><label for="onb-tariffa">Tariffa oraria €</label>
        <input class="input" type="number" id="onb-tariffa" value="${u.hourly_rate || 0}">
        <p class="hint">Serve al cronometro: le ore registrate diventano fatture da sole.</p></div>

      <div class="onb-actions">
        <button class="btn btn-ghost" id="onb-indietro">← Indietro</button>
        <button class="btn btn-primary" id="onb-salva">Continua</button>
      </div>
    </div>`);

  document.getElementById('onb-indietro').addEventListener('click', () => {
    onbPasso = 1; viewBenvenuto();
  });
  document.getElementById('onb-salva').addEventListener('click', async () => {
    const { user } = await api('/auth/me', {
      method: 'PUT',
      body: {
        name: document.getElementById('onb-nome').value.trim(),
        business_name: document.getElementById('onb-attivita').value.trim(),
        vat_number: document.getElementById('onb-piva').value.trim(),
        address: document.getElementById('onb-indirizzo').value.trim(),
        default_vat: Number(document.getElementById('onb-iva').value),
        hourly_rate: Number(document.getElementById('onb-tariffa').value),
      },
    });
    state.user = user;
    renderUserChip();
    onbPasso = 3;
    viewBenvenuto();
  });
}

/* Passo 3 — regime fiscale, per la stima di quanto accantonare */
async function onbPasso3() {
  const d = await api('/finance/tax');
  setContent(`
    ${onbBarra()}
    <div class="onb-card">
      <h2>Quanto devi mettere da parte</h2>
      <p class="onb-lead">Con questi tre valori Solvia ti dice, mese per mese, quanta parte
        di quello che incassi non è tua. Se non sei sicuro lascia i predefiniti:
        si cambiano quando vuoi.</p>

      <div class="grid grid-2">
        <div class="field"><label for="onb-regime">Regime</label>
          <select class="input" id="onb-regime">
            <option value="forfettario">Forfettario</option>
            <option value="ordinario" ${d.settings.tax_regime === 'ordinario' ? 'selected' : ''}>Ordinario (stima grezza)</option>
          </select></div>
        <div class="field"><label for="onb-aliquota">Imposta sostitutiva</label>
          <select class="input" id="onb-aliquota">
            <option value="5">5% — primi 5 anni di attività</option>
            <option value="15" ${Number(d.settings.tax_rate) === 15 ? 'selected' : ''}>15% — ordinaria</option>
          </select></div>
      </div>
      <div class="field"><label for="onb-cassa">Cassa previdenziale</label>
        <select class="input" id="onb-cassa">
          ${d.options.map((o) => `<option value="${o.id}"
            ${d.settings.inps_type === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <p class="hint">Gestione Separata è quella di chi non ha una cassa di categoria.</p></div>

      <p class="hint onb-avviso"><strong>È una stima.</strong> Aliquote e minimali cambiano ogni
        anno e il coefficiente dipende dal codice ATECO. Serve a sapere quanto non spendere,
        non a compilare l'F24.</p>

      <div class="onb-actions">
        <button class="btn btn-ghost" id="onb-indietro">← Indietro</button>
        <button class="btn btn-primary" id="onb-fine">Entra in Solvia</button>
      </div>
    </div>`);

  document.getElementById('onb-indietro').addEventListener('click', () => {
    onbPasso = 2; viewBenvenuto();
  });
  document.getElementById('onb-fine').addEventListener('click', async () => {
    await api('/finance/tax/settings', {
      method: 'PUT',
      body: {
        tax_regime: document.getElementById('onb-regime').value,
        tax_rate: Number(document.getElementById('onb-aliquota').value),
        inps_type: document.getElementById('onb-cassa').value,
      },
    });
    await api('/onboarding/completa', { method: 'POST' });
    state.user.onboarded = true;
    document.body.classList.remove('onboarding');
    toast('Tutto pronto. Benvenuto in Solvia.');
    navigate('dashboard');
  });
}

/**
 * Checklist dei primi passi, mostrata in cima alla dashboard finché resta
 * qualcosa da fare. Non è un promemoria fisso: sparisce da sola.
 */
function primiPassi(stato) {
  if (!stato || !stato.mancanti) return '';
  const fatti = stato.passi.length - stato.mancanti;
  return `
    <div class="card onb-checklist" style="margin-bottom:16px">
      <div class="card-head">
        <h2>Primi passi</h2>
        <span class="cell-muted">${fatti} di ${stato.passi.length}</span>
      </div>
      <div class="onb-progress"><span style="width:${(fatti / stato.passi.length) * 100}%"></span></div>
      <ul class="onb-list">
        ${stato.passi.map((p) => `
          <li class="${p.fatto ? 'done' : ''}">
            <span class="onb-tick">${p.fatto ? '✓' : ''}</span>
            <div><strong>${esc(p.titolo)}</strong><span>${esc(p.dettaglio)}</span></div>
          </li>`).join('')}
      </ul>
    </div>`;
}

/* ========================== DASHBOARD ========================== */

function revenueChart(rows) {
  if (!rows.length) {
    return '<p class="cell-muted" style="padding:26px 0;text-align:center">Nessun incasso registrato finora.</p>';
  }
  const width = 620, height = 190, padL = 48, padR = 12, padB = 26, padT = 12;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const niceMax = Math.ceil(max / 500) * 500 || 500;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const slot = plotW / rows.length;
  const barW = Math.min(46, slot - 10);

  const gridLines = [0, 0.5, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    return `<line class="grid-line" x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}"/>
      <text class="axis-label" x="${padL - 8}" y="${y + 4}" text-anchor="end">${eur0(niceMax * f)}</text>`;
  }).join('');

  const bars = rows.map((r, i) => {
    const h = Math.max((r.total / niceMax) * plotH, r.total > 0 ? 3 : 0);
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + plotH - h;
    return `<g>
      <rect class="bar" x="${x}" y="${y}" width="${barW}" height="${h}" rx="4"
            data-label="${esc(monthLabel(r.month))}" data-value="${esc(eur(r.total))}"
            data-cx="${x + barW / 2}" data-cy="${y}"></rect>
      <text class="axis-label" x="${x + barW / 2}" y="${height - 8}" text-anchor="middle">${monthLabel(r.month)}</text>
    </g>`;
  }).join('');

  return `<div style="position:relative">
    <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" id="revenue-chart">
      ${gridLines}${bars}
    </svg>
    <div class="chart-tip" id="chart-tip"></div>
  </div>`;
}

function wireChart() {
  const svg = document.getElementById('revenue-chart');
  const tip = document.getElementById('chart-tip');
  if (!svg || !tip) return;

  svg.querySelectorAll('.bar').forEach((bar) => {
    bar.addEventListener('mouseenter', () => {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const scale = box.width / vb.width;
      tip.innerHTML = `${bar.dataset.label} · ${bar.dataset.value}`;
      tip.style.left = `${Number(bar.dataset.cx) * scale}px`;
      tip.style.top = `${Number(bar.dataset.cy) * scale - 8}px`;
      tip.classList.add('show');
    });
    bar.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

async function viewDashboard() {
  setLoading();
  // La checklist non deve poter rompere la dashboard: se fallisce, si tace.
  const [d, avvio] = await Promise.all([
    api('/dashboard'),
    api('/onboarding').catch(() => null),
  ]);
  const s = d.stats;

  setHeader('Dashboard', `Ciao ${state.user.name.split(' ')[0]}, ecco la situazione di oggi.`,
    `<button class="btn btn-primary btn-sm" data-action="new-invoice">+ Nuova fattura</button>`);

  document.getElementById('count-inbox').textContent = s.inboxPending;
  document.getElementById('count-inbox').classList.toggle('hidden', !s.inboxPending);
  document.getElementById('count-tasks').textContent = s.tasksToday;
  document.getElementById('count-tasks').classList.toggle('hidden', !s.tasksToday);

  setContent(`
    ${primiPassi(avvio)}
    <div class="grid grid-stats" style="margin-bottom:16px">
      <div class="stat">
        <div class="stat-label">Incassato questo mese</div>
        <div class="stat-value">${eur(s.paidThisMonth)}</div>
        <div class="stat-note">Fatture saldate</div>
      </div>
      <div class="stat">
        <div class="stat-label">Da incassare</div>
        <div class="stat-value">${eur(s.outstanding)}</div>
        <div class="stat-note ${s.overdueCount ? 'danger' : ''}">
          ${s.outstandingCount} fatture aperte${s.overdueCount ? ` · ${s.overdueCount} scadute` : ''}
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">Preventivi in attesa</div>
        <div class="stat-value">${eur(s.openQuotes)}</div>
        <div class="stat-note">${s.openQuotesCount} in sospeso</div>
      </div>
      <div class="stat">
        <div class="stat-label">Da gestire</div>
        <div class="stat-value">${s.inboxPending + s.tasksToday}</div>
        <div class="stat-note ${s.inboxPending ? 'warn' : ''}">
          ${s.inboxPending} email · ${s.tasksToday} attività per oggi
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:16px">
      <div class="tax-card" style="cursor:pointer" data-action="go-tax">
        <div class="label">Da mettere da parte per il fisco</div>
        <div class="value">${eur(d.tax.total)}</div>
        <div style="font-size:13px;opacity:.88;margin-top:6px">
          ${d.tax.percentOfRevenue}% di quanto hai incassato quest'anno
        </div>
        <div class="split">
          <div><div class="k">Imposta</div><div class="v">${eur(d.tax.tax)}</div></div>
          <div><div class="k">Contributi</div><div class="v">${eur(d.tax.inps)}</div></div>
          <div><div class="k">Ti resta</div><div class="v">${eur(d.tax.net)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Entrate ricorrenti e spese</h2></div>
        <div class="items-total"><span>Ricavo ricorrente al mese</span>
          <span style="color:var(--accent);font-weight:700">${eur(s.recurringMonthly)}</span></div>
        <div class="items-total"><span>Spese sostenute quest'anno</span>
          <span>${eur(s.expensesThisYear)}</span></div>
        ${s.pendingReminders ? `
          <div style="margin-top:14px;padding:13px 15px;background:var(--warn-soft);border-radius:10px">
            <div style="font-size:13.5px;color:var(--warn);font-weight:600;margin-bottom:9px">
              ${s.pendingReminders} solleciti pronti per fatture scadute
            </div>
            <button class="btn btn-ghost btn-sm" data-action="go-reminders">Guardali</button>
          </div>`
        : '<p class="hint" style="margin-top:12px">Nessuna fattura scaduta: bene così.</p>'}
      </div>
    </div>

    ${d.sharedQuotes?.length ? `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Preventivi inviati al cliente</h2>
        <button class="link" data-action="go-quotes">Tutti →</button></div>
      ${d.sharedQuotes.map((q) => `
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)">
          <span class="cell-strong" style="font-size:13.5px">${esc(q.number)}</span>
          <span style="margin-left:auto">${
            q.status === 'accettata' ? '<span class="badge badge-green">Accettato</span>'
            : q.status === 'rifiutata' ? '<span class="badge badge-red">Rifiutato</span>'
            : q.viewed_at ? '<span class="badge badge-blue">Letto dal cliente</span>'
            : '<span class="badge badge-gray">Non ancora aperto</span>'}</span>
        </div>`).join('')}
    </div>` : ''}

    ${s.inboxPending ? `
    <div class="card" style="margin-bottom:16px;border-color:#C7D2FE;background:var(--primary-soft)">
      <div class="card-head" style="margin-bottom:10px">
        <h2>L'assistente può darti una mano</h2>
      </div>
      <p style="font-size:14px;color:var(--ink-2);margin-bottom:14px">
        Ci sono <strong>${s.inboxPending} email</strong> da smistare. Solvia può analizzarle
        e preparare le bozze di risposta: le approvi tu, una per una.
      </p>
      <button class="btn btn-primary btn-sm" data-action="triage-all">Analizza le email</button>
    </div>` : ''}

    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head">
          <h2>Incassi degli ultimi mesi</h2>
          <button class="link" data-action="go-invoices">Vedi fatture →</button>
        </div>
        ${revenueChart(d.revenueByMonth)}
      </div>
      <div class="card">
        <div class="card-head"><h2>Prossime attività</h2>
          <button class="link" data-action="go-tasks">Tutte →</button></div>
        ${d.upcomingTasks.length ? d.upcomingTasks.map((t) => `
          <div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">
            <input type="checkbox" data-task-done="${t.id}" style="margin-top:4px;cursor:pointer">
            <div style="min-width:0;flex:1">
              <div style="font-size:13.5px;font-weight:500">${esc(t.title)}</div>
              <div class="cell-muted" style="font-size:12px;margin-top:2px">
                ${t.due_date ? (t.due_date <= today() ? '<span style="color:var(--danger);font-weight:600">Scade oggi o prima</span>' : dmy(t.due_date)) : 'Senza scadenza'}
              </div>
            </div>
          </div>`).join('')
          : '<p class="cell-muted" style="padding:14px 0">Nessuna attività aperta.</p>'}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Clienti principali</h2>
          <button class="link" data-action="go-clients">Tutti →</button></div>
        ${d.topClients.length ? `<div class="table-wrap"><table><tbody>
          ${d.topClients.map((c) => `<tr>
            <td class="cell-strong">${esc(c.name)}</td>
            <td class="num">${eur(c.total)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="cell-muted" style="padding:14px 0">Nessun incasso registrato.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h2>Attività recente</h2></div>
        ${d.activity.length ? d.activity.map((a) => `
          <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="width:7px;height:7px;border-radius:50%;background:var(--primary);flex-shrink:0"></div>
            <div style="flex:1;min-width:0;font-size:13.5px">
              ${a.actor_name ? `<strong class="autore">${esc(a.actor_name)}</strong> ` : ''}${esc(a.message)}
            </div>
            <div class="cell-muted" style="font-size:12px;white-space:nowrap">${relativeTime(a.created_at)}</div>
          </div>`).join('')
          : '<p class="cell-muted" style="padding:14px 0">Nessuna attività registrata.</p>'}
      </div>
    </div>
  `);

  wireChart();

  document.querySelectorAll('[data-task-done]').forEach((box) => {
    box.addEventListener('change', async () => {
      await api(`/tasks/${box.dataset.taskDone}`, { method: 'PATCH', body: { done: true } });
      toast('Attività completata');
      viewDashboard();
    });
  });
}

/* ============================ INBOX ============================ */

let selectedEmailId = null;

async function viewInbox() {
  setLoading();
  const { emails, mode } = await api('/emails');
  const pending = emails.filter((e) => e.status === 'da_leggere').length;

  setHeader('Inbox', `${emails.length} email · ${pending} da analizzare`,
    `${pending ? '<button class="btn btn-primary btn-sm" data-action="triage-all">Analizza tutte</button>' : ''}
     <button class="btn btn-ghost btn-sm" data-action="new-email">+ Simula email</button>`);

  if (!emails.length) {
    setContent(`<div class="card">${emptyState('La tua inbox è vuota.', 'Simula un\'email in arrivo', 'btn-empty-email')}</div>`);
    document.getElementById('btn-empty-email')?.addEventListener('click', newEmailModal);
    return;
  }

  const active = emails.find((e) => e.id === selectedEmailId) || emails[0];
  selectedEmailId = active.id;

  setContent(`
    <div class="inbox">
      <div class="mail-list">
        ${emails.map((e) => `
          <div class="mail-item ${e.id === active.id ? 'active' : ''}" data-email="${e.id}">
            <div class="mail-top">
              <span class="mail-from">${esc(e.from_name)}</span>
              <span class="cell-muted" style="font-size:11.5px;white-space:nowrap">${relativeTime(e.received_at)}</span>
            </div>
            <div class="mail-subject">${esc(e.subject)}</div>
            <div class="mail-preview">${esc(e.body.slice(0, 110))}…</div>
            <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">
              ${e.status === 'da_leggere' ? '<span class="badge badge-gray">Da analizzare</span>' : ''}
              ${e.status === 'bozza_pronta' ? '<span class="badge badge-blue">Bozza pronta</span>' : ''}
              ${e.status === 'approvata' ? '<span class="badge badge-green">Approvata</span>' : ''}
              ${e.status !== 'da_leggere' ? priorityBadge(e.priority) : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="card">
        <div style="border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:14px">
          <h2 style="font-size:17px;font-weight:700;margin-bottom:5px">${esc(active.subject)}</h2>
          <div class="cell-muted" style="font-size:13px">
            ${esc(active.from_name)} &lt;${esc(active.from_email)}&gt; · ${relativeTime(active.received_at)}
          </div>
        </div>

        <div class="mail-body">${esc(active.body)}</div>

        ${active.status === 'da_leggere' ? `
          <div class="assistant-box" style="margin-top:18px">
            <h3>Assistente Solvia</h3>
            <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">
              Questa email non è ancora stata analizzata. Solvia può classificarla e preparare una bozza di risposta.
            </p>
            <button class="btn btn-primary btn-sm" id="btn-triage" data-id="${active.id}">Analizza e scrivi bozza</button>
          </div>
        ` : `
          <div class="assistant-box">
            <h3>Analisi dell'assistente</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <span class="badge badge-blue">${esc(CATEGORY_LABEL[active.category] || active.category)}</span>
              ${priorityBadge(active.priority)}
            </div>
            <p style="font-size:13.5px;color:var(--ink-2)">${esc(active.summary || '')}</p>
          </div>

          <label style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px">
            Bozza di risposta — modificala liberamente prima di approvare
          </label>
          <textarea class="input" id="draft" style="min-height:230px">${esc(active.draft_reply || '')}</textarea>

          <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="btn-approve" data-id="${active.id}">Approva risposta</button>
            <button class="btn btn-ghost btn-sm" id="btn-save-draft" data-id="${active.id}">Salva modifiche</button>
            <button class="btn btn-ghost btn-sm" id="btn-to-task" data-id="${active.id}">Crea attività</button>
            ${active.category === 'richiesta_preventivo'
              ? `<button class="btn btn-ghost btn-sm" id="btn-to-quote" data-id="${active.id}">Genera preventivo</button>` : ''}
            <button class="btn btn-ghost btn-sm" id="btn-archive" data-id="${active.id}">Archivia</button>
          </div>
          <p class="hint" style="margin-top:10px">
            L'approvazione registra la risposta come pronta. L'invio automatico via email richiede
            di collegare un servizio SMTP (non attivo in questa versione).
          </p>
        `}
      </div>
    </div>
  `);

  document.querySelectorAll('[data-email]').forEach((el) => {
    el.addEventListener('click', () => { selectedEmailId = Number(el.dataset.email); viewInbox(); });
  });

  document.getElementById('btn-triage')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analisi…';
    await api(`/emails/${btn.dataset.id}/triage`, { method: 'POST' });
    toast('Bozza pronta');
    viewInbox();
  });

  document.getElementById('btn-save-draft')?.addEventListener('click', async (e) => {
    await api(`/emails/${e.currentTarget.dataset.id}/draft`, {
      method: 'PUT', body: { draft_reply: document.getElementById('draft').value },
    });
    toast('Bozza salvata');
  });

  document.getElementById('btn-approve')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.id;
    await api(`/emails/${id}/draft`, { method: 'PUT', body: { draft_reply: document.getElementById('draft').value } });
    await api(`/emails/${id}/approve`, { method: 'POST' });
    toast('Risposta approvata');
    viewInbox();
  });

  document.getElementById('btn-to-task')?.addEventListener('click', async (e) => {
    await api(`/emails/${e.currentTarget.dataset.id}/to-task`, { method: 'POST' });
    toast('Attività creata');
  });

  document.getElementById('btn-archive')?.addEventListener('click', async (e) => {
    await api(`/emails/${e.currentTarget.dataset.id}/archive`, { method: 'POST' });
    selectedEmailId = null;
    toast('Email archiviata');
    viewInbox();
  });

  document.getElementById('btn-to-quote')?.addEventListener('click', () => {
    openDocumentEditor({ kind: 'preventivo', prefillDescription: active.body, prefillClientName: active.from_name });
  });
}

function newEmailModal() {
  openModal({
    title: 'Simula un\'email in arrivo',
    body: `
      <p class="hint" style="margin-bottom:16px">
        In questa versione l'inbox non è collegata a un provider reale. Puoi inserire
        un'email a mano per vedere come Solvia la classifica e risponde.
      </p>
      <div class="row">
        <div class="field"><label>Nome mittente</label><input class="input" id="e-name" value="Cliente Esempio"></div>
        <div class="field"><label>Email mittente</label><input class="input" id="e-email" value="cliente@example.com"></div>
      </div>
      <div class="field"><label>Oggetto</label><input class="input" id="e-subject" placeholder="Richiesta preventivo per…"></div>
      <div class="field"><label>Testo</label><textarea class="input" id="e-body" style="min-height:130px" placeholder="Buongiorno, avremmo bisogno di…"></textarea></div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-primary" id="m-save">Aggiungi all'inbox</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-save').addEventListener('click', async () => {
    try {
      const { email } = await api('/emails', {
        method: 'POST',
        body: {
          from_name: document.getElementById('e-name').value,
          from_email: document.getElementById('e-email').value,
          subject: document.getElementById('e-subject').value,
          body: document.getElementById('e-body').value,
        },
      });
      closeModal();
      selectedEmailId = email.id;
      toast('Email aggiunta');
      viewInbox();
    } catch (err) { if (!err.handled) toast(err.message); }
  });
}

async function triageAll() {
  toast('Analisi in corso…');
  const { processed, blocked } = await api('/emails/triage-all', { method: 'POST' });
  if (state.view === 'inbox') await viewInbox(); else await viewDashboard();

  if (blocked) upgradeModal(blocked);
  else toast(processed ? `${processed} email analizzate` : 'Nessuna email da analizzare');
}

/* ============================ ATTIVITÀ ============================ */

async function viewTasks() {
  setLoading();
  const { tasks } = await api('/tasks?all=1');
  const open = tasks.filter((t) => !t.done);

  setHeader('Attività', `${open.length} da fare`,
    '<button class="btn btn-primary btn-sm" data-action="new-task">+ Nuova attività</button>');

  if (!tasks.length) {
    setContent(`<div class="card">${emptyState('Nessuna attività ancora.', 'Crea la prima', 'btn-empty-task')}</div>`);
    document.getElementById('btn-empty-task')?.addEventListener('click', newTaskModal);
    return;
  }

  const render = (list, title) => !list.length ? '' : `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>${title} (${list.length})</h2></div>
      ${list.map((t) => `
        <div style="display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--border)">
          <input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''} style="cursor:pointer;width:16px;height:16px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</div>
            <div class="cell-muted" style="font-size:12px;margin-top:2px">
              ${t.due_date ? dmy(t.due_date) : 'Senza scadenza'}
              ${t.source !== 'manuale' ? ` · da ${esc(t.source)}` : ''}
              ${t.client_name ? ` · ${esc(t.client_name)}` : ''}
            </div>
          </div>
          ${!t.done && t.due_date && t.due_date <= today() ? '<span class="badge badge-red">In scadenza</span>' : ''}
          ${!t.done ? priorityBadge(t.priority) : ''}
          <button class="btn btn-danger btn-sm" data-del-task="${t.id}">Elimina</button>
        </div>`).join('')}
    </div>`;

  setContent(render(open, 'Da fare') + render(tasks.filter((t) => t.done), 'Completate'));

  document.querySelectorAll('[data-toggle]').forEach((box) => {
    box.addEventListener('change', async () => {
      await api(`/tasks/${box.dataset.toggle}`, { method: 'PATCH', body: { done: box.checked } });
      viewTasks();
    });
  });
  document.querySelectorAll('[data-del-task]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/tasks/${btn.dataset.delTask}`, { method: 'DELETE' });
      toast('Attività eliminata');
      viewTasks();
    });
  });
}

function newTaskModal() {
  openModal({
    title: 'Nuova attività',
    body: `
      <div class="field"><label>Titolo</label><input class="input" id="t-title" placeholder="Es. Inviare preventivo a…"></div>
      <div class="row">
        <div class="field"><label>Scadenza</label><input class="input" type="date" id="t-due" value="${addDays(2)}"></div>
        <div class="field"><label>Priorità</label>
          <select class="input" id="t-priority">
            <option value="alta">Alta</option><option value="media" selected>Media</option><option value="bassa">Bassa</option>
          </select></div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-primary" id="m-save">Crea attività</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-save').addEventListener('click', async () => {
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          title: document.getElementById('t-title').value,
          due_date: document.getElementById('t-due').value,
          priority: document.getElementById('t-priority').value,
        },
      });
      closeModal(); toast('Attività creata'); viewTasks();
    } catch (e) { if (!e.handled) toast(e.message); }
  });
}

/* ==================== PREVENTIVI E FATTURE ==================== */

async function viewDocuments(kind) {
  setLoading();
  const { documents } = await api(`/documents?kind=${kind}`);
  const isInvoice = kind === 'fattura';
  const title = isInvoice ? 'Fatture' : 'Preventivi';
  const totalOpen = documents.filter((d) => d.status !== 'pagata' && d.status !== 'rifiutata')
    .reduce((s, d) => s + d.total, 0);

  setHeader(title, `${documents.length} documenti · ${eur(totalOpen)} in sospeso`,
    `<button class="btn btn-primary btn-sm" data-action="${isInvoice ? 'new-invoice' : 'new-quote'}">+ ${isInvoice ? 'Nuova fattura' : 'Nuovo preventivo'}</button>`);

  if (!documents.length) {
    setContent(`<div class="card">${emptyState(
      isInvoice ? 'Nessuna fattura ancora.' : 'Nessun preventivo ancora.',
      isInvoice ? 'Crea la prima fattura' : 'Crea il primo preventivo', 'btn-empty-doc')}</div>`);
    document.getElementById('btn-empty-doc')?.addEventListener('click', () => openDocumentEditor({ kind }));
    return;
  }

  setContent(`
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Numero</th><th>Cliente</th><th>Data</th>
          <th>${isInvoice ? 'Scadenza' : 'Valido fino al'}</th>
          <th class="num">Totale</th><th>Stato</th><th class="num">Azioni</th>
        </tr></thead>
        <tbody>
          ${documents.map((d) => `<tr>
            <td class="cell-strong">${esc(d.number)}</td>
            <td>${esc(d.client_name || '—')}</td>
            <td class="cell-muted">${dmy(d.issue_date)}</td>
            <td class="cell-muted">${dmy(d.due_date)}</td>
            <td class="num cell-strong">${eur(d.total)}</td>
            <td>${statusBadge(d.status, d.overdue)}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-ghost btn-sm" data-edit-doc="${d.id}">Apri</button>
                <a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank" rel="noopener">PDF</a>
              </div>
            </td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`);

  document.querySelectorAll('[data-edit-doc]').forEach((btn) => {
    btn.addEventListener('click', () => openDocumentEditor({ kind, id: Number(btn.dataset.editDoc) }));
  });
}

/* ---- Editor documento (creazione e modifica) ---- */

let editorItems = [];

function itemsHTML() {
  return editorItems.map((item, i) => `
    <tr>
      <td><input class="input" data-item="${i}" data-field="description" value="${esc(item.description)}" placeholder="Descrizione"></td>
      <td style="width:80px"><input class="input" type="number" step="0.5" min="0" data-item="${i}" data-field="quantity" value="${item.quantity}"></td>
      <td style="width:110px"><input class="input" type="number" step="0.01" min="0" data-item="${i}" data-field="unit_price" value="${item.unit_price}"></td>
      <td style="width:44px;text-align:right">
        <button class="btn btn-ghost btn-sm" data-remove-item="${i}" title="Rimuovi">×</button>
      </td>
    </tr>`).join('');
}

function refreshEditorTotals() {
  const vat = Number(document.getElementById('d-vat').value) || 0;
  const wh = Number(document.getElementById('d-wh').value) || 0;
  const subtotal = editorItems.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const vatAmount = subtotal * vat / 100;
  const whAmount = subtotal * wh / 100;

  document.getElementById('t-subtotal').textContent = eur(subtotal);
  document.getElementById('t-vat-label').textContent = `IVA ${vat}%`;
  document.getElementById('t-vat').textContent = eur(vatAmount);
  document.getElementById('t-wh-row').classList.toggle('hidden', wh <= 0);
  document.getElementById('t-wh-label').textContent = `Ritenuta ${wh}%`;
  document.getElementById('t-wh').textContent = `− ${eur(whAmount)}`;
  document.getElementById('t-total').textContent = eur(subtotal + vatAmount - whAmount);
}

function wireEditorItems() {
  document.getElementById('items-body').innerHTML = itemsHTML();

  document.querySelectorAll('[data-item]').forEach((input) => {
    input.addEventListener('input', () => {
      const item = editorItems[Number(input.dataset.item)];
      const field = input.dataset.field;
      item[field] = field === 'description' ? input.value : Number(input.value);
      refreshEditorTotals();
    });
  });
  document.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (editorItems.length === 1) return toast('Serve almeno una voce');
      editorItems.splice(Number(btn.dataset.removeItem), 1);
      wireEditorItems(); refreshEditorTotals();
    });
  });
  refreshEditorTotals();
}

async function openDocumentEditor({ kind, id = null, prefillDescription = null, prefillClientName = null }) {
  const { clients } = await api('/clients');
  let doc = null;

  if (id) {
    const loaded = await api(`/documents/${id}`);
    doc = loaded.document;
    editorItems = loaded.items.map((i) => ({
      description: i.description, quantity: i.quantity, unit_price: i.unit_price,
    }));
  } else {
    editorItems = [{ description: '', quantity: 1, unit_price: 0 }];
  }

  const isInvoice = kind === 'fattura';
  const matchedClient = prefillClientName
    ? clients.find((c) => c.name.toLowerCase().includes(String(prefillClientName).toLowerCase().split(' ').pop()))
    : null;
  const selectedClient = doc?.client_id || matchedClient?.id || '';

  openModal({
    wide: true,
    title: id ? `${isInvoice ? 'Fattura' : 'Preventivo'} ${doc.number}` : (isInvoice ? 'Nuova fattura' : 'Nuovo preventivo'),
    body: `
      ${!id ? `
      <div class="assistant-box" style="margin-top:0">
        <h3>Scrivi in linguaggio naturale</h3>
        <textarea class="input" id="d-ai" style="min-height:70px"
          placeholder="Es. restyling sito 8 pagine 3.200 €, ottimizzazione SEO 800 €">${prefillDescription ? esc(prefillDescription) : ''}</textarea>
        <button class="btn btn-primary btn-sm" id="d-ai-btn" style="margin-top:10px">Genera voci</button>
      </div>` : ''}

      <div class="row">
        <div class="field"><label>Cliente</label>
          <select class="input" id="d-client">
            <option value="">— Nessun cliente —</option>
            ${clients.map((c) => `<option value="${c.id}" ${String(selectedClient) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Data</label>
          <input class="input" type="date" id="d-issue" value="${doc?.issue_date || today()}"></div>
        <div class="field"><label>${isInvoice ? 'Scadenza' : 'Valido fino al'}</label>
          <input class="input" type="date" id="d-due" value="${doc?.due_date || addDays(30)}"></div>
      </div>

      <label style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:10px 0 6px">Voci</label>
      <table class="items-table">
        <thead><tr><th>Descrizione</th><th>Qtà</th><th>Prezzo</th><th></th></tr></thead>
        <tbody id="items-body"></tbody>
      </table>
      <button class="btn btn-ghost btn-sm" id="d-add-item" style="margin-top:8px">+ Aggiungi voce</button>

      <div class="row" style="margin-top:18px">
        <div class="field"><label>IVA %</label>
          <input class="input" type="number" step="1" min="0" id="d-vat" value="${doc?.vat_rate ?? state.user.default_vat}"></div>
        <div class="field"><label>Ritenuta d'acconto %</label>
          <input class="input" type="number" step="1" min="0" id="d-wh" value="${doc?.withholding ?? 0}"></div>
      </div>

      <div class="field"><label>Note</label>
        <textarea class="input" id="d-notes" style="min-height:64px">${esc(doc?.notes || '')}</textarea></div>

      <div style="background:var(--bg);border-radius:10px;padding:14px 16px;margin-top:6px">
        <div class="items-total"><span>Imponibile</span><span id="t-subtotal">€ 0,00</span></div>
        <div class="items-total"><span id="t-vat-label">IVA</span><span id="t-vat">€ 0,00</span></div>
        <div class="items-total hidden" id="t-wh-row"><span id="t-wh-label">Ritenuta</span><span id="t-wh">€ 0,00</span></div>
        <div class="items-total grand"><span>Totale</span><span id="t-total">€ 0,00</span></div>
      </div>

      ${id ? `<div class="field" style="margin-top:16px"><label>Stato</label>
        <select class="input" id="d-status">
          ${['bozza', 'inviata', ...(isInvoice ? ['pagata'] : ['accettata', 'rifiutata'])]
            .map((s) => `<option value="${s}" ${doc.status === s ? 'selected' : ''}>${STATUS_BADGE[s][1]}</option>`).join('')}
        </select></div>` : ''}
    `,
    footer: `
      ${id ? `<a class="btn btn-ghost" href="/api/documents/${id}/pdf" target="_blank" rel="noopener">Scarica PDF</a>` : ''}
      ${id && !isInvoice ? '<button class="btn btn-primary" id="d-share">Invia al cliente</button>' : ''}
      ${id && !isInvoice ? '<button class="btn btn-ghost" id="d-convert">Converti in fattura</button>' : ''}
      ${id ? '<button class="btn btn-danger" id="d-delete">Elimina</button>' : ''}
      <button class="btn btn-ghost" id="m-cancel">Annulla</button>
      <button class="btn btn-primary" id="d-save">${id ? 'Salva modifiche' : 'Crea documento'}</button>`,
  });

  wireEditorItems();

  document.getElementById('d-add-item').addEventListener('click', () => {
    editorItems.push({ description: '', quantity: 1, unit_price: 0 });
    wireEditorItems();
  });
  document.getElementById('d-vat').addEventListener('input', refreshEditorTotals);
  document.getElementById('d-wh').addEventListener('input', refreshEditorTotals);
  document.getElementById('m-cancel').addEventListener('click', closeModal);

  document.getElementById('d-ai-btn')?.addEventListener('click', async (e) => {
    const description = document.getElementById('d-ai').value.trim();
    if (!description) return toast('Descrivi prima il lavoro');
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generazione…';
    try {
      const { items } = await api('/documents/draft', { method: 'POST', body: { description } });
      editorItems = items;
      wireEditorItems();
      toast(`${items.length} voci generate — controllale prima di salvare`);
    } catch (err) { if (!err.handled) toast(err.message); }
    btn.disabled = false; btn.textContent = 'Genera voci';
  });

  const collect = () => ({
    kind,
    client_id: document.getElementById('d-client').value || null,
    issue_date: document.getElementById('d-issue').value,
    due_date: document.getElementById('d-due').value,
    vat_rate: Number(document.getElementById('d-vat').value),
    withholding: Number(document.getElementById('d-wh').value),
    notes: document.getElementById('d-notes').value,
    items: editorItems.filter((i) => i.description.trim()),
  });

  document.getElementById('d-save').addEventListener('click', async () => {
    const payload = collect();
    if (!payload.items.length) return toast('Aggiungi almeno una voce con descrizione');
    try {
      if (id) {
        await api(`/documents/${id}`, { method: 'PUT', body: payload });
        const status = document.getElementById('d-status').value;
        if (status !== doc.status) await api(`/documents/${id}/status`, { method: 'PATCH', body: { status } });
      } else {
        await api('/documents', { method: 'POST', body: payload });
      }
      closeModal(); toast('Documento salvato'); viewDocuments(kind);
    } catch (e) { if (!e.handled) toast(e.message); }
  });

  document.getElementById('d-share')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Genero il link…';
    try {
      const { url } = await api(`/documents/${id}/condividi`, { method: 'POST' });
      shareModal(url, doc.number);
    } catch (err) {
      if (!err.handled) toast(err.message);
      btn.disabled = false;
      btn.textContent = 'Invia al cliente';
    }
  });

  document.getElementById('d-convert')?.addEventListener('click', async () => {
    await api(`/documents/${id}/convert`, { method: 'POST' });
    closeModal(); toast('Fattura creata dal preventivo'); navigate('invoices');
  });

  document.getElementById('d-delete')?.addEventListener('click', async () => {
    await api(`/documents/${id}`, { method: 'DELETE' });
    closeModal(); toast('Documento eliminato'); viewDocuments(kind);
  });
}

/** Mostra il link da mandare al cliente, con copia rapida. */
function shareModal(url, number) {
  openModal({
    title: 'Link pronto da mandare',
    body: `
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:18px">
        Manda questo link al cliente: aprirà il preventivo <strong>${esc(number)}</strong>
        impaginato e potrà accettarlo con un clic, senza registrarsi.
        Tu vedrai subito quando lo apre e cosa risponde.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input class="input" id="share-url" value="${esc(url)}" readonly
          style="font-family:ui-monospace,monospace;font-size:12.5px">
        <button class="btn btn-primary" id="share-copy" style="white-space:nowrap">Copia</button>
      </div>
      <div class="assistant-box" style="margin:0">
        <h3>Testo pronto per l'email</h3>
        <textarea class="input" id="share-text" style="min-height:130px">Buongiorno,

come promesso le invio il preventivo ${number}. Può consultarlo a questo link:

${url}

Trova tutto dettagliato e, se le va bene, può accettarlo direttamente dalla pagina.
Resto a disposizione per qualsiasi chiarimento.

Cordiali saluti</textarea>
        <button class="btn btn-ghost btn-sm" id="share-copy-text" style="margin-top:10px">Copia il testo</button>
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Chiudi</button>
             <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Vedi come lo vede il cliente</a>`,
  });

  const copy = async (text, btn, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // In alcuni browser la clipboard richiede un contesto sicuro: si ripiega
      // sulla selezione manuale, così l'utente può copiare a mano.
      document.getElementById('share-url').select();
    }
    btn.textContent = '✓ Copiato';
    setTimeout(() => { btn.textContent = label; }, 1800);
  };

  document.getElementById('m-cancel').addEventListener('click', () => { closeModal(); viewDocuments('preventivo'); });
  document.getElementById('share-copy').addEventListener('click', (e) =>
    copy(url, e.currentTarget, 'Copia'));
  document.getElementById('share-copy-text').addEventListener('click', (e) =>
    copy(document.getElementById('share-text').value, e.currentTarget, 'Copia il testo'));
}

/* ============================ CLIENTI ============================ */

async function viewClients() {
  setLoading();
  const { clients } = await api('/clients');

  setHeader('Clienti', `${clients.length} in anagrafica`,
    '<button class="btn btn-primary btn-sm" data-action="new-client">+ Nuovo cliente</button>');

  if (!clients.length) {
    setContent(`<div class="card">${emptyState('Nessun cliente in anagrafica.', 'Aggiungi il primo', 'btn-empty-client')}</div>`);
    document.getElementById('btn-empty-client')?.addEventListener('click', () => clientModal());
    return;
  }

  setContent(`
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Contatti</th><th>P. IVA</th>
          <th class="num">Fatture</th><th class="num">Incassato</th><th class="num">Azioni</th></tr></thead>
        <tbody>
          ${clients.map((c) => `<tr>
            <td class="cell-strong">${esc(c.name)}</td>
            <td class="cell-muted">${esc(c.email || '—')}${c.phone ? `<br>${esc(c.phone)}` : ''}</td>
            <td class="cell-muted">${esc(c.vat_number || '—')}</td>
            <td class="num">${c.invoice_count}</td>
            <td class="num cell-strong">${eur(c.revenue)}</td>
            <td><div class="row-actions">
              <button class="btn btn-ghost btn-sm" data-portal="${c.id}">Portale</button>
              <button class="btn btn-ghost btn-sm" data-edit-client="${c.id}">Modifica</button>
              <button class="btn btn-danger btn-sm" data-del-client="${c.id}">Elimina</button>
            </div></td></tr>`).join('')}
        </tbody></table></div>
    </div>`);

  document.querySelectorAll('[data-edit-client]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clientModal(clients.find((c) => c.id === Number(btn.dataset.editClient)));
    });
  });
  document.querySelectorAll('[data-del-client]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/clients/${btn.dataset.delClient}`, { method: 'DELETE' });
      toast('Cliente eliminato'); viewClients();
    });
  });
  document.querySelectorAll('[data-portal]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span>';
      const client = clients.find((c) => c.id === Number(b.dataset.portal));
      const { url } = await api(`/clients/${b.dataset.portal}/portale`, { method: 'POST' });
      portalModal(url, client.name);
    });
  });
}

function clientModal(client = null) {
  openModal({
    title: client ? 'Modifica cliente' : 'Nuovo cliente',
    body: `
      <div class="field"><label>Nome / ragione sociale</label>
        <input class="input" id="c-name" value="${esc(client?.name || '')}"></div>
      <div class="row">
        <div class="field"><label>Email</label><input class="input" type="email" id="c-email" value="${esc(client?.email || '')}"></div>
        <div class="field"><label>Telefono</label><input class="input" id="c-phone" value="${esc(client?.phone || '')}"></div>
      </div>
      <div class="field"><label>Partita IVA</label><input class="input" id="c-vat" value="${esc(client?.vat_number || '')}"></div>
      <div class="field"><label>Indirizzo</label><input class="input" id="c-address" value="${esc(client?.address || '')}"></div>
      <div class="field"><label>Note</label><textarea class="input" id="c-notes" style="min-height:60px">${esc(client?.notes || '')}</textarea></div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-primary" id="m-save">${client ? 'Salva' : 'Crea cliente'}</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-save').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('c-name').value,
      email: document.getElementById('c-email').value,
      phone: document.getElementById('c-phone').value,
      vat_number: document.getElementById('c-vat').value,
      address: document.getElementById('c-address').value,
      notes: document.getElementById('c-notes').value,
    };
    try {
      await api(client ? `/clients/${client.id}` : '/clients', { method: client ? 'PUT' : 'POST', body });
      closeModal(); toast('Cliente salvato'); viewClients();
    } catch (e) { if (!e.handled) toast(e.message); }
  });
}

/* ========================== ABBONAMENTO ========================== */

async function startCheckout(planId, button) {
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner"></span> Attendere…'; }
  try {
    const { url } = await api('/billing/checkout', { method: 'POST', body: { plan: planId } });
    window.location.href = url;
  } catch (e) {
    if (!e.handled) toast(e.message);
    if (button) { button.disabled = false; button.textContent = 'Passa a questo piano'; }
  }
}

/**
 * Limite raggiunto.
 *
 * In pre-lancio non si può pagare: mostrare un pulsante "Passa a Pro" che porta
 * a un pagamento inesistente farebbe perdere la persona due volte — prima
 * perché non ottiene quello che voleva, poi perché capisce di essere stata
 * presa in giro. Meglio dire com'è e prendersi l'email.
 */
function upgradeModal(reason, prelancio = state.prelancio) {
  if (prelancio) return attesaModal(reason);
  openModal({
    title: 'Limite del piano raggiunto',
    body: `
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:18px">${esc(reason)}</p>
      <div style="background:var(--primary-soft);border-radius:12px;padding:18px">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">Piano Pro — €19/mese</div>
        <ul style="list-style:none;font-size:13.5px;color:var(--ink-2)">
          <li style="padding:4px 0 4px 22px;position:relative">
            <span style="position:absolute;left:0;color:var(--accent);font-weight:700">✓</span>
            Preventivi e fatture illimitati</li>
          <li style="padding:4px 0 4px 22px;position:relative">
            <span style="position:absolute;left:0;color:var(--accent);font-weight:700">✓</span>
            Email analizzate illimitate</li>
          <li style="padding:4px 0 4px 22px;position:relative">
            <span style="position:absolute;left:0;color:var(--accent);font-weight:700">✓</span>
            Clienti illimitati</li>
        </ul>
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Non ora</button>
             <button class="btn btn-primary" id="m-upgrade">Passa a Pro</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-upgrade').addEventListener('click', (e) => startCheckout('pro', e.currentTarget));
}

/** Chi voleva pagare e non ha potuto: si prende l'email e lo si avvisa. */
function attesaModal(motivo) {
  openModal({
    title: 'Non è ancora possibile pagare',
    body: `
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:14px">${esc(motivo || '')}</p>
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:18px">
        Sto aprendo i pagamenti in questi giorni. Se lasci il tuo indirizzo ti avviso
        appena si può, e il piano Pro te lo attivo io.
      </p>
      <div class="alert alert-error" id="att-err"></div>
      <div class="alert alert-ok" id="att-ok"></div>
      <div class="field">
        <label for="att-email">La tua email</label>
        <input class="input" type="email" id="att-email" value="${esc(state.user?.email || '')}">
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Non ora</button>
             <button class="btn btn-primary" id="m-attesa">Avvisami</button>`,
  });

  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-attesa').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = document.getElementById('att-err');
    const ok = document.getElementById('att-ok');
    err.classList.remove('show');
    btn.disabled = true;
    try {
      const r = await api('/billing/attesa', {
        method: 'POST',
        body: { email: document.getElementById('att-email').value.trim(), plan: 'pro', source: 'app' },
      });
      ok.textContent = r.message;
      ok.classList.add('show');
      btn.textContent = 'Fatto';
      setTimeout(closeModal, 1600);
    } catch (ex) {
      if (!ex.handled) { err.textContent = ex.message; err.classList.add('show'); }
      btn.disabled = false;
    }
  });
}

function usageBar(label, used, limit) {
  if (limit === null) {
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
        <span style="color:var(--ink-2)">${esc(label)}</span>
        <span style="color:var(--accent);font-weight:600">illimitato</span>
      </div></div>`;
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const full = used >= limit;
  return `<div style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
      <span style="color:var(--ink-2)">${esc(label)}</span>
      <span style="font-weight:600;color:${full ? 'var(--danger)' : 'var(--muted)'}">${used} / ${limit}</span>
    </div>
    <div style="height:6px;background:var(--border);border-radius:999px;overflow:hidden">
      <div style="height:100%;width:${pct}%;border-radius:999px;
        background:${full ? 'var(--danger)' : 'var(--primary)'}"></div>
    </div></div>`;
}

const SUB_STATUS = {
  attivo: ['badge-green', 'Attivo'],
  attivo_demo: ['badge-amber', 'Attivo (simulato)'],
  sospeso: ['badge-red', 'Sospeso'],
  pagamento_fallito: ['badge-red', 'Pagamento fallito'],
  disdetto: ['badge-gray', 'Disdetto'],
  inattivo: ['badge-gray', 'Nessun abbonamento'],
};

/** Riquadro mostrato quando la parte commerciale è spenta (configurazione predefinita). */
function freeProjectCard(b) {
  return `
    <div class="card">
      <div class="card-head">
        <h2>Il tuo piano</h2>
        <span class="badge badge-green">Gratuito</span>
      </div>
      <div style="font-size:24px;font-weight:800;margin-bottom:4px">Tutto incluso</div>
      <p class="cell-muted" style="font-size:13.5px;margin-bottom:20px">
        Solvia è un progetto personale: nessun abbonamento, nessun limite d'uso,
        nessun dato di pagamento richiesto.
      </p>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                  color:var(--muted);margin-bottom:12px">Quanto hai usato questo mese</div>
      ${usageBar('Preventivi creati', b.usage.quotesThisMonth, null)}
      ${usageBar('Email analizzate', b.usage.triageThisMonth, null)}
      ${usageBar('Clienti in anagrafica', b.usage.clients, null)}

      <p class="hint" style="margin-top:16px">
        I numeri sono solo informativi: non c'è nessun tetto da rispettare.
      </p>
    </div>`;
}

/** Diritti GDPR: esportazione e cancellazione. */
function privacyCard() {
  return `
    <div class="card">
      <div class="card-head"><h2>I tuoi dati</h2></div>
      <p style="font-size:14px;color:var(--ink-2);margin-bottom:18px">
        I dati che inserisci sono tuoi. Puoi portarli via o cancellarli quando vuoi,
        senza chiedere il permesso a nessuno.
      </p>

      <div style="padding:14px 0;border-top:1px solid var(--border)">
        <div style="font-weight:600;font-size:14.5px;margin-bottom:4px">Scarica i miei dati</div>
        <p class="cell-muted" style="font-size:13px;margin-bottom:10px">
          Un file con account, clienti, documenti, attività ed email. Formato leggibile
          e riutilizzabile altrove (artt. 15 e 20 del GDPR).
        </p>
        <a class="btn btn-ghost btn-sm" href="/api/gdpr/export" id="gdpr-export">Scarica tutto</a>
      </div>

      <div style="padding:14px 0;border-top:1px solid var(--border)">
        <div style="font-weight:600;font-size:14.5px;margin-bottom:4px">Elimina account</div>
        <p class="cell-muted" style="font-size:13px;margin-bottom:10px">
          Cancella l'account e ogni dato collegato. L'operazione è immediata e
          <strong>non è reversibile</strong> (art. 17 del GDPR).
        </p>
        <button class="btn btn-danger btn-sm" id="gdpr-delete">Elimina il mio account</button>
      </div>

      <p class="hint" style="margin-top:14px">
        Dettagli su cosa trattiamo e perché: <a href="/privacy.html" target="_blank"
        style="color:var(--primary)">informativa privacy</a> ·
        <a href="/cookie.html" target="_blank" style="color:var(--primary)">cookie</a> ·
        <a href="/termini.html" target="_blank" style="color:var(--primary)">termini d'uso</a>
      </p>
    </div>`;
}

/**
 * Conferma per le azioni che non si annullano.
 * L'azione riceve il controllo solo dopo il clic sul pulsante rosso; gli errori
 * restano dentro la finestra invece di sparire in un toast.
 */
function confirmModal(titolo, testo, azione, etichetta = 'Conferma') {
  openModal({
    title: titolo,
    body: `<p style="font-size:14.5px;color:var(--ink-2);line-height:1.7">${esc(testo)}</p>
           <div class="alert alert-error" id="conf-err" style="margin-top:14px"></div>`,
    footer: `<button class="btn btn-ghost" id="conf-no">Annulla</button>
             <button class="btn btn-danger" id="conf-si">${esc(etichetta)}</button>`,
  });
  document.getElementById('conf-no').addEventListener('click', closeModal);
  document.getElementById('conf-si').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = document.getElementById('conf-err');
    err.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Attendi…';
    try {
      await azione();
      closeModal();
    } catch (ex) {
      if (ex.handled) return closeModal();
      err.textContent = ex.message;
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = etichetta;
    }
  });
}

function deleteAccountModal() {
  openModal({
    title: 'Eliminare definitivamente l\'account?',
    body: `
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:14px">
        Verranno cancellati per sempre: il tuo account, tutti i clienti, preventivi,
        fatture, attività ed email. <strong>Non si può annullare</strong> e non esiste
        un cestino da cui recuperarli.
      </p>
      <div class="alert alert-error" id="del-err"></div>
      <p style="font-size:14px;color:var(--ink-2);margin-bottom:14px">
        Se ti servono i dati, <a href="/api/gdpr/export" style="color:var(--primary)">scaricali
        prima</a>.
      </p>
      <div class="field">
        <label>Conferma con la tua password</label>
        <input class="input" type="password" id="del-pass" autocomplete="current-password">
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-danger" id="m-delete">Elimina definitivamente</button>`,
  });

  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-delete').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = document.getElementById('del-err');
    err.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Eliminazione…';
    try {
      await api('/gdpr/delete', {
        method: 'POST', body: { password: document.getElementById('del-pass').value },
      });
      window.location.href = '/';
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Elimina definitivamente';
    }
  });
}

function billingCard(b) {
  if (b.mode === 'disattivato') return freeProjectCard(b);

  const [cls, label] = SUB_STATUS[b.status] || SUB_STATUS.inattivo;
  const paid = b.plan !== 'free';

  // Collaboratore in uno studio altrui: vede a che piano lavora, senza
  // pulsanti che non ha il diritto di premere.
  if (b.readOnly) {
    return `
      <div class="card">
        <div class="card-head"><h2>Abbonamento</h2>
          <span class="badge ${cls}">${label}</span></div>
        <div style="font-size:24px;font-weight:800;margin-bottom:4px">Piano ${esc(b.planName)}</div>
        <p class="cell-muted" style="font-size:13px;margin-bottom:18px">
          Dello studio ${esc(b.studio || '')}${b.renewsAt ? ` · si rinnova il ${dmy(b.renewsAt)}` : ''}
        </p>
        <p style="font-size:14px;color:var(--ink-2)">
          Lavori con il piano del titolare: hai le stesse funzioni, senza un abbonamento tuo.
          Modifiche, rinnovi e disdetta li gestisce chi ha aperto lo studio.
        </p>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-head">
        <h2>Abbonamento</h2>
        <span class="badge ${cls}">${label}</span>
      </div>

      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
        <span style="font-size:24px;font-weight:800">Piano ${esc(b.planName)}</span>
      </div>
      <p class="cell-muted" style="font-size:13px;margin-bottom:20px">
        ${b.renewsAt ? `Si rinnova il ${dmy(b.renewsAt)}` : 'Nessun rinnovo programmato'}
      </p>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
                  color:var(--muted);margin-bottom:12px">Consumo di questo mese</div>
      ${usageBar('Preventivi creati', b.usage.quotesThisMonth, b.limits.quotesPerMonth)}
      ${usageBar('Email analizzate', b.usage.triageThisMonth, b.limits.triagePerMonth)}
      ${usageBar('Clienti in anagrafica', b.usage.clients, b.limits.clients)}

      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:20px">
        ${!paid && b.prelancio ? '<button class="btn btn-primary btn-sm" id="b-attesa">Avvisami quando apro i pagamenti</button>' : ''}
        ${!paid && !b.prelancio ? '<button class="btn btn-primary btn-sm" data-plan-upgrade="pro">Passa a Pro — €19/mese</button>' : ''}
        ${!paid && !b.prelancio ? '<button class="btn btn-ghost btn-sm" data-plan-upgrade="team">Piano Team — €49/mese</button>' : ''}
        ${paid && b.mode === 'stripe' ? '<button class="btn btn-ghost btn-sm" id="b-portal">Gestisci pagamento e disdetta</button>' : ''}
        ${paid && b.mode === 'demo' ? '<button class="btn btn-danger btn-sm" id="b-cancel">Disdici (simulazione)</button>' : ''}
      </div>

      ${b.prelancio ? `
        <p class="hint" style="margin-top:16px;padding:12px 14px;background:var(--primary-soft);
           border-radius:9px;color:var(--ink-2)">
          <strong>I pagamenti aprono a breve.</strong> Il piano gratuito funziona per intero
          e resta gratuito. Quando apro gli abbonamenti avviso chi si è messo in lista.
        </p>` : ''}

      ${b.mode === 'demo' && !b.prelancio ? `
        <p class="hint" style="margin-top:16px;padding:12px 14px;background:var(--warn-soft);
           border-radius:9px;color:var(--warn)">
          <strong>Pagamenti in simulazione.</strong> Il flusso funziona per intero ma nessun
          importo viene incassato. Imposta <code>STRIPE_SECRET_KEY</code> e i due
          <code>STRIPE_PRICE_*</code> per attivare gli incassi reali — il codice non cambia.
        </p>` : ''}
    </div>`;
}

/** Link del portale cliente, con testo pronto da inviare. */
function portalModal(url, clientName) {
  openModal({
    title: `Portale di ${clientName}`,
    body: `
      <p style="font-size:14.5px;color:var(--ink-2);margin-bottom:18px">
        Con questo link <strong>${esc(clientName)}</strong> vede tutti i suoi documenti —
        fatture, preventivi, cosa è ancora da saldare — sempre aggiornati, senza registrarsi.
        Le bozze non compaiono.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input class="input" id="portal-url" value="${esc(url)}" readonly
          style="font-family:ui-monospace,monospace;font-size:12.5px">
        <button class="btn btn-primary" id="portal-copy" style="white-space:nowrap">Copia</button>
      </div>
      <p class="hint">Il link resta valido finché non lo revochi. Rigenerarlo invalida il precedente.</p>`,
    footer: `<button class="btn btn-danger" id="portal-revoke">Revoca</button>
             <button class="btn btn-ghost" id="m-cancel">Chiudi</button>
             <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Vedi la pagina</a>`,
  });

  document.getElementById('m-cancel').addEventListener('click', () => { closeModal(); viewClients(); });
  document.getElementById('portal-copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(url); } catch { document.getElementById('portal-url').select(); }
    e.currentTarget.textContent = '✓ Copiato';
    setTimeout(() => { e.currentTarget.textContent = 'Copia'; }, 1800);
  });
  document.getElementById('portal-revoke').addEventListener('click', async () => {
    const id = url.split('/c/')[1];
    const clientId = (await api('/clients')).clients.find((c) => c.name === clientName)?.id;
    if (clientId) await api(`/clients/${clientId}/portale`, { method: 'DELETE' });
    closeModal(); toast('Portale revocato'); viewClients();
  });
}

/* ==================== DIAGNOSTICA PAGAMENTI ==================== */

const SEGNO = { ok: '✓', errore: '✗', avviso: '!' };

/**
 * Esegue la diagnostica Stripe e mostra l'esito.
 * Il testo delle azioni arriva dal server già scritto per essere letto da
 * chi sta configurando, non da chi ha scritto il codice.
 */
async function runDiagnostica() {
  const box = document.getElementById('diag-esito');
  const btn = document.getElementById('diag-run');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Controllo in corso…';
  box.innerHTML = '';

  try {
    const d = await api('/billing/diagnostica');

    const classe = d.errori ? 'ko' : (d.avvisi ? 'warn' : 'ok');
    box.innerHTML = `
      <div class="diag-riassunto ${classe}">
        ${esc(d.riassunto)}
        <small>Modo: ${d.modo === 'nessuno' ? 'nessuna chiave configurata' : d.modo.toUpperCase()}
          · ${d.controlli.length} controlli eseguiti</small>
      </div>
      ${d.controlli.map((c) => `
        <div class="diag-item">
          <div class="diag-segno ${c.stato}">${SEGNO[c.stato] || '·'}</div>
          <div class="diag-corpo">
            <strong>${esc(c.titolo)}</strong>
            <p>${esc(c.dettaglio)}</p>
            ${c.azione ? `<div class="diag-azione">${esc(c.azione)}</div>` : ''}
          </div>
        </div>`).join('')}`;
  } catch (e) {
    if (!e.handled) {
      box.innerHTML = `<div class="diag-riassunto ko">Diagnostica non riuscita: ${esc(e.message)}</div>`;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Verifica di nuovo';
}

/* ======================= STUDIO CONDIVISO ======================= */

const RUOLO_ETICHETTA = { titolare: 'Titolare', collaboratore: 'Collaboratore' };

/**
 * La scheda dello studio cambia faccia in tre casi: chi ha il piano Team e lo
 * gestisce, chi non ce l'ha e vede a cosa serve, e chi ci lavora dentro senza
 * esserne il titolare.
 */
function studioCard(s) {
  if (!s) return '';

  if (!s.sonoTitolare) {
    return `
      <div class="card">
        <div class="card-head"><h2>Studio</h2>
          <span class="badge badge-blue">${RUOLO_ETICHETTA[s.ruolo] || s.ruolo}</span></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:16px">
          Lavori nello studio <strong>${esc(s.nomeStudio)}</strong>: clienti, preventivi e
          fatture sono condivisi con gli altri, e ogni cosa che fai resta firmata col tuo nome.
          L'abbonamento lo gestisce il titolare.
        </p>
        <div class="membri">
          ${s.membri.map(membroRiga).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="studio-esci" style="margin-top:16px">
          Esci dallo studio</button>
      </div>`;
  }

  // Titolare senza piano Team: si spiega a cosa serve, senza fingere che ci sia.
  if (!s.condivisibile) {
    return `
      <div class="card">
        <div class="card-head"><h2>Studio condiviso</h2>
          <span class="badge badge-gray">Piano Team</span></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:14px">
          Con il piano Team fino a <strong>cinque persone</strong> lavorano sugli stessi
          clienti, preventivi e fatture. Non cinque archivi separati: lo stesso archivio,
          con ogni azione firmata da chi l'ha fatta.
        </p>
        <ul style="font-size:13.5px;color:var(--ink-2);padding-left:18px;line-height:1.9;margin-bottom:18px">
          <li>Inviti via email, il collaboratore entra e vede subito il lavoro vero</li>
          <li>Chi entra non tocca abbonamento, dati fiscali e account degli altri</li>
          <li>Revochi l'accesso in un clic: il lavoro fatto resta allo studio</li>
          <li>Un solo abbonamento per tutti, non uno a testa</li>
        </ul>
        ${state.prelancio
          ? '<button class="btn btn-primary btn-sm" id="b-attesa-team">Avvisami quando apre</button>'
          : '<button class="btn btn-primary btn-sm" data-plan-upgrade="team">Passa a Team — 49 €/mese</button>'}
      </div>`;
  }

  const pieno = s.posti.liberi <= 0;
  return `
    <div class="card">
      <div class="card-head"><h2>Studio condiviso</h2>
        <span class="cell-muted">${s.posti.usati} di ${s.posti.totale} posti</span></div>

      <div class="membri">
        ${s.membri.map(membroRiga).join('')}
        ${s.inviti.map((i) => `
          <div class="membro in-attesa">
            <div class="membro-cerchio">…</div>
            <div class="membro-testo">
              <strong>${esc(i.email)}</strong>
              <span>Invito in sospeso · scade ${dmy(i.expires_at)}</span>
            </div>
            <button class="btn btn-ghost btn-sm" data-revoca="${i.id}">Revoca</button>
          </div>`).join('')}
      </div>

      <div class="alert alert-error" id="studio-err"></div>
      <div class="alert alert-ok" id="studio-ok"></div>

      ${pieno ? `<p class="hint" style="margin-top:16px">
          Hai occupato tutti i posti. Rimuovi qualcuno o revoca un invito per liberarne uno.</p>`
        : `<div class="invita">
            <input class="input" type="email" id="studio-email" placeholder="email di chi vuoi invitare">
            <button class="btn btn-primary" id="studio-invita">Invita</button>
          </div>
          <p class="hint" style="margin-top:10px">Riceverà un link valido 72 ore. Serve un
          indirizzo che non abbia già un account Solvia, così nessun archivio esistente
          viene spostato.</p>`}
    </div>`;
}

function membroRiga(m) {
  const iniziali = m.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const io = m.id === state.user.id;
  return `
    <div class="membro">
      <div class="membro-cerchio">${esc(iniziali)}</div>
      <div class="membro-testo">
        <strong>${esc(m.name)}${io ? ' (tu)' : ''}</strong>
        <span>${esc(m.email)} · ${RUOLO_ETICHETTA[m.studio_role] || m.studio_role}</span>
      </div>
      ${m.studio_role === 'collaboratore' && state.user.studio_role === 'titolare'
        ? `<button class="btn btn-ghost btn-sm" data-rimuovi="${m.id}">Rimuovi</button>` : ''}
    </div>`;
}

/* Eventi della scheda studio, agganciati dopo il disegno delle Impostazioni. */
function wireStudio() {
  const err = document.getElementById('studio-err');
  const ok = document.getElementById('studio-ok');
  const mostra = (box, testo) => { box.textContent = testo; box.classList.add('show'); };
  const pulisci = () => { err?.classList.remove('show'); ok?.classList.remove('show'); };

  document.getElementById('studio-invita')?.addEventListener('click', async (e) => {
    pulisci();
    const btn = e.currentTarget;
    const email = document.getElementById('studio-email').value.trim();
    if (!email) return mostra(err, 'Inserisci l\'email di chi vuoi invitare');
    btn.disabled = true;
    try {
      await api('/studio/inviti', { method: 'POST', body: { email } });
      toast(`Invito mandato a ${email}`);
      viewSettings();
    } catch (ex) {
      if (!ex.handled) mostra(err, ex.message);
      btn.disabled = false;
    }
  });

  document.querySelectorAll('[data-revoca]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      pulisci();
      await api(`/studio/inviti/${btn.dataset.revoca}`, { method: 'DELETE' });
      toast('Invito revocato');
      viewSettings();
    });
  });

  document.querySelectorAll('[data-rimuovi]').forEach((btn) => {
    btn.addEventListener('click', () => confirmModal(
      'Rimuovere questa persona dallo studio?',
      'Perde subito l\'accesso ai dati dello studio. Il lavoro che ha fatto resta qui — '
      + 'era dello studio, non suo. Il suo account non viene cancellato: torna a essere '
      + 'un account personale vuoto.',
      async () => {
        const r = await api(`/studio/membri/${btn.dataset.rimuovi}`, { method: 'DELETE' });
        toast(`${r.nome} non fa più parte dello studio`);
        viewSettings();
      },
      'Rimuovi',
    ));
  });

  document.getElementById('studio-esci')?.addEventListener('click', () => confirmModal(
    'Uscire dallo studio?',
    'Perdi l\'accesso a clienti, preventivi e fatture dello studio. Il tuo account resta, '
    + 'ma vuoto, e dovrai accedere di nuovo. Per rientrare serve un nuovo invito del titolare.',
    async () => {
      await api('/studio/esci', { method: 'POST' });
      window.location.href = '/accedi';
    },
    'Esci dallo studio',
  ));
}

/* ========================= IMPOSTAZIONI ========================= */

async function viewSettings() {
  setLoading();
  const [{ assistantMode }, b, s] = await Promise.all([
    api('/dashboard'), api('/billing'),
    api('/studio').catch(() => null),   // se fallisce, la scheda semplicemente non appare
  ]);
  const u = state.user;
  state.prelancio = Boolean(b.prelancio);

  setHeader('Impostazioni', 'Abbonamento e dati che compaiono su preventivi e fatture');

  setContent(`
    <div class="grid grid-2">
      ${billingCard(b)}
      ${studioCard(s)}
      <div class="card">
        <div class="card-head"><h2>I tuoi dati</h2></div>
        <div class="alert alert-ok" id="s-ok">Dati salvati correttamente.</div>
        <div class="field"><label>Nome e cognome</label><input class="input" id="s-name" value="${esc(u.name)}"></div>
        <div class="field"><label>Attività / studio</label><input class="input" id="s-business" value="${esc(u.business_name || '')}"></div>
        <div class="field"><label>Partita IVA</label><input class="input" id="s-vat" value="${esc(u.vat_number || '')}"></div>
        <div class="field"><label>Indirizzo</label><input class="input" id="s-address" value="${esc(u.address || '')}"></div>
        <div class="row">
          <div class="field"><label>IVA predefinita %</label>
            <input class="input" type="number" id="s-defvat" value="${u.default_vat}"></div>
          <div class="field"><label>Tariffa oraria €</label>
            <input class="input" type="number" id="s-rate" value="${u.hourly_rate || 0}"></div>
        </div>
        <button class="btn btn-primary" id="s-save">Salva</button>
      </div>

      <div class="card">
        <div class="card-head"><h2>Account e sicurezza</h2></div>

        <div class="account-facts">
          <div><span>Email</span><strong>${esc(u.email)}</strong></div>
          <div><span>Account creato</span><strong>${dmy(u.created_at)}</strong></div>
          <div><span>Ultimo accesso</span>
            <strong>${u.last_login_at ? relativeTime(u.last_login_at) : 'questo'}</strong></div>
        </div>

        <div class="alert alert-ok" id="pw-ok"></div>
        <div class="alert alert-error" id="pw-err"></div>

        <div class="field"><label for="pw-attuale">Password attuale</label>
          <input class="input" type="password" id="pw-attuale" autocomplete="current-password"></div>
        <div class="row">
          <div class="field"><label for="pw-nuova">Nuova password</label>
            <input class="input" type="password" id="pw-nuova" autocomplete="new-password"></div>
          <div class="field"><label for="pw-ripeti">Ripetila</label>
            <input class="input" type="password" id="pw-ripeti" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-primary" id="pw-salva">Cambia password</button>
        <p class="hint" style="margin-top:12px">Cambiandola, le sessioni aperte su altri
          dispositivi vengono disconnesse. Questa resta attiva.</p>

        ${u.demo_data ? `
        <div class="card-head" style="margin-top:26px"><h2>Dati di esempio</h2></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:14px">
          L'account contiene i clienti, le fatture e le email caricati al primo accesso.
          Quando cominci a lavorare sul serio, toglili: restano solo i tuoi.
        </p>
        <button class="btn btn-ghost btn-sm" id="demo-pulisci">Rimuovi i dati di esempio</button>` : ''}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Assistente</h2>
          <span class="mode-tag ${assistantMode === 'modello' ? 'live' : ''}">
            ${assistantMode === 'modello' ? 'Modello linguistico attivo' : 'Modalità a regole'}
          </span>
        </div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:14px">
          ${assistantMode === 'modello'
            ? 'Solvia sta usando un modello linguistico reale per classificare le email e scrivere le bozze.'
            : 'Solvia sta usando regole deterministiche: funziona offline e senza costi, ma le bozze sono basate su modelli di testo predefiniti.'}
        </p>
        <p class="hint" style="margin-bottom:18px">
          Per attivare il modello linguistico, avvia il server con la variabile d'ambiente
          <code>ANTHROPIC_API_KEY</code> impostata. Il resto dell'applicazione non cambia.
        </p>

        <div class="card-head" style="margin-top:24px"><h2>Cosa non è ancora collegato</h2></div>
        <ul style="font-size:13.5px;color:var(--ink-2);padding-left:18px;line-height:1.9">
          <li>Lettura casella di posta (serve OAuth con Gmail/Outlook)</li>
          <li>Invio allo SDI per la fatturazione elettronica</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-head"><h2>Riepilogo annuale</h2></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:16px">
          Un PDF di una pagina con fatturato, incassato, spese per categoria e stima delle
          imposte. È il documento da girare al commercialista quando te lo chiede.
        </p>
        <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
          <select class="input" id="report-year" style="max-width:130px">
            ${[0, 1, 2].map((i) => {
              const y = new Date().getFullYear() - i;
              return `<option value="${y}">${y}</option>`;
            }).join('')}
          </select>
          <a class="btn btn-primary btn-sm" id="report-link"
             href="/api/finance/riepilogo/${new Date().getFullYear()}">Scarica il PDF</a>
        </div>
      </div>

      ${privacyCard()}

      ${state.user.is_admin ? `
      <div class="card">
        <div class="card-head"><h2>Amministrazione</h2>
          <span class="badge badge-blue">Solo per te</span></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:16px">
          Gestisci gli iscritti alla newsletter, scrivi le campagne e controlla
          cosa è stato inviato.
        </p>
        <a class="btn btn-primary btn-sm" href="/newsletter-admin">Apri la newsletter</a>
      </div>

      <div class="card">
        <div class="card-head"><h2>Configurazione pagamenti</h2>
          <span class="badge badge-blue">Solo per te</span></div>
        <p style="font-size:14px;color:var(--ink-2);margin-bottom:16px">
          Controlla in tempo reale se Stripe è collegato bene: chiave, prezzi e webhook.
          Ogni problema arriva con l'istruzione per risolverlo.
        </p>
        <button class="btn btn-primary btn-sm" id="diag-run">Verifica configurazione</button>
        <div id="diag-esito" style="margin-top:18px"></div>
      </div>` : ''}
    </div>`);

  document.getElementById('b-attesa-team')?.addEventListener('click', () => attesaModal(
    'Il piano Team mette fino a cinque persone sullo stesso archivio.',
  ));

  document.getElementById('b-attesa')?.addEventListener('click', () => attesaModal(
    'Il piano Pro toglie tutti i limiti: preventivi, clienti ed email illimitati.',
  ));

  wireStudio();

  document.getElementById('diag-run')?.addEventListener('click', runDiagnostica);

  document.getElementById('gdpr-delete')?.addEventListener('click', deleteAccountModal);

  document.getElementById('pw-salva')?.addEventListener('click', async () => {
    const okBox = document.getElementById('pw-ok');
    const errBox = document.getElementById('pw-err');
    okBox.classList.remove('show');
    errBox.classList.remove('show');

    const nuova = document.getElementById('pw-nuova').value;
    if (nuova !== document.getElementById('pw-ripeti').value) {
      errBox.textContent = 'Le due password non coincidono';
      return errBox.classList.add('show');
    }
    try {
      const r = await api('/auth/password', {
        method: 'POST',
        body: { current: document.getElementById('pw-attuale').value, password: nuova },
      });
      ['pw-attuale', 'pw-nuova', 'pw-ripeti'].forEach((id) => {
        document.getElementById(id).value = '';
      });
      okBox.textContent = r.message;
      okBox.classList.add('show');
      toast('Password aggiornata');
    } catch (e) {
      if (e.handled) return;
      errBox.textContent = e.message;
      errBox.classList.add('show');
    }
  });

  document.getElementById('demo-pulisci')?.addEventListener('click', () => {
    confirmModal(
      'Rimuovere i dati di esempio?',
      'Vengono cancellati clienti, fatture, preventivi, email, attività e spese caricati '
      + 'al primo accesso — insieme a tutto ciò che hai creato finora. L\'account e le '
      + 'impostazioni restano. L\'operazione non si annulla.',
      async () => {
        await api('/onboarding/pulisci', { method: 'POST' });
        const { user } = await api('/auth/me');
        state.user = user;
        toast('Dati di esempio rimossi');
        viewSettings();
      },
    );
  });

  document.getElementById('report-year')?.addEventListener('change', (e) => {
    document.getElementById('report-link').href = `/api/finance/riepilogo/${e.target.value}`;
  });

  document.querySelectorAll('[data-plan-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => startCheckout(btn.dataset.planUpgrade, btn));
  });

  document.getElementById('b-portal')?.addEventListener('click', async (e) => {
    try {
      const { url } = await api('/billing/portal', { method: 'POST' });
      window.location.href = url;
    } catch (err) { if (!err.handled) toast(err.message); }
  });

  document.getElementById('b-cancel')?.addEventListener('click', async () => {
    await api('/billing/demo-disdici', { method: 'POST' });
    toast('Abbonamento disdetto');
    viewSettings();
  });

  document.getElementById('s-save').addEventListener('click', async () => {
    const { user } = await api('/auth/me', {
      method: 'PUT',
      body: {
        name: document.getElementById('s-name').value,
        business_name: document.getElementById('s-business').value,
        vat_number: document.getElementById('s-vat').value,
        address: document.getElementById('s-address').value,
        default_vat: Number(document.getElementById('s-defvat').value),
        hourly_rate: Number(document.getElementById('s-rate').value),
      },
    });
    state.user = user;
    renderUserChip();
    document.getElementById('s-ok').classList.add('show');
    toast('Dati salvati');
  });
}

/* ============================ SPESE ============================ */

const EXPENSE_LABEL = {
  software: 'Software', attrezzatura: 'Attrezzatura', formazione: 'Formazione',
  trasferte: 'Trasferte', consulenze: 'Consulenze', marketing: 'Marketing',
  ufficio: 'Ufficio', altro: 'Altro',
};
const EXPENSE_COLORS = ['#4F46E5', '#7C3AED', '#0D9488', '#B45309', '#BE123C', '#0369A1', '#65A30D', '#64748B'];

async function viewExpenses() {
  setLoading();
  const d = await api('/finance/expenses');

  setHeader('Spese', `${eur(d.total)} nel ${d.year}`,
    '<button class="btn btn-primary btn-sm" data-action="new-expense">+ Nuova spesa</button>');

  const bar = d.byCategory.length ? `
    <div class="split-bar">
      ${d.byCategory.map((c, i) => `<div style="width:${(c.total / d.total) * 100}%;
        background:${EXPENSE_COLORS[i % EXPENSE_COLORS.length]}"></div>`).join('')}
    </div>
    <div class="split-legend">
      ${d.byCategory.map((c, i) => `<span><i style="background:${EXPENSE_COLORS[i % EXPENSE_COLORS.length]}"></i>
        ${esc(EXPENSE_LABEL[c.category] || c.category)} · ${eur(c.total)}</span>`).join('')}
    </div>` : '';

  setContent(`
    <div class="grid grid-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h2>Come si distribuiscono</h2></div>
        ${d.byCategory.length ? bar
          : '<p class="cell-muted" style="padding:14px 0">Nessuna spesa registrata quest\'anno.</p>'}
      </div>
      <div class="stat">
        <div class="stat-label">Totale ${esc(d.year)}</div>
        <div class="stat-value">${eur(d.total)}</div>
        <div class="stat-note">${d.expenses.length} spese registrate</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Elenco</h2></div>
      ${d.expenses.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th>
          <th>Fornitore</th><th class="num">Importo</th><th class="num">Azioni</th></tr></thead>
        <tbody>${d.expenses.map((e) => `<tr>
          <td class="cell-muted">${dmy(e.spent_on)}</td>
          <td class="cell-strong">${esc(e.description)}</td>
          <td><span class="badge badge-gray">${esc(EXPENSE_LABEL[e.category] || e.category)}</span></td>
          <td class="cell-muted">${esc(e.supplier || '—')}</td>
          <td class="num cell-strong">${eur(e.amount)}</td>
          <td><div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-edit-exp="${e.id}">Modifica</button>
            <button class="btn btn-danger btn-sm" data-del-exp="${e.id}">Elimina</button>
          </div></td></tr>`).join('')}</tbody>
      </table></div>`
      : emptyState('Nessuna spesa registrata.', 'Aggiungi la prima', 'btn-empty-exp')}
    </div>`);

  document.getElementById('btn-empty-exp')?.addEventListener('click', () => expenseModal(null, d.categories));
  document.querySelectorAll('[data-edit-exp]').forEach((b) => b.addEventListener('click', () =>
    expenseModal(d.expenses.find((e) => e.id === Number(b.dataset.editExp)), d.categories)));
  document.querySelectorAll('[data-del-exp]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/finance/expenses/${b.dataset.delExp}`, { method: 'DELETE' });
    toast('Spesa eliminata'); viewExpenses();
  }));
}

function expenseModal(expense, categories = Object.keys(EXPENSE_LABEL)) {
  openModal({
    title: expense ? 'Modifica spesa' : 'Nuova spesa',
    body: `
      <div class="field"><label>Descrizione</label>
        <input class="input" id="e-desc" value="${esc(expense?.description || '')}"
          placeholder="Es. Abbonamento Adobe"></div>
      <div class="row">
        <div class="field"><label>Importo</label>
          <input class="input" type="number" step="0.01" min="0" id="e-amount"
            value="${expense?.amount ?? ''}"></div>
        <div class="field"><label>Data</label>
          <input class="input" type="date" id="e-date" value="${expense?.spent_on || today()}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Categoria</label>
          <select class="input" id="e-cat">
            ${categories.map((c) => `<option value="${c}" ${expense?.category === c ? 'selected' : ''}>
              ${esc(EXPENSE_LABEL[c] || c)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Fornitore</label>
          <input class="input" id="e-supplier" value="${esc(expense?.supplier || '')}"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-primary" id="m-save">${expense ? 'Salva' : 'Aggiungi'}</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-save').addEventListener('click', async () => {
    const body = {
      description: document.getElementById('e-desc').value,
      amount: document.getElementById('e-amount').value,
      category: document.getElementById('e-cat').value,
      spent_on: document.getElementById('e-date').value,
      supplier: document.getElementById('e-supplier').value,
    };
    try {
      await api(expense ? `/finance/expenses/${expense.id}` : '/finance/expenses',
        { method: expense ? 'PUT' : 'POST', body });
      closeModal(); toast('Spesa salvata'); viewExpenses();
    } catch (e) { if (!e.handled) toast(e.message); }
  });
}

/* ========================= RICORRENTI ========================= */

async function viewRecurring() {
  setLoading();
  const [d, { clients }] = await Promise.all([api('/finance/recurring'), api('/clients')]);

  setHeader('Fatture ricorrenti', `${eur(d.monthlyValue)} al mese di ricavo ricorrente`,
    `<button class="btn btn-ghost btn-sm" data-action="run-recurring">Genera scadute</button>
     <button class="btn btn-primary btn-sm" data-action="new-recurring">+ Nuovo abbonamento</button>`);

  if (!d.recurring.length) {
    setContent(`<div class="card">
      <div style="text-align:center;padding:34px 20px;max-width:520px;margin:0 auto">
        <h2 style="font-size:19px;font-weight:800;margin-bottom:10px">Le fatture che si scrivono da sole</h2>
        <p style="color:var(--muted);font-size:14.5px;margin-bottom:20px">
          Hai clienti che paghi ogni mese la stessa cifra? Impostalo una volta e la fattura
          viene creata da sola alla scadenza. Tu la controlli e la invii.</p>
        <button class="btn btn-primary" id="btn-empty-rec">Crea il primo abbonamento</button>
      </div></div>`);
    document.getElementById('btn-empty-rec').addEventListener('click', () => recurringModal(null, clients));
    return;
  }

  setContent(`
    <div class="grid grid-stats" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Ricavo ricorrente mensile</div>
        <div class="stat-value">${eur(d.monthlyValue)}</div>
        <div class="stat-note">entrate prevedibili</div></div>
      <div class="stat"><div class="stat-label">Su base annua</div>
        <div class="stat-value">${eur(d.monthlyValue * 12)}</div>
        <div class="stat-note">se nulla cambia</div></div>
      <div class="stat"><div class="stat-label">Abbonamenti attivi</div>
        <div class="stat-value">${d.recurring.filter((r) => r.active).length}</div>
        <div class="stat-note">su ${d.recurring.length} totali</div></div>
      <div class="stat"><div class="stat-label">Fatture già generate</div>
        <div class="stat-value">${d.recurring.reduce((s, r) => s + r.runs, 0)}</div>
        <div class="stat-note">senza che tu facessi nulla</div></div>
    </div>

    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Abbonamento</th><th>Cliente</th><th>Cadenza</th>
          <th>Prossima</th><th class="num">Importo</th><th>Stato</th><th class="num">Azioni</th></tr></thead>
        <tbody>${d.recurring.map((r) => `<tr>
          <td class="cell-strong">${esc(r.name)}</td>
          <td>${esc(r.client_name || '—')}</td>
          <td class="cell-muted">${esc(r.frequencyLabel)}</td>
          <td class="cell-muted">${r.active ? dmy(r.next_run) : '—'}</td>
          <td class="num cell-strong">${eur(r.total)}</td>
          <td>${r.active ? '<span class="badge badge-green">Attivo</span>'
            : '<span class="badge badge-gray">In pausa</span>'}</td>
          <td><div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-gen-rec="${r.id}">Genera ora</button>
            <button class="btn btn-ghost btn-sm" data-edit-rec="${r.id}">Apri</button>
          </div></td></tr>`).join('')}</tbody>
      </table></div>
    </div>`);

  document.querySelectorAll('[data-edit-rec]').forEach((b) => b.addEventListener('click', () =>
    recurringModal(d.recurring.find((r) => r.id === Number(b.dataset.editRec)), clients)));
  document.querySelectorAll('[data-gen-rec]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/finance/recurring/${b.dataset.genRec}/genera`, { method: 'POST' });
    toast(r.ok ? `Fattura ${r.number} creata` : r.error);
    viewRecurring();
  }));
}

let recurringItems = [];

function recurringModal(rec, clients) {
  recurringItems = rec?.items?.length
    ? rec.items.map((i) => ({ ...i })) : [{ description: '', quantity: 1, unit_price: 0 }];

  const rows = () => recurringItems.map((it, i) => `
    <tr>
      <td><input class="input" data-ritem="${i}" data-field="description"
        value="${esc(it.description)}" placeholder="Descrizione"></td>
      <td style="width:80px"><input class="input" type="number" step="0.5" min="0"
        data-ritem="${i}" data-field="quantity" value="${it.quantity}"></td>
      <td style="width:110px"><input class="input" type="number" step="0.01" min="0"
        data-ritem="${i}" data-field="unit_price" value="${it.unit_price}"></td>
      <td style="width:40px;text-align:right">
        <button class="btn btn-ghost btn-sm" data-rrem="${i}">×</button></td>
    </tr>`).join('');

  openModal({
    wide: true,
    title: rec ? `Abbonamento: ${rec.name}` : 'Nuovo abbonamento',
    body: `
      <div class="row">
        <div class="field"><label>Nome</label>
          <input class="input" id="r-name" value="${esc(rec?.name || '')}"
            placeholder="Es. Manutenzione sito mensile"></div>
        <div class="field"><label>Cliente</label>
          <select class="input" id="r-client">
            <option value="">— Nessuno —</option>
            ${clients.map((c) => `<option value="${c.id}"
              ${String(rec?.client_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
      </div>
      <div class="row">
        <div class="field"><label>Cadenza</label>
          <select class="input" id="r-freq">
            ${['mensile', 'bimestrale', 'trimestrale', 'semestrale', 'annuale'].map((f) =>
              `<option value="${f}" ${rec?.frequency === f ? 'selected' : ''}>
                ${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Prossima emissione</label>
          <input class="input" type="date" id="r-next" value="${rec?.next_run || today()}"></div>
      </div>

      <label style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:10px 0 6px">Voci</label>
      <table class="items-table"><thead><tr><th>Descrizione</th><th>Qtà</th><th>Prezzo</th><th></th></tr></thead>
        <tbody id="r-items">${rows()}</tbody></table>
      <button class="btn btn-ghost btn-sm" id="r-add" style="margin-top:8px">+ Aggiungi voce</button>

      <div class="row" style="margin-top:18px">
        <div class="field"><label>IVA %</label>
          <input class="input" type="number" id="r-vat" value="${rec?.vat_rate ?? state.user.default_vat}"></div>
        <div class="field"><label>Ritenuta %</label>
          <input class="input" type="number" id="r-wh" value="${rec?.withholding ?? 0}"></div>
      </div>

      <div class="field">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
          <input type="checkbox" id="r-active" ${rec ? (rec.active ? 'checked' : '') : 'checked'}
            style="width:16px;height:16px">
          <span>Attivo — genera le fatture automaticamente</span></label>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
          <input type="checkbox" id="r-autosend" ${rec?.auto_send ? 'checked' : ''}
            style="width:16px;height:16px">
          <span>Crea la fattura già come "inviata" invece che come bozza</span></label>
        <p class="hint">Lasciato spento, ogni fattura resta in bozza finché non la controlli tu.</p>
      </div>`,
    footer: `${rec ? '<button class="btn btn-danger" id="r-del">Elimina</button>' : ''}
      <button class="btn btn-ghost" id="m-cancel">Annulla</button>
      <button class="btn btn-primary" id="r-save">${rec ? 'Salva' : 'Crea abbonamento'}</button>`,
  });

  const wire = () => {
    document.getElementById('r-items').innerHTML = rows();
    document.querySelectorAll('[data-ritem]').forEach((inp) => inp.addEventListener('input', () => {
      const it = recurringItems[Number(inp.dataset.ritem)];
      it[inp.dataset.field] = inp.dataset.field === 'description' ? inp.value : Number(inp.value);
    }));
    document.querySelectorAll('[data-rrem]').forEach((b) => b.addEventListener('click', () => {
      if (recurringItems.length === 1) return toast('Serve almeno una voce');
      recurringItems.splice(Number(b.dataset.rrem), 1); wire();
    }));
  };
  wire();

  document.getElementById('r-add').addEventListener('click', () => {
    recurringItems.push({ description: '', quantity: 1, unit_price: 0 }); wire();
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);

  document.getElementById('r-save').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('r-name').value,
      client_id: document.getElementById('r-client').value || null,
      frequency: document.getElementById('r-freq').value,
      next_run: document.getElementById('r-next').value,
      vat_rate: Number(document.getElementById('r-vat').value),
      withholding: Number(document.getElementById('r-wh').value),
      active: document.getElementById('r-active').checked,
      auto_send: document.getElementById('r-autosend').checked,
      items: recurringItems.filter((i) => i.description.trim()),
    };
    try {
      const res = await api(rec ? `/finance/recurring/${rec.id}` : '/finance/recurring',
        { method: rec ? 'PUT' : 'POST', body });
      if (!res.ok) return toast(res.error);
      closeModal(); toast('Abbonamento salvato'); viewRecurring();
    } catch (e) { if (!e.handled) toast(e.message); }
  });

  document.getElementById('r-del')?.addEventListener('click', async () => {
    await api(`/finance/recurring/${rec.id}`, { method: 'DELETE' });
    closeModal(); toast('Abbonamento eliminato'); viewRecurring();
  });
}

/* ========================== SOLLECITI ========================== */

async function viewReminders() {
  setLoading();
  const d = await api('/finance/reminders');
  const pending = d.reminders.filter((r) => r.status === 'da_approvare');

  setHeader('Solleciti', `${pending.length} pronti da approvare`);
  document.getElementById('count-reminders').textContent = pending.length;
  document.getElementById('count-reminders').classList.toggle('hidden', !pending.length);

  if (!d.reminders.length) {
    setContent(`<div class="card">
      <div style="text-align:center;padding:34px 20px;max-width:540px;margin:0 auto">
        <h2 style="font-size:19px;font-weight:800;margin-bottom:10px">Nessuna fattura scaduta</h2>
        <p style="color:var(--muted);font-size:14.5px">
          Quando una fattura supera la scadenza, Solvia prepara qui il sollecito da inviare:
          gentile dopo 3 giorni, più deciso dopo due settimane, formale dopo un mese.
          Nulla parte senza la tua approvazione.</p>
      </div></div>`);
    return;
  }

  const card = (r) => `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div>
          <h2>${esc(r.client_name || 'Cliente')} — ${esc(r.number)}</h2>
          <div class="cell-muted" style="font-size:12.5px;margin-top:3px">
            ${eur(r.total)} · scaduta il ${dmy(r.due_date)}
          </div>
        </div>
        <div style="display:flex;gap:7px;align-items:center">
          <span class="badge ${r.level === 3 ? 'badge-red' : r.level === 2 ? 'badge-amber' : 'badge-blue'}">
            Livello ${r.level}</span>
          ${r.status === 'inviato' ? '<span class="badge badge-green">Inviato</span>' : ''}
          ${r.status === 'annullato' ? '<span class="badge badge-gray">Annullato</span>' : ''}
        </div>
      </div>

      ${r.status === 'da_approvare' ? `
        <div class="field"><label>Oggetto</label>
          <input class="input" data-rem-subject="${r.id}" value="${esc(r.subject)}"></div>
        <div class="field"><label>Testo — modificalo come vuoi</label>
          <textarea class="input" data-rem-body="${r.id}" style="min-height:180px">${esc(r.body)}</textarea></div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-rem-send="${r.id}">Approva e invia</button>
          <button class="btn btn-ghost btn-sm" data-rem-save="${r.id}">Salva modifiche</button>
          <button class="btn btn-ghost btn-sm" data-rem-skip="${r.id}">Non inviare</button>
        </div>
        ${!r.client_email ? `<p class="hint" style="color:var(--danger);margin-top:10px">
          Questo cliente non ha un indirizzo email: aggiungilo in anagrafica per poter inviare.</p>` : ''}
      ` : `<p class="mail-body" style="font-size:13.5px;color:var(--muted)">${esc(r.body.slice(0, 200))}…</p>`}
    </div>`;

  setContent(`
    ${pending.length ? `<div class="card" style="margin-bottom:16px;background:var(--primary-soft);border-color:#C7D2FE">
      <p style="font-size:14px;color:var(--ink-2)">
        <strong>${pending.length} solleciti pronti.</strong> Li ho scritti io in base a quanto è
        vecchio il ritardo. Leggi, correggi se vuoi, e invia — o lascia perdere.</p>
    </div>` : ''}
    ${d.reminders.map(card).join('')}`);

  document.querySelectorAll('[data-rem-send]').forEach((b) => b.addEventListener('click', async (e) => {
    const id = b.dataset.remSend;
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Invio…';
    await api(`/finance/reminders/${id}`, {
      method: 'PUT',
      body: {
        subject: document.querySelector(`[data-rem-subject="${id}"]`).value,
        body: document.querySelector(`[data-rem-body="${id}"]`).value,
      },
    });
    const res = await api(`/finance/reminders/${id}/invia`, { method: 'POST' });
    toast(res.ok ? 'Sollecito inviato' : res.error);
    viewReminders();
  }));

  document.querySelectorAll('[data-rem-save]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.remSave;
    await api(`/finance/reminders/${id}`, {
      method: 'PUT',
      body: {
        subject: document.querySelector(`[data-rem-subject="${id}"]`).value,
        body: document.querySelector(`[data-rem-body="${id}"]`).value,
      },
    });
    toast('Modifiche salvate');
  }));

  document.querySelectorAll('[data-rem-skip]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/finance/reminders/${b.dataset.remSkip}/annulla`, { method: 'POST' });
    toast('Sollecito annullato'); viewReminders();
  }));
}

/* ============================ TASSE ============================ */

async function viewTax() {
  setLoading();
  const d = await api('/finance/tax');
  const t = d.onCollected;

  setHeader('Tasse da accantonare', `Stima sull'incassato ${d.year}`);

  setContent(`
    <div class="grid grid-3" style="margin-bottom:16px">
      <div>
        <div class="tax-card" style="margin-bottom:16px">
          <div class="label">Metti da parte</div>
          <div class="value">${eur(t.total)}</div>
          <div style="font-size:13px;opacity:.88;margin-top:6px">
            ${t.percentOfRevenue}% di quanto hai incassato quest'anno
          </div>
          <div class="split">
            <div><div class="k">Imposta ${t.taxRate}%</div><div class="v">${eur(t.tax)}</div></div>
            <div><div class="k">Contributi INPS</div><div class="v">${eur(t.inps)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Come ci arrivo</h2></div>
          <div class="items-total"><span>Incassato ${esc(d.year)} (imponibile)</span>
            <span>${eur(d.collected)}</span></div>
          <div class="items-total"><span>Coefficiente di redditività ${t.coefficient}%</span>
            <span>${eur(t.taxable)}</span></div>
          <div class="items-total"><span>− Contributi ${esc(t.inpsLabel.split('(')[0].trim())}${t.inpsReduced ? ' (ridotti 35%)' : ''}</span>
            <span>− ${eur(t.inps)}</span></div>
          <div class="items-total"><span>Imponibile netto</span>
            <span>${eur(Math.max(0, t.taxable - t.inps))}</span></div>
          <div class="items-total"><span>Imposta sostitutiva ${t.taxRate}%</span>
            <span>${eur(t.tax)}</span></div>
          <div class="items-total grand"><span>Totale da accantonare</span><span>${eur(t.total)}</span></div>

          <p class="hint" style="margin-top:16px;padding:12px 14px;background:var(--warn-soft);
             border-radius:9px;color:var(--warn)">
            <strong>Stima indicativa.</strong> Aliquote e minimali cambiano ogni anno e il
            coefficiente dipende dal tuo codice ATECO. Serve a sapere quanto non spendere,
            non a compilare l'F24: per quello c'è il commercialista.
          </p>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h2>Il tuo anno</h2></div>
          <div class="items-total"><span>Incassato</span><span>${eur(d.collected)}</span></div>
          <div class="items-total"><span>Spese</span><span>− ${eur(d.expenses)}</span></div>
          <div class="items-total"><span>Tasse stimate</span><span>− ${eur(t.total)}</span></div>
          <div class="items-total grand"><span>Ti resta</span><span>${eur(d.profit)}</span></div>
          ${d.invoiced > d.collected ? `<p class="hint" style="margin-top:12px">
            Hai fatturato ${eur(d.invoiced)} ma incassato ${eur(d.collected)}:
            se incassi tutto, le tasse salgono a ${eur(d.onInvoiced.total)}.</p>` : ''}
        </div>

        <div class="card">
          <div class="card-head"><h2>La tua situazione fiscale</h2></div>
          <div class="alert alert-ok" id="tax-ok">Impostazioni salvate.</div>

          <div class="field"><label>Regime</label>
            <select class="input" id="t-regime">
              <option value="forfettario" ${d.settings.tax_regime === 'forfettario' ? 'selected' : ''}>Forfettario</option>
              <option value="ordinario" ${d.settings.tax_regime === 'ordinario' ? 'selected' : ''}>Ordinario (stima grezza)</option>
            </select></div>

          <div class="field"><label>Coefficiente di redditività %</label>
            <input class="input" type="number" id="t-coef" value="${d.settings.tax_coefficient}">
            <p class="hint">Dipende dal codice ATECO: 78% per molte professioni, 67% per il commercio, 40% per il cibo.</p></div>

          <div class="field"><label>Imposta sostitutiva %</label>
            <select class="input" id="t-rate">
              <option value="5" ${Number(d.settings.tax_rate) === 5 ? 'selected' : ''}>5% — primi 5 anni di attività</option>
              <option value="15" ${Number(d.settings.tax_rate) === 15 ? 'selected' : ''}>15% — ordinaria</option>
            </select></div>

          <div class="field"><label>Cassa previdenziale</label>
            <select class="input" id="t-inps">
              ${d.options.map((o) => `<option value="${o.id}"
                ${d.settings.inps_type === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select></div>

          <div class="field">
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
              <input type="checkbox" id="t-reduction" ${d.settings.inps_reduction ? 'checked' : ''}
                style="width:16px;height:16px">
              <span>Riduzione contributiva del 35%</span></label>
            <p class="hint">Solo per artigiani e commercianti in forfettario, va richiesta all'INPS.</p>
          </div>

          <button class="btn btn-primary" id="t-save">Salva</button>
        </div>
      </div>
    </div>`);

  document.getElementById('t-save').addEventListener('click', async () => {
    await api('/finance/tax/settings', {
      method: 'PUT',
      body: {
        tax_regime: document.getElementById('t-regime').value,
        tax_coefficient: Number(document.getElementById('t-coef').value),
        tax_rate: Number(document.getElementById('t-rate').value),
        inps_type: document.getElementById('t-inps').value,
        inps_reduction: document.getElementById('t-reduction').checked,
      },
    });
    toast('Impostazioni fiscali salvate');
    viewTax();
  });
}

/* ============================= ORE ============================= */

let timerTick = null;

const hhmm = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

async function viewTime() {
  setLoading();
  const [d, { clients }] = await Promise.all([api('/time'), api('/clients')]);

  clearInterval(timerTick);

  setHeader('Ore lavorate', `${hhmm(d.totals.minutes)} questo mese · ${eur(d.totals.billableAmount)} da fatturare`,
    `${d.totals.billableCount ? '<button class="btn btn-primary btn-sm" data-action="bill-time">Fattura le ore</button>' : ''}
     <button class="btn btn-ghost btn-sm" data-action="new-time">+ Aggiungi a mano</button>`);

  document.getElementById('count-time').textContent = d.totals.billableCount;
  document.getElementById('count-time').classList.toggle('hidden', !d.totals.billableCount);

  const r = d.running;

  setContent(`
    <div class="card" style="margin-bottom:16px;${r ? 'border-color:var(--accent);background:var(--accent-soft)' : ''}">
      ${r ? `
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <div style="font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;color:#0F766E"
               id="timer-display">${hhmm(r.minutes)}</div>
          <div style="flex:1;min-width:160px">
            <div style="font-weight:600;font-size:15px">${esc(r.description)}</div>
            <div class="cell-muted" style="font-size:13px">
              ${esc(r.client_name || 'Senza cliente')} · ${eur(r.hourly_rate)}/ora
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="t-stop">Ferma e registra</button>
          <button class="btn btn-ghost btn-sm" id="t-cancel">Annulla</button>
        </div>`
      : `
        <div class="card-head" style="margin-bottom:12px"><h2>Avvia il cronometro</h2></div>
        <div class="row" style="flex-wrap:wrap">
          <div class="field" style="min-width:200px"><label>Cosa stai facendo</label>
            <input class="input" id="t-desc" placeholder="Es. Revisione grafica homepage"></div>
          <div class="field" style="min-width:150px"><label>Cliente</label>
            <select class="input" id="t-client">
              <option value="">— Nessuno —</option>
              ${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="field" style="max-width:130px"><label>€ / ora</label>
            <input class="input" type="number" id="t-rate" value="${d.defaultRate || 40}"></div>
        </div>
        <button class="btn btn-primary" id="t-start">▶ Avvia</button>`}
    </div>

    <div class="grid grid-stats" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Ore del mese</div>
        <div class="stat-value">${hhmm(d.totals.minutes)}</div>
        <div class="stat-note">tutte le voci registrate</div></div>
      <div class="stat"><div class="stat-label">Da fatturare</div>
        <div class="stat-value">${eur(d.totals.billableAmount)}</div>
        <div class="stat-note ${d.totals.billableCount ? 'warn' : ''}">${d.totals.billableCount} voci in attesa</div></div>
      <div class="stat"><div class="stat-label">Ore fatturabili</div>
        <div class="stat-value">${hhmm(d.totals.billableMinutes)}</div>
        <div class="stat-note">non ancora messe in fattura</div></div>
      <div class="stat"><div class="stat-label">Clienti seguiti</div>
        <div class="stat-value">${d.byClient.length}</div>
        <div class="stat-note">nel mese in corso</div></div>
    </div>

    ${d.byClient.length ? `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Dove è andato il tempo</h2></div>
      ${d.byClient.map((c) => `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:14px">${esc(c.name)}</span>
          <span class="cell-muted" style="font-size:13px">${hhmm(c.minutes)}</span>
          <span class="cell-strong" style="min-width:80px;text-align:right">${eur(c.amount)}</span>
        </div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="card-head"><h2>Registro</h2></div>
      ${d.entries.filter((e) => !e.running).length ? `<div class="table-wrap"><table>
        <thead><tr><th>Data</th><th>Descrizione</th><th>Cliente</th>
          <th class="num">Tempo</th><th class="num">Importo</th><th>Stato</th><th class="num"></th></tr></thead>
        <tbody>${d.entries.filter((e) => !e.running).map((e) => `<tr>
          <td class="cell-muted">${dmy(e.work_date)}</td>
          <td class="cell-strong">${esc(e.description)}</td>
          <td class="cell-muted">${esc(e.client_name || '—')}</td>
          <td class="num">${hhmm(e.minutes)}</td>
          <td class="num cell-strong">${eur(e.amount)}</td>
          <td>${e.billed_on ? '<span class="badge badge-green">Fatturata</span>'
            : e.billable ? '<span class="badge badge-amber">Da fatturare</span>'
            : '<span class="badge badge-gray">Non fatturabile</span>'}</td>
          <td><div class="row-actions">
            <button class="btn btn-danger btn-sm" data-del-time="${e.id}">Elimina</button>
          </div></td></tr>`).join('')}</tbody>
      </table></div>`
      : '<p class="cell-muted" style="padding:16px 0">Nessuna ora registrata questo mese.</p>'}
    </div>`);

  // Il cronometro sullo schermo avanza da solo, senza ricaricare la pagina
  if (r) {
    let mins = r.minutes;
    timerTick = setInterval(() => {
      mins += 1;
      const el = document.getElementById('timer-display');
      if (el) el.textContent = hhmm(mins); else clearInterval(timerTick);
    }, 60000);
  }

  document.getElementById('t-start')?.addEventListener('click', async () => {
    await api('/time/start', {
      method: 'POST',
      body: {
        description: document.getElementById('t-desc').value || 'Lavoro in corso',
        client_id: document.getElementById('t-client').value || null,
        hourly_rate: Number(document.getElementById('t-rate').value),
      },
    });
    toast('Cronometro avviato');
    viewTime();
  });

  document.getElementById('t-stop')?.addEventListener('click', async () => {
    const res = await api('/time/stop', { method: 'POST' });
    toast(`Registrate ${hhmm(res.entry.minutes)}`);
    viewTime();
  });

  document.getElementById('t-cancel')?.addEventListener('click', async () => {
    await api('/time/cancel', { method: 'POST' });
    toast('Cronometro annullato');
    viewTime();
  });

  document.querySelectorAll('[data-del-time]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/time/${b.dataset.delTime}`, { method: 'DELETE' });
    toast('Voce eliminata');
    viewTime();
  }));
}

function timeModal(clients) {
  openModal({
    title: 'Aggiungi ore a mano',
    body: `
      <div class="field"><label>Cosa hai fatto</label>
        <input class="input" id="m-desc" placeholder="Es. Chiamata con il cliente"></div>
      <div class="row">
        <div class="field"><label>Cliente</label>
          <select class="input" id="m-client">
            <option value="">— Nessuno —</option>
            ${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Data</label>
          <input class="input" type="date" id="m-date" value="${today()}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Ore</label>
          <input class="input" type="number" min="0" id="m-hours" value="1"></div>
        <div class="field"><label>Minuti</label>
          <input class="input" type="number" min="0" max="59" id="m-mins" value="0"></div>
        <div class="field"><label>€ / ora</label>
          <input class="input" type="number" id="m-rate" value="${state.user.hourly_rate || 40}"></div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
          <input type="checkbox" id="m-billable" checked style="width:16px;height:16px">
          <span>Fatturabile</span></label>
      </div>`,
    footer: `<button class="btn btn-ghost" id="m-cancel">Annulla</button>
             <button class="btn btn-primary" id="m-save">Registra</button>`,
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-save').addEventListener('click', async () => {
    try {
      await api('/time', {
        method: 'POST',
        body: {
          description: document.getElementById('m-desc').value,
          client_id: document.getElementById('m-client').value || null,
          work_date: document.getElementById('m-date').value,
          hours: Number(document.getElementById('m-hours').value),
          minutes: Number(document.getElementById('m-mins').value),
          hourly_rate: Number(document.getElementById('m-rate').value),
          billable: document.getElementById('m-billable').checked,
        },
      });
      closeModal(); toast('Ore registrate'); viewTime();
    } catch (e) { if (!e.handled) toast(e.message); }
  });
}

/* ======================= RICERCA GLOBALE ======================= */

let searchTimer = null;
let searchSelection = 0;
let searchResults = [];

function openSearch() {
  document.getElementById('search-backdrop').classList.add('open');
  const input = document.getElementById('search-input');
  input.value = '';
  input.focus();
  document.getElementById('search-results').innerHTML =
    '<div class="search-empty">Scrivi almeno due lettere per cercare.</div>';
  searchResults = [];
  searchSelection = 0;
}

const closeSearch = () => document.getElementById('search-backdrop').classList.remove('open');

function renderSearch() {
  const box = document.getElementById('search-results');
  if (!searchResults.length) {
    box.innerHTML = '<div class="search-empty">Nessun risultato.</div>';
    return;
  }
  box.innerHTML = searchResults.map((r, i) => `
    <div class="search-item ${i === searchSelection ? 'sel' : ''}" data-idx="${i}">
      <span class="type">${esc(r.type)}</span>
      <span class="txt"><strong>${esc(r.title)}</strong><span>${esc(r.subtitle)}</span></span>
    </div>`).join('');

  box.querySelectorAll('[data-idx]').forEach((el) => el.addEventListener('click', () => {
    goToResult(searchResults[Number(el.dataset.idx)]);
  }));
}

function goToResult(result) {
  if (!result) return;
  closeSearch();
  navigate(result.view);
}

async function runSearch(q) {
  if (q.trim().length < 2) {
    searchResults = [];
    document.getElementById('search-results').innerHTML =
      '<div class="search-empty">Scrivi almeno due lettere per cercare.</div>';
    return;
  }
  const { results } = await api(`/finance/search?q=${encodeURIComponent(q)}`);
  searchResults = results;
  searchSelection = 0;
  renderSearch();
}

/* ============================ TEMA ============================ */

const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke-linecap="round"/></svg>';
const MOON = '<svg viewBox="0 0 24 24"><path d="M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = theme === 'scuro' ? SUN : MOON;
    btn.title = theme === 'scuro' ? 'Passa al tema chiaro' : 'Passa al tema scuro';
  }
}

async function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'scuro' ? 'chiaro' : 'scuro';
  applyTheme(next);
  state.user.theme = next;
  // Salvato sul profilo: resta anche cambiando dispositivo.
  try { await api('/auth/me', { method: 'PUT', body: { theme: next } }); } catch { /* non critico */ }
  if (state.view === 'dashboard') viewDashboard();
}

/* ============================ ROUTER ============================ */

const VIEWS = {
  benvenuto: { title: 'Benvenuto', run: viewBenvenuto },
  dashboard: { title: 'Dashboard', run: viewDashboard },
  inbox: { title: 'Inbox', run: viewInbox },
  tasks: { title: 'Attività', run: viewTasks },
  quotes: { title: 'Preventivi', run: () => viewDocuments('preventivo') },
  invoices: { title: 'Fatture', run: () => viewDocuments('fattura') },
  recurring: { title: 'Ricorrenti', run: viewRecurring },
  reminders: { title: 'Solleciti', run: viewReminders },
  time: { title: 'Ore', run: viewTime },
  expenses: { title: 'Spese', run: viewExpenses },
  tax: { title: 'Tasse', run: viewTax },
  clients: { title: 'Clienti', run: viewClients },
  settings: { title: 'Impostazioni', run: viewSettings },
};

async function navigate(view) {
  if (!VIEWS[view]) view = 'dashboard';
  // Finché la configurazione iniziale non è finita non si esce di lì: sezioni
  // vuote al primo accesso confondono e basta.
  if (state.user && !state.user.onboarded) view = 'benvenuto';
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('sidebar').classList.remove('open');
  if (window.location.hash.slice(1) !== view) window.location.hash = view;
  try {
    await VIEWS[view].run();
  } catch (e) {
    // Gli errori già gestiti (es. limite del piano) hanno la loro finestra: non
    // sostituire il contenuto con una schermata d'errore.
    if (!e.handled) {
      setContent(`<div class="card"><p style="color:var(--danger)">${esc(e.message)}</p></div>`);
    }
  }
}

/* Tasti Indietro/Avanti del browser e link diretti a una sezione */
window.addEventListener('hashchange', () => {
  const view = window.location.hash.slice(1) || 'dashboard';
  if (view !== state.view) navigate(view);
});

/* Azioni globali delegate (bottoni della topbar e delle card) */
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  const actions = {
    'new-invoice': () => openDocumentEditor({ kind: 'fattura' }),
    'new-quote': () => openDocumentEditor({ kind: 'preventivo' }),
    'new-client': () => clientModal(),
    'new-task': newTaskModal,
    'new-email': newEmailModal,
    'triage-all': triageAll,
    'go-invoices': () => navigate('invoices'),
    'go-tasks': () => navigate('tasks'),
    'go-clients': () => navigate('clients'),
    'go-tax': () => navigate('tax'),
    'go-reminders': () => navigate('reminders'),
    'new-expense': () => expenseModal(),
    'new-time': async () => timeModal((await api('/clients')).clients),
    'bill-time': async () => {
      const res = await api('/time/fattura', { method: 'POST', body: {} });
      if (!res.ok) return toast(res.error);
      toast(`Fattura ${res.number} creata da ${res.items} voci`);
      navigate('invoices');
    },
    'new-recurring': async () => recurringModal(null, (await api('/clients')).clients),
    'run-recurring': async () => {
      const r = await api('/finance/recurring/esegui', { method: 'POST' });
      toast(r.generated ? `${r.generated} fatture generate` : 'Nessuna scadenza da generare');
      viewRecurring();
    },
  };
  actions[trigger.dataset.action]?.();
});

document.getElementById('nav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (item) navigate(item.dataset.view);
});

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

function renderUserChip() {
  const initials = state.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('user-initials').textContent = initials;
  document.getElementById('user-name').textContent = state.user.name;
  document.getElementById('user-email').textContent = state.user.email;
}

/* Scorciatoie da tastiera */
document.getElementById('search-trigger')?.addEventListener('click', openSearch);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
document.getElementById('search-backdrop')?.addEventListener('click', (e) => {
  if (e.target.id === 'search-backdrop') closeSearch();
});

document.getElementById('search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(() => runSearch(q), 180);
});

document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + K apre la ricerca da qualsiasi punto dell'applicazione
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (!document.getElementById('search-backdrop')?.classList.contains('open')) return;

  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!searchResults.length) return;
    searchSelection = (searchSelection + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length)
      % searchResults.length;
    renderSearch();
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    goToResult(searchResults[searchSelection]);
  }
});

/* Registrazione del service worker: rende l'app installabile sulla schermata
   home e permette di aprirla anche senza rete. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Se fallisce l'app funziona lo stesso: si perde solo l'installazione.
    });
  });
}

/* Invito a installare, mostrato solo se Android lo propone davvero */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  const btn = document.getElementById('install-app');
  if (btn) btn.classList.remove('hidden');
});

document.getElementById('install-app')?.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('install-app').classList.add('hidden');
    toast('Solvia è ora sulla tua schermata home');
  }
  installPrompt = null;
});

(async function start() {
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    applyTheme(user.theme || 'chiaro');
    renderUserChip();
    // Il corpo prende la classe "onboarding": la barra laterale resta visibile
    // ma non cliccabile, così si capisce cosa c'è dopo senza poterci finire
    // dentro a metà configurazione.
    document.body.classList.toggle('onboarding', !user.onboarded);
    navigate(user.onboarded ? (window.location.hash.slice(1) || 'dashboard') : 'benvenuto');
  } catch {
    window.location.href = '/accedi';
  }
})();
