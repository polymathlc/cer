// ✉️ Firebase Authentication settings that email sign-in needs, on mathgen--app,
// read (and with --apply, put right) through the Identity Toolkit admin API with the
// FIREBASE_SERVICE_ACCOUNT key — so nobody has to click through the Firebase console.
//
//   node tools/email-sign-in-config.mjs           report only (changes nothing)
//   node tools/email-sign-in-config.mjs --apply   also switch on what is missing:
//       • the Email/Password sign-in method (Authentication → Sign-in method)
//       • polymathlc.com.sg and polymathlc.github.io as authorised domains, so the
//         emails' "Continue" button can bring people back to the page they came from
//       • tries the verification and password-reset emails: sender name "Polymath Learning
//         Centre", Polymath subjects and wording, replies to admin@polymathlc.com.sg
//         (sent by Firebase itself from noreply@mathgen--app.firebaseapp.com, so they
//         do NOT use the Gmail quota of the other Polymath emails). Firebase refuses
//         this through the API (EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED, seen 2026-11-20):
//         the wording is changed only in the console, so that is reported, not failed.
//
// Needs GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON key file); in GitHub
// Actions the "--setup" step of tools/student-access-rules.mjs writes it. Prints one
// JSON line, then a plain summary. Nothing secret is printed.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'mathgen--app';
export const DOMAINS = ['polymathlc.com.sg', 'www.polymathlc.com.sg', 'polymathlc.github.io'];
export const SENDER_NAME = 'Polymath Learning Centre';
export const REPLY_TO = 'admin@polymathlc.com.sg';

const wrap = (title, inner) => `<div style="font-family:'Century Gothic','Segoe UI',Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1A1A1A;line-height:1.55">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px"><div style="width:40px;height:40px;border-radius:12px;background:#2E8B6B;color:#fff;font-weight:700;font-size:20px;text-align:center;line-height:40px">P</div><b style="font-size:15px">Polymath Learning Centre</b></div>
<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
${inner}
<p style="font-size:13px;color:#5C5C5C;margin-top:24px">Questions? WhatsApp us on +65 9645 0588 or reply to this email.</p>
</div>`;

export const TEMPLATES = {
  verifyEmailTemplate: {
    subject: 'Confirm your email for Polymath Learning Centre',
    body: wrap('Confirm your email address',
      `<p>Hello %DISPLAY_NAME%,</p>
<p>Thank you for creating a Polymath account with <b>%EMAIL%</b>. Please tap the button below to confirm that this is your email address.</p>
<p style="margin:22px 0"><a href="%LINK%" style="background:#2E8B6B;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">Confirm my email</a></p>
<p style="font-size:14px;color:#5C5C5C">Then go back to the Polymath page: it carries on by itself. If the button does not work, copy this link into your browser:<br><a href="%LINK%" style="color:#0B6B4F;word-break:break-all">%LINK%</a></p>
<p style="font-size:14px;color:#5C5C5C">Did not sign up? You can ignore this email.</p>`)
  },
  resetPasswordTemplate: {
    subject: 'Reset your Polymath password',
    body: wrap('Choose a new password',
      `<p>Hello,</p>
<p>Somebody (we hope you) asked to reset the password of the Polymath account <b>%EMAIL%</b>. Tap the button below to choose a new one.</p>
<p style="margin:22px 0"><a href="%LINK%" style="background:#2E8B6B;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">Choose a new password</a></p>
<p style="font-size:14px;color:#5C5C5C">The link works for one hour. If you joined with Google, this adds a password to the same account, so you can sign in either way. If the button does not work, copy this link into your browser:<br><a href="%LINK%" style="color:#0B6B4F;word-break:break-all">%LINK%</a></p>
<p style="font-size:14px;color:#5C5C5C">Did not ask for this? Ignore this email: your password stays the same.</p>`)
  }
};

/* ───────── pure: what to change ───────── */
export function plan(config) {
  const c = config || {};
  const email = (c.signIn && c.signIn.email) || {};
  const domains = Array.isArray(c.authorizedDomains) ? c.authorizedDomains : [];
  const send = (c.notification && c.notification.sendEmail) || {};
  const steps = [];
  if (email.enabled !== true || email.passwordRequired !== true)
    steps.push({ what: 'email-provider', mask: ['signIn.email.enabled', 'signIn.email.passwordRequired'], body: { signIn: { email: { enabled: true, passwordRequired: true } } } });
  const missing = DOMAINS.filter(d => !domains.includes(d));
  if (missing.length) steps.push({ what: 'authorised-domains', missing, mask: ['authorizedDomains'], body: { authorizedDomains: domains.concat(missing) } });
  for (const [key, want] of Object.entries(TEMPLATES)) {
    const have = send[key] || {};
    const same = have.senderDisplayName === SENDER_NAME && have.subject === want.subject && have.replyTo === REPLY_TO && have.body === want.body;
    if (!same) {
      const base = 'notification.sendEmail.' + key + '.';
      steps.push({
        what: 'template:' + key,
        mask: ['senderDisplayName', 'subject', 'replyTo', 'body', 'bodyFormat'].map(f => base + f),
        body: { notification: { sendEmail: { [key]: { senderDisplayName: SENDER_NAME, subject: want.subject, replyTo: REPLY_TO, body: want.body, bodyFormat: 'HTML' } } } },
        // If Firebase refuses a custom body, the names and subject alone are still worth having.
        fallback: { mask: ['senderDisplayName', 'subject', 'replyTo'].map(f => base + f),
          body: { notification: { sendEmail: { [key]: { senderDisplayName: SENDER_NAME, subject: want.subject, replyTo: REPLY_TO } } } } }
      });
    }
  }
  return steps;
}

export function summary(config) {
  const c = config || {};
  const email = (c.signIn && c.signIn.email) || {};
  const send = (c.notification && c.notification.sendEmail) || {};
  return {
    emailPasswordSignIn: email.enabled === true && email.passwordRequired === true ? 'on' : email.enabled ? 'email link only' : 'off',
    authorisedDomains: DOMAINS.map(d => d + ((c.authorizedDomains || []).includes(d) ? ' ✓' : ' ✗')).join(', '),
    emailEnumerationProtection: c.emailPrivacyConfig && c.emailPrivacyConfig.enableImprovedEmailPrivacy ? 'on' : 'off',
    sendingMethod: send.method || 'DEFAULT',
    verifyEmail: send.verifyEmailTemplate ? `${send.verifyEmailTemplate.senderDisplayName || '(no sender name)'} — "${send.verifyEmailTemplate.subject || ''}"` : '(default)',
    resetPassword: send.resetPasswordTemplate ? `${send.resetPasswordTemplate.senderDisplayName || '(no sender name)'} — "${send.resetPasswordTemplate.subject || ''}"` : '(default)'
  };
}

/* ───────── Google API access with the service-account key (no packages) ───────── */
async function accessToken(keyFile) {
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000
  });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error('Could not get an access token (HTTP ' + response.status + ').');
  return body.access_token;
}

async function api(token, method, path, body) {
  const response = await fetch('https://identitytoolkit.googleapis.com/admin/v2/projects/' + PROJECT + path, {
    method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-goog-user-project': PROJECT },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status + ' ' + method + ' ' + path.split('?')[0] + ': ' + String(data && data.error && data.error.message || text).slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function run({ apply = false, keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS } = {}) {
  if (!keyFile) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
  const token = await accessToken(keyFile);
  let config = await api(token, 'GET', '/config');
  const before = summary(config);
  const steps = plan(config);
  const done = [], failed = [], consoleOnly = [];
  if (apply) {
    for (const step of steps) {
      try {
        config = await api(token, 'PATCH', '/config?updateMask=' + encodeURIComponent(step.mask.join(',')), step.body);
        done.push(step.what);
      } catch (error) {
        if (step.fallback) {
          try {
            config = await api(token, 'PATCH', '/config?updateMask=' + encodeURIComponent(step.fallback.mask.join(',')), step.fallback.body);
            done.push(step.what + ' (names and subject only: ' + error.message.slice(0, 120) + ')');
            continue;
          } catch (second) {
            // Firebase lets only the console change these two emails (checked 2026-11-20):
            // a known limit, reported in the summary rather than failing the run.
            if (/EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED/.test(second.message)) { consoleOnly.push(step.what.replace('template:', '')); continue; }
            failed.push(step.what + ': ' + second.message); continue;
          }
        }
        failed.push(step.what + ': ' + error.message);
      }
    }
  }
  return { mode: apply ? 'apply' : 'read', before, after: summary(config), needed: steps.map(s => s.what), done, failed, consoleOnly };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  try {
    const result = await run({ apply });
    console.log(JSON.stringify(result));
    const a = result.after;
    console.log(`Email/password sign-in: ${a.emailPasswordSignIn}`);
    console.log(`Authorised domains: ${a.authorisedDomains}`);
    console.log(`Verification email: ${a.verifyEmail}`);
    console.log(`Password reset email: ${a.resetPassword}`);
    console.log(`Email enumeration protection: ${a.emailEnumerationProtection}`);
    if (result.done.length) console.log('Changed: ' + result.done.join('; '));
    if (result.consoleOnly.length) console.log('Email wording is changed only in the Firebase console (Authentication → Templates): ' + result.consoleOnly.join(', ') + '. The emails work as they are.');
    if (result.failed.length) { console.log('Could not change: ' + result.failed.join('; ')); process.exitCode = 2; }
    if (!apply && result.needed.length) console.log('Would change: ' + result.needed.join(', '));
  } catch (error) {
    console.log(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
