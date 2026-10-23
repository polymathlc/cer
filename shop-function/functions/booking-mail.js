'use strict';

// The two emails a card-paid trial or enrolment sends, written by
// repository.finalizeBooking() in the same transaction as the booking, so each
// goes out exactly once:
//
//   to the centre   "New Trial Booking: …" to the page's NOTIFICATION_EMAILS, the
//                   same table the PayNow booking sends, saying it was paid by card
//   to the parent   a confirmation and receipt from Polymath Learning Centre
//                   <admin@polymathlc.com.sg>, replies landing in the same inbox
//
// Both go through the `mail` collection, which the project's Trigger Email
// extension sends. Everything that came from the parent is escaped.
const { SENDER_EMAIL, SENDER_NAME, UEN, escapeHtml, validEmail } = require('./receipt');

const NOTIFICATION_EMAILS = Object.freeze(['chungzhikai@gmail.com', 'admin@polymathlc.com.sg']);
const BOOKING_MAIL_PREFIX = 'polymath-schedule-booking-';
const WHATSAPP_NUMBER = '6596450588';
const WHATSAPP_DISPLAY = '+65 9645 0588';
const SCHEDULE_URL = 'https://polymathlc.com.sg/schedule/';
const TRIAL_NOTICE_DAYS = 3;
const ENROL_ACROSS = 'From the second month onwards, our admin staff will contact you to collect the monthly fees, so there is nothing more to pay on this page.';
const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';

const bookingMailId = (code, who) => BOOKING_MAIL_PREFIX + code + '-' + who;
const money = value => '$' + (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
const fmtWa = n => (n && n.length === 8 ? n.slice(0, 4) + ' ' + n.slice(4) : n || '');
const levelName = level => String(level || '').replace('P', 'Primary ');

// 'Tuesday 13 October 2026', the page's fmtDayKey(key, true, '').
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDayKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return WD_LONG[date.getUTCDay()] + ' ' + d + ' ' + MONTH_LONG[m - 1] + ' ' + y;
}
const paidOn = ms => new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(ms));

// The rows of the booking, in the order the PayNow email lists them.
function bookingRows(b, code, earliest) {
  const enrol = b.kind === 'enrol';
  const rows = [
    ['Booking', enrol ? 'Enrolment (no trial)' : 'Trial class'],
    ['Booking code', code],
    ['Slot', b.slotLabel],
    earliest ? ['Earliest possible trial date', earliest + ' (' + TRIAL_NOTICE_DAYS + " business days' notice)"] : null,
    ['Class type', b.classType === 'master' ? 'Master Class (physical)' : 'Regular class'],
    ['Class', levelName(b.classLevel) + ' ' + b.subject],
    ['Attending', b.mode],
    ['Child', b.childName],
    ["Child's level in 2027", b.childLevel2027],
    ['Parent', b.parentName],
    ['Email', b.email],
    ['WhatsApp', '+65 ' + fmtWa(b.whatsapp)],
    enrol ? ["First month's fees paid", money(b.price) + ' by card'] : ['Trial fee paid', money(b.price) + ' by card'],
    [enrol ? 'Monthly fee' : 'Monthly fee after trial', b.monthlyFee ? money(b.monthlyFee) + ' / month' : '—'],
    ['Reference', b.paymentRef]
  ].filter(Boolean);
  if (enrol) rows.push(['Subsequent months', 'Collected by Polymath admin staff']);
  return rows;
}

function rowsHtml(rows) {
  return '<table style="border-collapse:collapse;font-size:14px;width:100%;">' + rows.map(([k, v]) =>
    '<tr><td style="padding:8px 12px;border:1px solid #e5e5e5;background:#f5f5f5;font-weight:700;width:38%;">' + escapeHtml(k)
    + '</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">' + escapeHtml(v) + '</td></tr>').join('') + '</table>';
}
const rowsText = rows => rows.map(([k, v]) => k + ': ' + v).join('\n');

// To the centre: what the PayNow booking sends, with the payment already confirmed.
function adminBookingMail(b, { code, earliestKey = '', stripeSessionId = '', paymentChecks = [] } = {}) {
  const enrol = b.kind === 'enrol';
  const master = b.classType === 'master';
  const rows = bookingRows(b, code, fmtDayKey(earliestKey));
  const checks = paymentChecks.length ? 'Please check this payment in Stripe: ' + paymentChecks.join(', ') + '.' : '';
  const subject = (enrol ? (master ? 'New MASTER CLASS ENROLMENT (card paid): ' : 'New ENROLMENT (card paid): ')
    : (master ? 'New MASTER CLASS Trial (card paid): ' : 'New Trial Booking (card paid): '))
    + b.childName + ' — ' + b.slotLabel + ' (' + b.subject + ')';
  const html = '<div style="font-family:Arial,sans-serif;color:#171717;max-width:640px;">'
    + '<h2>' + (enrol ? 'New Enrolment (no trial)' : 'New Trial Class Booking') + '</h2>'
    + '<p><b>Paid by card through Stripe</b>: ' + escapeHtml(money(b.price)) + '. There is no PayNow screenshot to check.'
    + (stripeSessionId ? ' Stripe session ' + escapeHtml(stripeSessionId) + '.' : '') + '</p>'
    + (checks ? '<p style="color:#b42318;"><b>' + escapeHtml(checks) + '</b></p>' : '')
    + (enrol ? '<p>First month\'s fees paid. Please follow up to collect fees from the second month onwards.</p>'
             : '<p>Please confirm the trial date with the parent.</p>')
    + rowsHtml(rows)
    + '<p style="margin-top:16px;"><a href="https://wa.me/65' + escapeHtml(b.whatsapp) + '">WhatsApp parent</a></p></div>';
  const text = (enrol ? 'New enrolment (no trial), paid by card.' : 'New trial booking, paid by card.')
    + (checks ? '\n' + checks : '') + '\n\n' + rowsText(rows)
    + '\n\nWhatsApp parent: https://wa.me/65' + b.whatsapp;
  return {
    to: NOTIFICATION_EMAILS.slice(),
    from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
    replyTo: validEmail(b.email) ? b.email : SENDER_EMAIL,
    message: { subject, html, text },
    polymathSchedule: { code, kind: 'booking-admin' }
  };
}

// To the parent: the booking confirmed, and the card payment receipted.
function parentBookingMail(b, { code, earliestKey = '', now = Date.now() } = {}) {
  if (!validEmail(b.email)) return null;
  const enrol = b.kind === 'enrol';
  const master = b.classType === 'master';
  const earliest = enrol ? '' : fmtDayKey(earliestKey);
  const rows = bookingRows(b, code, earliest);
  const noticeText = enrol ? '' : 'Trial slots must be booked at least ' + TRIAL_NOTICE_DAYS
    + " business days in advance, so we can prepare for your child's lesson."
    + (earliest ? ' Based on when you booked, the earliest possible trial date for this class is ' + earliest + '.' : '')
    + ' We will confirm the exact date with you.';
  const what = enrol ? (master ? 'Master Class enrolment' : 'enrolment') : (master ? 'Master Class trial' : 'trial class booking');
  const subject = (enrol ? 'Enrolment confirmed — ' : 'Trial class booked — ') + b.slotLabel + ' (paid ' + money(b.price) + ')';
  const greeting = 'Dear ' + b.parentName + ',';
  const lead = 'Thank you! We have received your ' + what + ' for ' + b.childName + ' and your card payment of '
    + money(b.price) + ' on ' + paidOn(now) + '.';
  const html =
    '<div style="font-family:\'Century Gothic\',CenturyGothic,AppleGothic,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1A1A1A">'
    + '<img src="' + LOGO_URL + '" alt="Polymath Learning Centre" height="56" style="height:56px;margin-bottom:24px">'
    + '<p style="font-size:16px;line-height:1.6;margin:0 0 12px">' + escapeHtml(greeting) + '</p>'
    + '<p style="font-size:16px;line-height:1.6;margin:0 0 20px">' + escapeHtml(lead) + '</p>'
    + (enrol ? '<p style="font-size:15px;line-height:1.6;margin:0 0 20px"><b>About the monthly fees:</b> ' + escapeHtml(ENROL_ACROSS) + '</p>' : '')
    + (noticeText ? '<p style="font-size:15px;line-height:1.6;margin:0 0 20px"><b>Your trial date:</b> ' + escapeHtml(noticeText) + '</p>' : '')
    + rowsHtml(rows)
    + '<p style="font-size:14px;line-height:1.6;color:#5C5C5C;margin:24px 0 0">Questions? Reply to this email or WhatsApp us at '
    + '<a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:#056c76">' + WHATSAPP_DISPLAY + '</a>.</p>'
    + '<p style="font-size:15px;line-height:1.6;margin:24px 0 0">Thank you,<br>' + SENDER_NAME + '</p>'
    + '<p style="font-size:12px;line-height:1.6;color:#8A8A8A;margin:28px 0 0">' + SENDER_NAME + ' &middot; UEN ' + UEN
    + ' &middot; <a href="' + SCHEDULE_URL + '" style="color:#056c76">polymathlc.com.sg/schedule</a></p>'
    + '</div>';
  const text = [greeting, '', lead]
    .concat(enrol ? ['', 'About the monthly fees: ' + ENROL_ACROSS] : [])
    .concat(noticeText ? ['', noticeText] : [])
    .concat(['', rowsText(rows), '', 'Questions? Reply to this email or WhatsApp us at ' + WHATSAPP_DISPLAY + '.', '',
      'Thank you,', SENDER_NAME, 'UEN ' + UEN]).join('\n');
  return {
    to: [b.email.trim()],
    from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
    replyTo: SENDER_EMAIL,
    message: { subject, html, text },
    polymathSchedule: { code, kind: 'booking-parent' }
  };
}

module.exports = { NOTIFICATION_EMAILS, BOOKING_MAIL_PREFIX, bookingMailId, fmtDayKey, bookingRows, adminBookingMail, parentBookingMail };
