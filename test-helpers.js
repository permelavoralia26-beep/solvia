'use strict';

/**
 * Passaggi condivisi dalle suite su browser.
 *
 * Da quando esiste la schermata di benvenuto, chi si registra non atterra sulla
 * dashboard: deve prima fare i tre passi della configurazione. Le suite che
 * vogliono provare altro passano di qui invece di ripetere gli stessi clic.
 */

/**
 * Completa la configurazione iniziale partendo dalla schermata di benvenuto.
 * `dati` vale 'esempi' (account precaricato) oppure 'vuoto'.
 * Restituisce quando la dashboard vera è a video.
 */
async function completaBenvenuto(page, dati = 'esempi') {
  await page.waitForSelector('.onb-choice');
  await page.click(dati === 'vuoto' ? '#onb-vuoto' : '#onb-esempi');

  await page.waitForSelector('#onb-salva');
  await page.click('#onb-salva');

  await page.waitForSelector('#onb-fine');
  await page.click('#onb-fine');

  await page.waitForSelector('.stat-value');
}

module.exports = { completaBenvenuto };
