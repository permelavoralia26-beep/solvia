'use strict';

/**
 * Misurazione del sito pubblico.
 *
 * Pesa poco più di un'immagine, non usa cookie, non tocca localStorage e non
 * manda niente a nessun servizio esterno: gli eventi vanno solo al tuo server.
 *
 * Cosa registra:
 *   · l'apertura della pagina, con il dominio di provenienza
 *   · quando il listino prezzi entra davvero nello schermo
 *   · i clic sugli elementi marcati con data-evento
 *   · quali domande frequenti vengono aperte
 *
 * Cosa NON registra: chi sei. Il server ricava un'impronta giornaliera dal tuo
 * indirizzo IP e la butta via a mezzanotte, e qui non c'è nessun identificativo
 * che ti segua da una pagina all'altra.
 *
 * Chi ha attivato "Do Not Track" o il Global Privacy Control non viene misurato:
 * il controllo è sia qui sia sul server, così vale anche se questo file non
 * viene eseguito.
 */

(function misura() {
  const rifiuta = navigator.doNotTrack === '1'
    || window.doNotTrack === '1'
    || navigator.globalPrivacyControl === true;
  if (rifiuta) return;

  const invia = (name, extra = {}) => {
    const corpo = JSON.stringify({ name, path: location.pathname, ...extra });
    // sendBeacon sopravvive al cambio pagina: senza, i clic sui link che
    // portano altrove si perderebbero proprio quando contano di più.
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/eventi', new Blob([corpo], { type: 'application/json' }));
    } else {
      fetch('/api/eventi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: corpo, keepalive: true,
      }).catch(() => { /* una statistica persa non è un problema dell'utente */ });
    }
  };

  invia('visita', { referrer: document.referrer || '' });

  /* Clic su ciò che è marcato: <a data-evento="inizia-hero"> */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-evento]');
    if (el) invia('clic', { label: el.dataset.evento });
  }, { capture: true });

  /* Domande frequenti: quali si aprono dice cosa non è chiaro nel testo. */
  document.querySelectorAll('details.faq-item').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) invia('faq_aperta', { label: d.querySelector('summary')?.textContent?.trim() });
    });
  });

  /**
   * Sezioni viste davvero. Non "la pagina contiene i prezzi", ma "i prezzi sono
   * entrati nello schermo": è la differenza fra un numero inutile e uno che dice
   * quante persone sono arrivate fin laggiù.
   */
  if ('IntersectionObserver' in window) {
    const gia = new Set();
    const guarda = (selettore, evento) => {
      const el = document.querySelector(selettore);
      if (!el) return;
      const osservatore = new IntersectionObserver((voci) => {
        voci.forEach((v) => {
          if (v.isIntersecting && !gia.has(evento)) {
            gia.add(evento);
            invia(evento);
            osservatore.disconnect();
          }
        });
      }, { threshold: 0.4 });
      osservatore.observe(el);
    };
    guarda('#prezzi', 'prezzi_visti');
    guarda('#newsletter', 'newsletter_vista');
  }
}());
