'use strict';

/**
 * Invio email.
 *
 * Due modalità:
 *  - "smtp":   quando SMTP_HOST è configurato. Le email partono davvero.
 *  - "outbox": nessun SMTP configurato. Ogni email viene salvata come file .eml
 *              in data/outbox/ e resta consultabile dal pannello newsletter.
 *              Serve a sviluppare e collaudare l'intero flusso senza un
 *              servizio di posta, senza rischiare invii accidentali.
 *
 * In entrambi i casi il resto dell'applicazione chiama la stessa funzione.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { DATA_DIR } = require('./db');

const SMTP_HOST = process.env.SMTP_HOST || null;
const MODE = SMTP_HOST ? 'smtp' : 'outbox';

const FROM_NAME = process.env.MAIL_FROM_NAME || 'Solvia';
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'newsletter@solvia.local';
const FROM = `"${FROM_NAME}" <${FROM_EMAIL}>`;

const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');
if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });

let transporter = null;
if (MODE === 'smtp') {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

const slug = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);

/**
 * Invia (o archivia) un'email.
 * Restituisce { mode, id } — `id` è il messageId SMTP o il nome del file .eml.
 */
async function sendMail({ to, subject, text, html, headers = {} }) {
  if (MODE === 'smtp') {
    const info = await transporter.sendMail({ from: FROM, to, subject, text, html, headers });
    return { mode: 'smtp', id: info.messageId };
  }

  // Composizione del file .eml senza inviare nulla.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}__${slug(to)}.eml`;
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');

  const eml = [
    `From: ${FROM}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    extra,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text || '',
  ].filter((line) => line !== '').join('\n');

  fs.writeFileSync(path.join(OUTBOX_DIR, filename), eml, 'utf8');
  return { mode: 'outbox', id: filename };
}

/** Elenco delle email archiviate, più recenti per prime. */
function listOutbox(limit = 30) {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  return fs.readdirSync(OUTBOX_DIR)
    .filter((f) => f.endsWith('.eml'))
    .sort().reverse().slice(0, limit)
    .map((file) => {
      const raw = fs.readFileSync(path.join(OUTBOX_DIR, file), 'utf8');
      const header = (name) => (raw.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] || '';
      return {
        file,
        to: header('To'),
        subject: header('Subject'),
        date: header('Date'),
        body: raw.split('\n\n').slice(1).join('\n\n'),
      };
    });
}

module.exports = { sendMail, listOutbox, MODE, FROM_EMAIL, FROM_NAME, OUTBOX_DIR };
