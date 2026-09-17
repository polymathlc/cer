'use strict';

const { createHash } = require('node:crypto');
const ORIGINS = Object.freeze(['https://polymathlc.github.io']);
const LIMITS = Object.freeze({ bodyBytes: 8192, perIpHour: 5, perEmailDay: 3, globalDay: 100 });
const DAY = 86400000;
const RETENTION_MS = 7 * DAY;
const MAIL_PREFIX = 'polymath-enquiry-';
const REQUEST_COLLECTION = 'polymathEnquiryRequests';
const LIMIT_COLLECTION = 'polymathEnquiryLimits';
const hash = value => createHash('sha256').update(value).digest('hex');

class EnquiryError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail() { throw new EnquiryError(400, 'invalid-enquiry'); }
function line(value, max, min = 1) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail();
  const result = value.trim();
  if (result.length < min || result.length > max) fail();
  return result;
}
function recipientConfiguration(value) {
  const recipients = typeof value === 'string' ? value.split(',').map(address => address.trim()) : [];
  if (recipients.length !== 2 || new Set(recipients).size !== 2
      || recipients.some(address => !/^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(address)))
    throw new Error('A fixed pair of server enquiry recipients must be configured.');
  return Object.freeze(recipients);
}
function validateEnquiry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  const keys = new Set(['submissionId', 'parentName', 'email', 'phone', 'childLevel', 'subjects', 'message']);
  if (Object.keys(body).some(key => !keys.has(key))) fail();
  const submissionId = line(body.submissionId, 36).toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(submissionId)) fail();
  const parentName = line(body.parentName === undefined ? '' : body.parentName, 100, 0);
  const email = line(body.email, 254).toLowerCase();
  if (!/^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email)) fail();
  const phone = line(body.phone, 32);
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15) fail();
  const childLevel = line(body.childLevel, 2);
  if (!['P3', 'P4', 'P5', 'P6', 'S1'].includes(childLevel)) fail();
  if (!Array.isArray(body.subjects) || body.subjects.length < 1 || body.subjects.length > 2
      || body.subjects.some(subject => !['science', 'math'].includes(subject))
      || new Set(body.subjects).size !== body.subjects.length) fail();
  const subjects = ['science', 'math'].filter(subject => body.subjects.includes(subject));
  if (subjects.includes('math') && !['P4', 'P5', 'P6'].includes(childLevel)) fail();
  if (body.message !== undefined && typeof body.message !== 'string') fail();
  const message = (body.message || '').replace(/\r\n?/g, '\n').trim();
  if (message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) fail();
  return { submissionId, parentName, email, phone, childLevel, subjects, message };
}
function buildSubmission(enquiry, ip, now, recipients) {
  const { submissionId, ...payload } = enquiry;
  const day = Math.floor(now / DAY), hour = Math.floor(now / 3600000);
  const subjectNames = enquiry.subjects.map(subject => subject === 'science' ? 'Science' : 'Mathematics').join(' and ');
  return {
    id: submissionId, fingerprint: hash(JSON.stringify(payload)), now,
    expiresAt: now + RETENTION_MS,
    quotas: [
      { id: 'ip-' + hash(ip) + '-' + hour, maximum: LIMITS.perIpHour, expiresAt: (hour + 1) * 3600000 + DAY },
      { id: 'email-' + hash(enquiry.email) + '-' + day, maximum: LIMITS.perEmailDay, expiresAt: (day + 2) * DAY },
      { id: 'global-' + day, maximum: LIMITS.globalDay, expiresAt: (day + 2) * DAY }
    ],
    mail: {
      to: [...recipients], replyTo: enquiry.email,
      message: {
        subject: 'Polymath class enquiry — ' + enquiry.childLevel + ' ' + subjectNames,
        text: [
          'A parent submitted an enquiry through the Polymath Learning Centre website.', '',
          'Parent: ' + (enquiry.parentName || '(Not provided)'), 'Email: ' + enquiry.email, 'Contact number: ' + enquiry.phone,
          'Child level: ' + (enquiry.childLevel === 'S1' ? 'Secondary 1' : 'Primary ' + enquiry.childLevel.slice(1)),
          'Subjects: ' + subjectNames, '', 'Message:', enquiry.message || '(No additional message)', '',
          'Submission reference: ' + submissionId
        ].join('\n')
      }
    }
  };
}
function createService({ repository, recipients, now = Date.now, report = () => {} }) {
  async function handler(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!ORIGINS.includes(origin)) return res.status(403).json({ accepted: false, error: 'origin-not-allowed' });
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ accepted: false, error: 'method-not-allowed' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.get('content-type') || ''))
      return res.status(415).json({ accepted: false, error: 'json-required' });
    try {
      const size = req.rawBody ? req.rawBody.length : Buffer.byteLength(JSON.stringify(req.body ?? null));
      if (size > LIMITS.bodyBytes) throw new EnquiryError(413, 'enquiry-too-large');
      const enquiry = validateEnquiry(req.body);
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
      const result = await repository.reserve(buildSubmission(enquiry, ip, now(), recipients));
      return res.status(result.duplicate ? 200 : 202).json({ accepted: true, submissionId: enquiry.submissionId });
    } catch (error) {
      if (error instanceof EnquiryError) {
        if (error.status === 429) res.set('Retry-After', '3600');
        return res.status(error.status).json({ accepted: false, error: error.code });
      }
      // Do not log requests, email addresses, phone numbers or provider errors.
      report('enquiry-storage-failed');
      return res.status(503).json({ accepted: false, error: 'temporarily-unavailable' });
    }
  }
  return { handler, cleanup: () => repository.cleanup(now()) };
}
module.exports = { recipientConfiguration, ORIGINS, LIMITS, RETENTION_MS, MAIL_PREFIX, REQUEST_COLLECTION,
  LIMIT_COLLECTION, EnquiryError, validateEnquiry, buildSubmission, createService };
