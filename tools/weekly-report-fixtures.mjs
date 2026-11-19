// A small, believable centre for the weekly report tests, the browser check and
// the sample email (tools/weekly-report-tests.mjs, tools/weekly-report-browser.mjs).
import { createRequire } from 'node:module';
import * as W from '../office/weekly-report-core.mjs';

const require = createRequire(import.meta.url);
export const clock = require('../online/lesson-clock.js');
const SG = 8 * 3600 * 1000;
// Singapore wall-clock → ms.
export const sg = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - SG;

/* ─── A small, believable centre ─── */
export const SUNDAY_6PM = sg(2026, 11, 22, 18, 0);          // Sunday 22 Nov 2026, 6 PM
export const schedule = { slots: {
  'SAT-1': { level: 'P5', subject: 'Science', mode: 'Both', status: 'open' },
  'WED-2': { level: 'P5', subject: 'Math', mode: 'Both', status: 'open' },
  'TUE-3': { level: 'P3', subject: 'Science', mode: 'Both', status: 'open' }
} };
export const families = [
  { id: 'famA', code: 'ABC123', parentName: 'Mrs Tan', email: 'tan@example.com', status: 'active',
    students: [
      { id: 'kid1', name: 'Ethan Tan', level: 'P5', status: 'active', classes: [{ slotId: 'SAT-1', mode: 'Physical' }, { slotId: 'WED-2', mode: 'Online' }] },
      { id: 'kid2', name: 'Chloe Tan', level: 'P3', status: 'active', classes: [{ slotId: 'TUE-3', mode: 'Physical' }] }
    ] },
  { id: 'famB', code: 'DEF456', parentName: 'Mr Lim', email: '', whatsapp: '91234567', status: 'active',
    students: [{ id: 'kid3', name: 'Ryan Lim', level: 'P5', status: 'active', classes: [{ slotId: 'SAT-1', mode: 'Physical' }] }] },
  { id: 'famC', code: 'GHJ789', parentName: 'Ms Goh', email: 'goh@example.com', status: 'withdrawn', lastMonth: '2026-09',
    students: [{ id: 'kid4', name: 'Zoe Goh', level: 'P5', status: 'active', classes: [{ slotId: 'SAT-1', mode: 'Physical' }] }] },
  { id: 'famD', code: 'KMN234', parentName: 'Mr Ong', email: 'ong@example.com', status: 'active',
    students: [{ id: 'kid5', name: 'Ivan Ong', level: 'P6', status: 'active', classes: [] }] }
];
// The P5 Science Saturday class: worksheet 3 was current before 21 Nov; the
// lesson on Sat 21 Nov (9am, released 11am) moved it to 4.
export const courses = [
  { id: 'c1', level: 'P5', subject: 'science', day: 'Saturday', slot: 0, worksheetIds: ['w1', 'w2', 'w3', 'w4', 'w5'], currentIndex: 2, clockAt: sg(2026, 11, 14, 11, 0) },
  { id: 'c2', level: 'P5', subject: 'math', day: 'Wednesday', slot: 1, worksheetIds: ['m1', 'm2', 'm3'], currentIndex: 0, clockAt: sg(2026, 11, 17, 12, 0) },
  { id: 'c3', level: 'P3', subject: 'science', day: 'Tuesday', slot: 2, worksheetIds: ['s1'], currentIndex: -1, clockAt: 0 },
  { id: 'c4', level: 'P5', subject: 'science', day: 'Saturday', slot: 0, worksheetIds: ['x1'], currentIndex: 0, archived: true }
];
export const docNames = { w1: 'Cells 1', w2: 'Cells 2', w3: 'Plant Transport', w4: 'Human Circulatory System', w5: 'Electrical Systems',
  m1: 'Fractions: Word Problems', m2: 'Ratio 1', m3: 'Ratio 2' };
export const progressBook = { v: 1, students: {
  'r:famA_kid1': { name: 'Ethan Tan', rows: [
    { e: 1700, d: sg(2026, 11, 14, 9, 2), l: 'Sat 9:00am', m: 100, q: 6, a: 6, r: 5, h: 0, k: 6, s: 40, f: 95 },     // last week: outside
    { e: 1800, d: sg(2026, 11, 21, 9, 1), l: 'Sat 9:00am', m: 104, q: 8, a: 7, r: 3, h: 1, k: 7, s: 55, f: 72 },
    { e: 1801, d: sg(2026, 11, 18, 17, 3), l: 'Wed 5:00pm', m: 100, q: 5, a: 5, r: 5, h: 0, k: 5, s: 30, f: 98 }
  ] },
  'r:famB_kid3': { name: 'Ryan Lim', rows: [{ e: 1800, d: sg(2026, 11, 21, 9, 5), l: 'Sat 9:00am', m: 90, q: 8, a: 8, r: 8, h: 0, k: 8, s: 25, f: 99 }] },
  'g:trialUid': { name: 'Trial kid', rows: [{ e: 1800, d: sg(2026, 11, 21, 9, 5), m: 90, q: 1, a: 1, r: 1, h: 0, k: 1, s: 25, f: 99 }] }
} };
export const tutorGaps = {
  sheetOld: { ws: 'Fractions Practice A', sub: 'math', lvl: 'P5', at: sg(2026, 11, 2, 20), n: 10, w: 4, tags: [{ t: 'unit-conversion', q: '3', why: 'Mixed cm and m', v: 'wrong', top: 'Measurement' }, { t: 'misread-question', q: '5', why: 'Missed EACH', v: 'wrong', top: 'Fractions' }] },
  sheetNew1: { ws: 'Ratio Practice B', sub: 'math', lvl: 'P5', at: sg(2026, 11, 19, 20), n: 12, w: 6, tags: [{ t: 'misread-question', q: '2', why: 'Answered for one part, not the total', v: 'wrong', top: 'Ratio' }, { t: 'misread-question', q: '7', why: 'Missed MORE THAN', v: 'partial', top: 'Ratio' }] },
  sheetNew2: { ws: 'Circulatory System Quiz', sub: 'science', lvl: 'P5', at: sg(2026, 11, 20, 19), n: 8, w: 1, tags: [] }
};
export const profiles = [
  { uid: 'study-famA-kid1', data: { officeId: 'famA_kid1', name: 'Ethan Tan', level: 'P5', tutorGaps } },
  { uid: 'googleUidChloe', data: { name: 'Chloe', level: 'P3', tutorGaps: {
    q1: { ws: 'Living Things', sub: 'science', lvl: 'P3', at: sg(2026, 11, 21, 15), n: 6, w: 0, tags: [] } } } },
  { uid: 'strangerUid', data: { name: 'Someone', level: 'P4', tutorGaps: { z: { ws: 'X', sub: 'math', at: sg(2026, 11, 21, 15), n: 3, w: 3, tags: [] } } } }
];
export const access = { googleUidChloe: { parentEmail: 'TAN@example.com', email: 'chloe.kid@example.com', children: [{ name: 'Chloe Tan', level: 'P3', subjects: 'science' }] } };

export function data(extra) {
  return Object.assign({
    families, schedule, courses, docNames, tags: null, settings: {},
    live: W.liveRowsByRoster([progressBook]), practice: W.practiceByRoster(profiles, access, families)
  }, extra || {});
}

