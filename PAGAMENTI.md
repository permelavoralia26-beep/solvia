# Incassare: PayPal, Stripe e la partita IVA

Questo file risponde a una domanda precisa: **"posso usare PayPal invece di Stripe,
così incasso senza partita IVA?"**

Risposta breve: **no, e il problema non è PayPal.**

---

## Perché cambiare servizio non cambia niente

Il muro non è tecnico, è fiscale. Un abbonamento a 19 € **al mese**, che si rinnova da
solo, è per la legge italiana un'attività **abituale**: non è una vendita occasionale,
è un'entrata continuativa e programmata. Un'attività abituale richiede la partita IVA
**a prescindere da come incassi i soldi** — bonifico, Stripe, PayPal, Satispay o
contanti in busta.

Cambiare il servizio di pagamento sposta il problema di un centimetro e lo lascia lì:

| | Cosa serve per incassare abbonamenti |
|---|---|
| **Stripe** | Account business: P.IVA, codice fiscale, documento, IBAN |
| **PayPal** | Gli abbonamenti ricorrenti richiedono un conto **Business**, che in Italia si apre con i dati fiscali dell'attività |
| **Bonifico diretto** | Nessun intermediario, ma resta l'obbligo di fatturare, quindi la P.IVA |

Con un conto PayPal **personale** puoi ricevere denaro, ma non è il punto: il punto è
che se quel denaro è il corrispettivo di un servizio venduto con continuità, va
fatturato. Il conto personale non ti mette al riparo — semplicemente non lascia traccia
finché non la lascia, e a quel punto sei nei guai tu, non PayPal.

**Non ti costruisco un aggiramento**, perché non esiste un aggiramento: esiste solo un
modo di farsi male più tardi. E non è una mia opinione morale: è che il primo cliente
che ti chiede la fattura ti mette con le spalle al muro davanti a una persona che ti
stava già pagando.

---

## Cosa si può fare oggi, davvero

### 1. Pubblica il sito adesso, in pre-lancio

Non serve incassare per pubblicare. Metti online il sito con
`SOLVIA_PRELANCIO=true` e succede questo:

- I **prezzi restano scritti** — servono a qualificare chi arriva
- I pulsanti dei piani a pagamento diventano **"Avvisami quando apre"** e raccolgono
  l'indirizzo email
- Il **piano gratuito funziona per intero**: la gente entra e usa il prodotto davvero
- Chi sbatte contro un limite riceve la stessa proposta onesta, non un pagamento finto
- Nella tua console vedi **quante persone volevano pagare, per quale piano, e quanto
  varrebbero al mese**

Il giorno che apri gli incassi hai due cose che oggi non hai: un prodotto già usato da
persone vere, e l'elenco di chi voleva pagarlo. È il modo migliore di usare l'attesa.

### 2. Nel frattempo apri la partita IVA

Se il prodotto piace, il **regime forfettario** è pensato esattamente per questo caso.
Aprire la P.IVA all'Agenzia delle Entrate non costa nulla di per sé; i costi veri sono i
contributi INPS e l'eventuale commercialista. Sotto la soglia dei 85.000 € di ricavi
l'imposta sostitutiva è del 5% per i primi cinque anni.

**Parlane con un commercialista prima di decidere.** Io ti do il quadro perché tu sappia
cosa chiedere, non perché sostituisca il suo parere: la tua situazione personale — se
hai un altro lavoro, se sei a carico, quanto pensi di fatturare — cambia i conti.

### 3. Poi accendi Stripe in dieci minuti

L'integrazione è già scritta e testata (41 test solo su quella). Quando hai la P.IVA:
crei i due prodotti su Stripe, incolli quattro valori nel pannello di Render, togli
`SOLVIA_PRELANCIO` e premi *Verifica configurazione*. Vedi [STRIPE.md](STRIPE.md).

---

## E se un giorno volessi PayPal comunque?

Ha senso, ma per un motivo diverso da quello per cui me l'hai chiesto: **alcuni clienti
italiani preferiscono pagare con PayPal**, e offrirlo accanto alla carta può alzare le
conversioni.

Non l'ho costruito adesso di proposito: sarebbe un secondo sistema di abbonamenti da
mantenere e da tenere allineato — con i suoi webhook, i suoi stati, i suoi casi di
rinnovo fallito — per risolvere un problema che oggi non hai (non hai ancora un cliente)
e per aggirare un ostacolo che non aggira (la P.IVA serve comunque).

Quando avrai i primi clienti paganti e qualcuno ti chiederà PayPal, si aggiunge: il
codice è già organizzato per farlo senza riscrivere niente — i piani stanno in un solo
posto (`PLANS` in `lib/billing.js`) e lo stato dell'abbonamento è già separato dal
servizio che lo incassa.

---

## In una riga

**PayPal non aggira la partita IVA.** Pubblica oggi in pre-lancio, raccogli chi vuole
pagare, apri la P.IVA con calma, e poi accendi Stripe con quattro valori.
