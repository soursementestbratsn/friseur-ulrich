'use strict';

/**
 * Отправка писем через nodemailer.
 * Работает с любым SMTP (Gmail, Brevo, Mail.ru, Beget и т.д.).
 * Если SMTP не настроен — письмо не отправляется, но заявка ВСЁ РАВНО
 * сохраняется в data/bookings.json и видна в личном кабинете.
 */

const nodemailer = require('nodemailer');

const env = process.env;

const config = {
  host: env.SMTP_HOST || '',
  port: Number(env.SMTP_PORT || 587),
  secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(env.SMTP_PORT) === 465,
  user: env.SMTP_USER || '',
  pass: env.SMTP_PASS || '',
  from: env.MAIL_FROM || env.SMTP_USER || 'no-reply@example.com',
  to: env.MAIL_TO || env.SMTP_USER || ''
};

const enabled = Boolean(config.host && config.user && config.pass);

let transporter = null;
if (enabled) {
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass }
  });
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return value ? esc(value) : '—';
}

function bookingHtml(b) {
  const rows = [
    ['Имя', b.name],
    ['Телефон', b.phone],
    ['E-mail', b.email],
    ['Услуга', b.service],
    ['Желаемая дата', b.date],
    ['Время', b.time],
    ['Комментарий', b.message],
    ['ID заявки', b.id]
  ];
  return `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#1B1A17">
      <h2 style="margin:0 0 12px">Новая запись на сайте Friseur Ulrich</h2>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="border-bottom:1px solid #eee;color:#777">${esc(k)}</td>
               <td style="border-bottom:1px solid #eee"><strong>${esc(v) || '—'}</strong></td></tr>`
          )
          .join('')}
      </table>
      <p style="color:#777;font-size:13px;margin-top:16px">Ответить клиенту: ${esc(b.email) || '—'} / ${esc(b.phone) || '—'}</p>
    </div>`;
}

function reviewHtml(r) {
  const stars = '★'.repeat(Number(r.rating) || 0) + '☆'.repeat(5 - (Number(r.rating) || 0));
  return `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#1B1A17">
      <h2 style="margin:0 0 12px">Новый отзыв на сайте</h2>
      <p style="margin:0 0 6px"><strong>${esc(r.name) || 'Гость'}</strong> · <span style="color:#C9A45C">${stars}</span></p>
      <p style="margin:0 0 6px">Услуга: ${money(r.service)}</p>
      <blockquote style="margin:12px 0;padding:12px 16px;border-left:3px solid #C9A45C;background:#faf7f2">${esc(r.text)}</blockquote>
      <p style="color:#777;font-size:13px">Отзыв ждёт модерации в личном кабинете. ID: ${esc(r.id)}</p>
    </div>`;
}

async function send(subject, html) {
  if (!enabled || !config.to) {
    return { sent: false, reason: 'SMTP не настроен' };
  }
  try {
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject,
      html
    });
    return { sent: true };
  } catch (err) {
    console.error('[mail] ошибка отправки:', err.message);
    return { sent: false, reason: err.message };
  }
}

function sendBooking(b) {
  return send(`Новая запись: ${b.name || 'без имени'} — ${b.date || ''} ${b.time || ''}`.trim(), bookingHtml(b));
}

function sendReview(r) {
  return send(`Новый отзыв: ${r.name || 'Гость'} (${r.rating || 0}/5)`, reviewHtml(r));
}

module.exports = { enabled, sendBooking, sendReview };
