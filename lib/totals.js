'use strict';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Calcola i totali di un documento.
 * withholding = ritenuta d'acconto in percentuale (0 se non applicabile).
 * La ritenuta si applica all'imponibile e si sottrae dal totale da pagare.
 */
function computeTotals(items, vatRate = 22, withholding = 0) {
  const subtotal = round2(
    items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0),
  );
  const vatAmount = round2(subtotal * (Number(vatRate) || 0) / 100);
  const withholdingAmount = round2(subtotal * (Number(withholding) || 0) / 100);
  const total = round2(subtotal + vatAmount - withholdingAmount);
  return { subtotal, vatAmount, withholdingAmount, total };
}

// useGrouping esplicito: senza, alcune versioni di ICU omettono il separatore
// delle migliaia sotto le 5 cifre ("3200,00 €" invece di "3.200,00 €").
const formatEUR = (n) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: true })
    .format(Number(n) || 0);

module.exports = { computeTotals, formatEUR, round2 };
