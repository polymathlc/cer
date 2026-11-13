// Who loses something when the approval at polymathlc.com.sg/student starts to
// decide the SUBJECTS (access-gate.js v1.1.0, My Polymath v1.5.0)?
//
// Read only. It reads studentAccess, then for the approved accounts only their
// Math profile (studentProfiles/{uid}), Science profile (userProfiles/{uid}) and
// Polymath Online row (onlineMembers/{uid}), and prints COUNTS — never a name or
// an email, because the Actions log of this public repository is public.
//
//   node tools/student-access-impact.mjs          (GOOGLE_APPLICATION_CREDENTIALS set,
//                                                  IMPACT_DEPS=<dir with node_modules/firebase-admin>)
//
// The arithmetic is impactReport() below, tested offline in student-access-tests.mjs.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'mathgen--app';
// Keep equal to STAFF in student/access-gate.js (the gate never asks them).
export const STAFF = ['chungzhikai@gmail.com', 'admin@polymathlc.com.sg', 'support@polymathlc.com.sg',
  'elsielcr@gmail.com', 'abigail.yew@stanfordmanpower.com', 'pkeertana21@gmail.com'];
// Fields Polymath Online itself writes on studentProfiles: a row with only these
// is not Math app use.
export const ONLINE_PROFILE_KEYS = ['uid', 'name', 'level', 'subject', 'email', 'onlineMember', 'updatedAt', 'createdAt'];
const ONLINE_LEVELS = ['P3', 'P4', 'P5', 'P6'];

const lower = value => String(value == null ? '' : value).trim().toLowerCase();
export function statusOf(record) {
  if (!record) return 'none';
  const s = lower(record.status);
  return s === 'approved' || s === 'revoked' ? s : 'pending';
}
export function subjectsOfChoice(choice) {
  const key = lower(choice);
  if (key === 'both') return ['math', 'science'];
  return key === 'math' || key === 'science' ? [key] : [];
}
export function approvedSubjects(record) {
  const out = new Set();
  for (const child of (record && record.children) || []) for (const s of subjectsOfChoice(child && child.subjects)) out.add(s);
  return [...out].sort();
}
/** "P5:math" keys a Polymath Online member could see (P3 is Science only there). */
function onlineKeys(pairs) {
  const out = new Set();
  for (const pair of pairs || []) {
    if (!pair || !ONLINE_LEVELS.includes(pair.level)) continue;
    const list = Array.isArray(pair.subjects) ? pair.subjects : [pair.subjects];
    for (const raw of list) for (const s of (raw === 'both' ? ['math', 'science'] : [raw]))
      if ((s === 'math' || s === 'science') && !(pair.level === 'P3' && s === 'math')) out.add(pair.level + ':' + s);
  }
  return out;
}
/** What an Online member row let the account see before (its `access`, or its one level). */
export function onlineBefore(member) {
  if (!member || member.revoked) return new Set();
  if (Array.isArray(member.access)) return onlineKeys(member.access);
  return onlineKeys(member.level ? [{ level: member.level, subjects: member.subjects }] : []);
}
/** What the approval lets it see now. */
export function onlineAfter(record) {
  if (statusOf(record) !== 'approved') return new Set();
  return onlineKeys(((record && record.children) || []).map(c => c && ({ level: c.level, subjects: [c.subjects] })));
}
export function usedMath(profile) {
  return !!profile && Object.keys(profile).some(key => !ONLINE_PROFILE_KEYS.includes(key));
}
export function usedScience(profile) {
  return !!profile;
}

/**
 * records: [{ id, data }] of studentAccess; profiles: { math: {uid: data}, science: {uid: data}, online: {uid: data} }.
 * Returns counts only.
 */
export function impactReport(records, profiles = {}) {
  const math = profiles.math || {}, science = profiles.science || {}, online = profiles.online || {};
  const report = {
    records: 0, approved: 0, pending: 0, paused: 0, staffSkipped: 0,
    approvedMathOnly: 0, approvedScienceOnly: 0, approvedBoth: 0, approvedNoSubject: 0,
    loseMathApp: 0, loseScienceApp: 0, loseAnySubjectApp: 0,
    onlineRows: 0, onlineLoseSome: 0, onlineLoseAll: 0, onlineGain: 0,
    accountsLosingSomething: 0
  };
  for (const { id, data } of records || []) {
    if (STAFF.includes(lower(data && data.email))) { report.staffSkipped++; continue; }
    report.records++;
    const status = statusOf(data);
    if (status === 'pending') report.pending++;
    if (status === 'revoked') report.paused++;
    let loses = false;
    if (status === 'approved') {
      report.approved++;
      const subjects = approvedSubjects(data);
      if (subjects.length === 2) report.approvedBoth++;
      else if (subjects[0] === 'math') report.approvedMathOnly++;
      else if (subjects[0] === 'science') report.approvedScienceOnly++;
      else report.approvedNoSubject++;
      const loseMath = !subjects.includes('math') && usedMath(math[id]);
      const loseScience = !subjects.includes('science') && usedScience(science[id]);
      if (loseMath) report.loseMathApp++;
      if (loseScience) report.loseScienceApp++;
      if (loseMath || loseScience) { report.loseAnySubjectApp++; loses = true; }
    }
    const member = online[id];
    if (member) {
      report.onlineRows++;
      const before = onlineBefore(member), after = onlineAfter(data);
      const lost = [...before].filter(key => !after.has(key));
      if (lost.length && lost.length === before.size) report.onlineLoseAll++;
      else if (lost.length) report.onlineLoseSome++;
      if ([...after].some(key => !before.has(key))) report.onlineGain++;
      if (lost.length && status === 'approved') loses = true;
    }
    if (loses) report.accountsLosingSomething++;
  }
  return report;
}

export function reportLines(r) {
  return [
    `Student access records: ${r.records} (approved ${r.approved}, waiting ${r.pending}, paused ${r.paused}; ${r.staffSkipped} staff skipped).`,
    `Approved for: Math only ${r.approvedMathOnly}, Science only ${r.approvedScienceOnly}, both ${r.approvedBoth}, no subject ${r.approvedNoSubject}.`,
    `Approved accounts that used an app their subjects no longer open: ${r.loseAnySubjectApp} (Math app ${r.loseMathApp}, Science app ${r.loseScienceApp}).`,
    `Polymath Online rows: ${r.onlineRows}; lose some classes ${r.onlineLoseSome}, lose all ${r.onlineLoseAll}, gain classes ${r.onlineGain}.`,
    `Approved accounts losing anything they had: ${r.accountsLosingSomething}.`
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deps = process.env.IMPACT_DEPS;
  if (!deps) throw new Error('Set IMPACT_DEPS to a folder with node_modules/firebase-admin.');
  const require = createRequire(join(deps, 'package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
  const db = admin.firestore();
  const snap = await db.collection('studentAccess').get();
  const records = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  // Every record's uid (an Online row of a waiting account counts too).
  const ids = records.map(r => r.id);
  const read = async collection => {
    const out = {};
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map(id => db.collection(collection).doc(id));
      if (!refs.length) continue;
      for (const doc of await db.getAll(...refs)) if (doc.exists) out[doc.id] = doc.data();
    }
    return out;
  };
  const report = impactReport(records, { math: await read('studentProfiles'), science: await read('userProfiles'), online: await read('onlineMembers') });
  console.log(JSON.stringify(report));
  for (const line of reportLines(report)) console.log(line);
}
