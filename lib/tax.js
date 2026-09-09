'use strict';

/**
 * Stima di quanto accantonare per imposte e contributi.
 *
 * ATTENZIONE — questi sono valori INDICATIVI, pensati per rispondere alla
 * domanda "quanto di questo incasso non è mio?". Non sostituiscono il calcolo
 * del commercialista: aliquote e minimali cambiano ogni anno, il coefficiente
 * di redditività dipende dal codice ATECO, e ci sono casi particolari
 * (primo anno, cassa professionale, redditi da lavoro dipendente) che qui
 * non vengono considerati.
 *
 * Tutti i parametri sono modificabili dall'utente nelle impostazioni: i valori
 * predefiniti sono un punto di partenza, non una verità.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Valori di riferimento aggiornati al 2026, da verificare ogni anno.
 * Fonte: documentazione INPS e guide fiscali correnti.
 */
const INPS = {
  gestione_separata: {
    label: 'Gestione Separata (professionisti senza cassa)',
    rate: 26.07,        // percentuale sul reddito imponibile
    fixed: 0,           // nessun contributo minimo fisso
    threshold: 0,
    canReduce: false,   // la riduzione del 35% non si applica
  },
  artigiani: {
    label: 'Artigiani',
    rate: 24,
    fixed: 4460.64,     // contributo fisso annuo fino al minimale
    threshold: 18555,   // minimale di reddito
    canReduce: true,
  },
  commercianti: {
    label: 'Commercianti',
    rate: 24.48,
    fixed: 4549.70,
    threshold: 18555,
    canReduce: true,
  },
  cassa_professionale: {
    label: 'Cassa professionale (avvocati, ingegneri, ecc.)',
    rate: 4,            // aliquota molto variabile: da impostare caso per caso
    fixed: 0,
    threshold: 0,
    canReduce: false,
  },
  nessuna: {
    label: 'Nessuna contribuzione',
    rate: 0, fixed: 0, threshold: 0, canReduce: false,
  },
};

/**
 * Calcola imposta e contributi su un fatturato annuo.
 *
 * @param revenue   fatturato incassato (imponibile fatturato, non il totale con IVA)
 * @param settings  { tax_regime, tax_coefficient, tax_rate, inps_type, inps_reduction }
 */
function estimate(revenue, settings) {
  const gross = Math.max(0, Number(revenue) || 0);
  const regime = settings.tax_regime || 'forfettario';

  // Nel forfettario l'imponibile è una percentuale del fatturato (coefficiente
  // di redditività): le spese non si deducono, sono già considerate lì dentro.
  const coefficient = regime === 'forfettario'
    ? (Number(settings.tax_coefficient) || 78) : 100;
  const taxable = round2(gross * coefficient / 100);

  const inpsConfig = INPS[settings.inps_type] || INPS.gestione_separata;
  const reduction = (settings.inps_reduction && inpsConfig.canReduce) ? 0.35 : 0;

  let inps;
  if (inpsConfig.fixed > 0) {
    // Contributo fisso fino al minimale, poi percentuale sull'eccedenza.
    const above = Math.max(0, taxable - inpsConfig.threshold);
    inps = inpsConfig.fixed + (above * inpsConfig.rate / 100);
  } else {
    inps = taxable * inpsConfig.rate / 100;
  }
  inps = round2(inps * (1 - reduction));

  // I contributi versati sono deducibili dall'imponibile su cui si calcola
  // l'imposta sostitutiva.
  const taxableAfterInps = Math.max(0, taxable - inps);
  const rate = Number(settings.tax_rate) || 5;
  const tax = round2(taxableAfterInps * rate / 100);

  const total = round2(tax + inps);

  return {
    revenue: gross,
    coefficient,
    taxable,
    inps,
    inpsLabel: inpsConfig.label,
    inpsReduced: reduction > 0,
    tax,
    taxRate: rate,
    total,
    // Quanto di ogni euro incassato è già impegnato
    percentOfRevenue: gross > 0 ? round2((total / gross) * 100) : 0,
    net: round2(gross - total),
  };
}

/** Opzioni da mostrare nelle impostazioni. */
const options = () => Object.entries(INPS).map(([id, v]) => ({
  id, label: v.label, rate: v.rate, fixed: v.fixed, canReduce: v.canReduce,
}));

module.exports = { estimate, options, INPS };
