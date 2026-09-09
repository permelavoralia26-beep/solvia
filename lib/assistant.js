'use strict';

/**
 * Motore dell'assistente Solvia.
 *
 * Due modalità:
 *  - "regole"  (default): euristiche deterministiche, nessuna chiamata esterna, funziona offline.
 *  - "modello" (se ANTHROPIC_API_KEY è impostata): usa un modello linguistico reale.
 *
 * Il resto dell'applicazione chiama sempre le stesse funzioni: cambia solo la qualità
 * dell'output, non l'integrazione.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || null;
const MODEL = process.env.SOLVIA_MODEL || 'claude-sonnet-4-5';
const MODE = API_KEY ? 'modello' : 'regole';

/* ------------------------------------------------------------------ */
/* Chiamata al modello (usata solo se è presente una API key)          */
/* ------------------------------------------------------------------ */

async function askModel(system, prompt, maxTokens = 800) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Errore API modello: ${res.status}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

/* ------------------------------------------------------------------ */
/* Triage email                                                        */
/* ------------------------------------------------------------------ */

const RULES = [
  {
    category: 'richiesta_preventivo',
    label: 'Richiesta di preventivo',
    priority: 'alta',
    keywords: ['preventivo', 'quotazione', 'quanto costa', 'costo', 'tariffa', 'budget', 'offerta'],
  },
  {
    category: 'pagamento',
    label: 'Pagamento / fattura',
    priority: 'alta',
    keywords: ['fattura', 'pagamento', 'bonifico', 'saldo', 'scadenza', 'insoluto', 'sollecito'],
  },
  {
    category: 'appuntamento',
    label: 'Appuntamento',
    priority: 'media',
    keywords: ['appuntamento', 'call', 'riunione', 'incontro', 'disponibilità', 'agenda', 'meeting'],
  },
  {
    category: 'progetto',
    label: 'Progetto in corso',
    priority: 'media',
    keywords: ['progetto', 'consegna', 'revisione', 'feedback', 'modifica', 'aggiornamento', 'stato'],
  },
  {
    category: 'amministrativo',
    label: 'Amministrativo',
    priority: 'bassa',
    keywords: ['contratto', 'documento', 'firma', 'privacy', 'dati', 'anagrafica'],
  },
];

const URGENT_HINTS = ['urgente', 'entro oggi', 'entro domani', 'al più presto', 'asap', 'scaduto'];

function classifyByRules(email) {
  const text = `${email.subject} ${email.body}`.toLowerCase();

  let best = null;
  let bestScore = 0;
  for (const rule of RULES) {
    const score = rule.keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  const urgent = URGENT_HINTS.some((h) => text.includes(h));
  const category = best ? best.category : 'da_smistare';
  const label = best ? best.label : 'Da smistare';
  let priority = best ? best.priority : 'bassa';
  if (urgent) priority = 'alta';

  const firstSentence = email.body.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) || email.subject;
  const summary = `${label}${urgent ? ' · segnalata come urgente' : ''} — ${
    firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence
  }`;

  return { category, label, priority, summary };
}

async function triageEmail(email) {
  const fallback = classifyByRules(email);
  if (MODE === 'regole') return fallback;

  try {
    const out = await askModel(
      'Sei un assistente che smista email per freelance italiani. Rispondi SOLO con JSON valido, nessun altro testo.',
      `Classifica questa email.

Da: ${email.from_name} <${email.from_email}>
Oggetto: ${email.subject}
Testo: ${email.body}

Rispondi con JSON: {"category": una tra richiesta_preventivo|pagamento|appuntamento|progetto|amministrativo|da_smistare, "priority": una tra alta|media|bassa, "summary": "riassunto in una frase in italiano"}`,
      400,
    );
    const parsed = JSON.parse(out.replace(/^```json\s*|\s*```$/g, ''));
    return {
      category: parsed.category || fallback.category,
      label: RULES.find((r) => r.category === parsed.category)?.label || fallback.label,
      priority: ['alta', 'media', 'bassa'].includes(parsed.priority) ? parsed.priority : fallback.priority,
      summary: parsed.summary || fallback.summary,
    };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Bozze di risposta                                                   */
/* ------------------------------------------------------------------ */

const REPLY_TEMPLATES = {
  richiesta_preventivo: (e, u) =>
`Gentile ${e.from_name},

grazie per averci contattato e per l'interesse verso i nostri servizi.

Ho preso nota della sua richiesta: le preparo un preventivo dettagliato e glielo invio entro 48 ore. Per completarlo al meglio, se possibile mi confermi i tempi di consegna desiderati e l'ambito preciso del lavoro.

Resto a disposizione per qualsiasi chiarimento.

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,

  pagamento: (e, u) =>
`Gentile ${e.from_name},

grazie per il suo messaggio riguardo alla fatturazione.

Ho verificato la posizione e le confermo che provvedo ad aggiornarla al più presto con tutti i dettagli richiesti. Se le serve una copia del documento o una rettifica, me lo faccia sapere e la invio subito.

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,

  appuntamento: (e, u) =>
`Gentile ${e.from_name},

grazie per la proposta di incontro.

Sono disponibile nei prossimi giorni: le propongo alcune fasce orarie e mi adatto volentieri a quella più comoda per lei. Mi confermi il canale che preferisce (chiamata, videocall o di persona).

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,

  progetto: (e, u) =>
`Gentile ${e.from_name},

grazie per l'aggiornamento.

Ho preso in carico quanto segnalato e procedo con le attività necessarie. Le invio un riscontro sullo stato di avanzamento a breve, così da tenerla allineata sui tempi.

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,

  amministrativo: (e, u) =>
`Gentile ${e.from_name},

grazie per il suo messaggio.

Ho ricevuto la documentazione e procedo con le verifiche del caso. Se dovesse servire altro materiale da parte mia, glielo comunico quanto prima.

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,

  da_smistare: (e, u) =>
`Gentile ${e.from_name},

grazie per il suo messaggio, che ho ricevuto correttamente.

Lo esamino con attenzione e le rispondo con tutti i dettagli nel più breve tempo possibile.

Cordiali saluti,
${u.name}${u.business_name ? `\n${u.business_name}` : ''}`,
};

async function draftReply(email, user, category) {
  const cat = category || email.category || 'da_smistare';
  const fallback = (REPLY_TEMPLATES[cat] || REPLY_TEMPLATES.da_smistare)(email, user);
  if (MODE === 'regole') return fallback;

  try {
    return await askModel(
      `Scrivi bozze di risposta email professionali in italiano per ${user.name}${
        user.business_name ? ` (${user.business_name})` : ''
      }. Tono cortese e professionale, dai del lei, niente segnaposto tra parentesi quadre. Restituisci solo il testo dell'email.`,
      `Rispondi a questa email:

Da: ${email.from_name}
Oggetto: ${email.subject}
Testo: ${email.body}`,
      700,
    );
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Bozza preventivo da descrizione libera                              */
/* ------------------------------------------------------------------ */

// Estrae importi tipo "1.500 €", "€1500", "1500 euro"
function extractAmounts(text) {
  const out = [];
  const re = /(?:€\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:€|eur|euro)?/gi;
  let m;
  while ((m = re.exec(text))) {
    const hasCurrency = /€|eur|euro/i.test(m[0]);
    const intPart = m[1].replace(/[.\s]/g, '');
    const value = parseFloat(`${intPart}.${m[2] || '0'}`);
    if (hasCurrency && value > 0) out.push(value);
  }
  return out;
}

function draftQuoteByRules(description) {
  const amounts = extractAmounts(description);
  const clauses = description
    .split(/[;\n]|\s(?:e poi|inoltre|più|oltre a)\s/i)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ''))
    .filter((s) => s.length > 3);

  const items = clauses.slice(0, 8).map((clause, i) => {
    const inClause = extractAmounts(clause);
    const price = inClause[0] ?? amounts[i] ?? 0;
    const qtyMatch = clause.match(/(\d+)\s*(?:x|ore|giorni|pezzi|unità)/i);
    const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
    const description = clause
      .replace(/(?:€\s*)?\d[\d.,\s]*\s*(?:€|eur|euro)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return {
      description: (description || 'Voce di preventivo').replace(/^[a-z]/, (c) => c.toUpperCase()),
      quantity,
      unit_price: price,
    };
  });

  return items.length ? items : [{ description: description.trim() || 'Prestazione professionale', quantity: 1, unit_price: 0 }];
}

async function draftQuote(description) {
  const fallback = draftQuoteByRules(description);
  if (MODE === 'regole') return fallback;

  try {
    const out = await askModel(
      'Trasformi descrizioni libere in voci di preventivo per freelance italiani. Rispondi SOLO con JSON valido.',
      `Descrizione del lavoro: "${description}"

Rispondi con JSON: {"items":[{"description":"...","quantity":1,"unit_price":0}]}. Usa gli importi indicati nella descrizione; se non ci sono, metti 0.`,
      700,
    );
    const parsed = JSON.parse(out.replace(/^```json\s*|\s*```$/g, ''));
    if (Array.isArray(parsed.items) && parsed.items.length) {
      return parsed.items.map((i) => ({
        description: String(i.description || 'Voce di preventivo'),
        quantity: Number(i.quantity) || 1,
        unit_price: Number(i.unit_price) || 0,
      }));
    }
    return fallback;
  } catch {
    return fallback;
  }
}

module.exports = { triageEmail, draftReply, draftQuote, MODE, RULES };
