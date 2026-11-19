/* 🩺 Diagnostic report core — polymathlc.com.sg/diagnostic
 *
 * After a child sits the free diagnostic test (a paper marked at the centre), the
 * teacher enters the marks topic by topic on /diagnostic/#admin. Everything a
 * parent then sees is built here, from that one record, by pure functions with no
 * page or network access, so the admin's live preview, the email the parent
 * receives and the parent's report page (/diagnostic/report/) can never disagree:
 *
 *   TOPIC_SETS          the topics of each level's Maths and Science paper (MOE
 *                       primary syllabus), the list the teacher starts from
 *   topicResult/band    marks → percentage → Strong / Developing / Needs work
 *   summarise           the whole paper: overall %, strongest and weakest topics
 *   suggestComment      a first draft of the teacher's note, in plain words
 *   buildPlan           a personal week-by-week study plan, weakest topics first
 *   suggestWhy          why the recommended class fits, in one or two sentences
 *   enrolUrl/trialUrl   the /schedule links that open that class's booking form
 *                       with the parent's details filled in
 *   renderReport        the report as HTML with inline styles only (so it survives
 *                       Gmail and Outlook), shared by the email and the web page
 *   reportMail          the `mail` document the Trigger Email extension sends
 *   cleanReport         the record trimmed to known fields and safe lengths; the
 *                       diagnosticReport function keeps a copy of the same rules
 *
 * Works as a plain <script> (window.DiagnosticReport) and under Node (require),
 * which is how tools/diagnostic-report-tests.mjs checks it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiagnosticReport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPORT_VERSION = 1;
  const SITE = 'https://polymathlc.com.sg';
  const REPORT_PAGE = SITE + '/diagnostic/report/';
  const SCHEDULE_PAGE = SITE + '/schedule/';
  const SENDER_NAME = 'Polymath Learning Centre';
  const SENDER_EMAIL = 'admin@polymathlc.com.sg';
  const WHATSAPP_NUMBER = '6596450588';
  const WHATSAPP_DISPLAY = '+65 9645 0588';
  const LOGO_URL = 'https://dl.dropboxusercontent.com/scl/fi/h40yjlyg8ldefwfaa3dib/polymath-logo-sticker.png?rlkey=o1ra4taqy79gt9t8u096v82zj';
  const REPORT_MAIL_PREFIX = 'polymath-diagnostic-report-';

  // Percentages at or above STRONG are strong; below DEVELOPING need work.
  const STRONG = 75;
  const DEVELOPING = 50;
  const BANDS = Object.freeze({
    strong: { key: 'strong', label: 'Strong', colour: '#15803d', soft: '#dcfce7', bar: '#22c55e', icon: '✓' },
    developing: { key: 'developing', label: 'Developing', colour: '#b45309', soft: '#fef3c7', bar: '#f59e0b', icon: '◐' },
    needs: { key: 'needs', label: 'Needs work', colour: '#be123c', soft: '#ffe4e6', bar: '#f43f5e', icon: '!' }
  });
  const PLAN_WEEKS = Object.freeze([4, 6, 8, 12]);
  const DEFAULT_WEEKS = 8;
  const LIMITS = Object.freeze({ name: 80, topic: 60, note: 160, comment: 1500, why: 400, task: 220, tasks: 5, steps: 6,
    topics: 16, teacher: 60, when: 30, focus: 120, label: 80, marks: 200 });
  const LEVELS = Object.freeze(['Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']);
  const SUBJECTS = Object.freeze(['Math', 'Science']);

  // The topics of each paper, in syllabus order. The teacher can rename, remove or
  // add topics in the admin; this is only where a new report starts.
  const TOPIC_SETS = Object.freeze({
    'Primary 3|Math': ['Whole numbers to 10 000', 'Addition and subtraction', 'Multiplication and division',
      'Fractions', 'Money', 'Length, mass and volume', 'Time', 'Angles and lines', 'Area and perimeter', 'Bar graphs',
      'Word problems (heuristics)'],
    'Primary 4|Math': ['Whole numbers to 100 000', 'Factors and multiples', 'Multiplication and division',
      'Fractions', 'Decimals', 'Time', 'Area and perimeter', 'Angles', 'Rectangles and squares', 'Symmetry',
      'Tables and line graphs', 'Word problems (heuristics)'],
    'Primary 5|Math': ['Whole numbers to 10 million', 'Fractions', 'Decimals', 'Percentage', 'Ratio', 'Rate',
      'Area of triangles', 'Volume of cubes and cuboids', 'Angles and geometry', 'Word problems (heuristics)'],
    'Primary 6|Math': ['Algebra', 'Fractions', 'Ratio', 'Percentage', 'Speed', 'Average', 'Circles',
      'Volume of solids', 'Geometry and special quadrilaterals', 'Pie charts', 'Word problems (heuristics)'],
    'Primary 3|Science': ['Living and non-living things', 'Classifying plants and animals', 'Fungi and bacteria',
      'Materials and their properties', 'Life cycles of plants', 'Life cycles of animals', 'Magnets',
      'Answering open-ended questions'],
    'Primary 4|Science': ['Plant parts and functions', 'Human digestive system', 'Matter', 'Light and shadows',
      'Heat and temperature', 'Experimental skills', 'Answering open-ended questions'],
    'Primary 5|Science': ['Reproduction in plants', 'Reproduction in humans', 'Cells', 'Water and changes of state',
      'Plant transport system', 'Air and the respiratory system', 'Circulatory system', 'Electrical systems',
      'Experimental skills', 'Answering open-ended questions'],
    'Primary 6|Science': ['Forces', 'Energy forms and conversion', 'Photosynthesis', 'Food chains and webs',
      'Adaptations', 'Man\'s impact on the environment', 'Interactions in the environment', 'Experimental skills',
      'Answering open-ended questions']
  });

  // ─── Small helpers ───
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function oneLine(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function paragraph(value, max) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  }
  const subjectName = s => s === 'Math' ? 'Maths' : String(s || '');
  const levelCode = level => { const m = /(\d)/.exec(String(level || '')); return m ? 'P' + m[1] : ''; };
  const levelName = code => String(code || '').replace(/^P(\d)$/, 'Primary $1');
  const firstName = name => oneLine(name, LIMITS.name).split(' ')[0] || 'your child';
  function listWords(items) {
    const list = items.filter(Boolean);
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  const lowerTopic = name => /^[A-Z][a-z]/.test(name) && !/^(PSLE|MOE)/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDate(key) {
    const m = DAY_KEY.exec(String(key || ''));
    return m ? Number(m[3]) + ' ' + MONTH_LONG[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function number(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
  }

  function topicsFor(level, subject) {
    return (TOPIC_SETS[level + '|' + subject] || []).slice();
  }
  function topicSetKeys() { return Object.keys(TOPIC_SETS); }

  // ─── Marks → bands ───
  function band(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
    if (pct >= STRONG) return BANDS.strong;
    if (pct >= DEVELOPING) return BANDS.developing;
    return BANDS.needs;
  }
  // A topic with no marks yet, or marked out of nothing, is left out of every total.
  function topicResult(topic) {
    const score = number(topic && topic.score), max = number(topic && topic.max);
    const scored = score !== null && max !== null && max > 0 && score >= 0 && score <= max;
    const pct = scored ? Math.round(score / max * 100) : null;
    return { name: oneLine(topic && topic.name, LIMITS.topic), note: oneLine(topic && topic.note, LIMITS.note),
      score, max, scored, pct, band: band(pct) };
  }

  function summarise(report) {
    const results = (report && Array.isArray(report.topics) ? report.topics : []).map(topicResult).filter(t => t.name);
    const scored = results.filter(t => t.scored);
    const score = scored.reduce((sum, t) => sum + t.score, 0);
    const max = scored.reduce((sum, t) => sum + t.max, 0);
    const pct = max > 0 ? Math.round(score / max * 100) : null;
    // Lowest first; ties keep the paper's order, so the plan follows the syllabus.
    const byPct = scored.map((t, i) => ({ t, i })).sort((a, b) => a.t.pct - b.t.pct || a.i - b.i).map(x => x.t);
    const strong = scored.filter(t => t.band === BANDS.strong).sort((a, b) => b.pct - a.pct);
    const developing = byPct.filter(t => t.band === BANDS.developing);
    const needs = byPct.filter(t => t.band === BANDS.needs);
    return { results, scored, score, max, pct, band: band(pct), strong, developing, needs,
      focus: needs.concat(developing), complete: scored.length > 0 && scored.length === results.length };
  }

  // ─── Words the teacher starts from ───
  function suggestComment(report) {
    const s = summarise(report);
    const name = firstName(report && report.studentName);
    const subject = subjectName(report && report.subject);
    if (!s.scored.length) return '';
    const parts = [];
    const pctText = s.pct + '%';
    if (s.band === BANDS.strong) parts.push(name + ' did very well on the ' + subject + ' diagnostic test, scoring ' + pctText + ' overall.');
    else if (s.band === BANDS.developing) parts.push(name + ' scored ' + pctText + ' on the ' + subject + ' diagnostic test, with a good base to build on.');
    else parts.push(name + ' scored ' + pctText + ' on the ' + subject + ' diagnostic test. There are some important gaps, and the good news is that they are clear and fixable.');
    if (s.strong.length) parts.push(name + ' is confident in ' + listWords(s.strong.slice(0, 3).map(t => lowerTopic(t.name))) + '.');
    if (s.needs.length) parts.push('The topics to work on first are ' + listWords(s.needs.slice(0, 3).map(t => lowerTopic(t.name))) + '.');
    if (s.developing.length) parts.push((s.needs.length ? 'After that, ' : 'The next step is to firm up ') + listWords(s.developing.slice(0, 3).map(t => lowerTopic(t.name)))
      + (s.needs.length ? ' need more practice to become secure.' : ', which are nearly there.'));
    if (!s.focus.length) parts.push('The next step is harder, exam-standard problem solving to stretch ' + name + ' further.');
    parts.push('The study plan below sets out what to do week by week.');
    return parts.join(' ');
  }

  // Tasks for one topic, by how it went. Science topics get the keyword and
  // open-ended answering habits that marks are lost on.
  function tasksFor(topic, subject) {
    const t = lowerTopic(topic.name);
    const science = subject === 'Science';
    if (topic.band === BANDS.needs) {
      return science ? [
        'Re-learn the key ideas of ' + t + ' with a concept map, then explain it back in your own words.',
        'Learn the key words for ' + t + ' and use them in full-sentence answers.',
        'Do one short set of 8–10 questions on ' + t + ' three times a week, marking each straight away.',
        'Keep a mistakes list and redo every wrong question two days later.'
      ] : [
        'Re-learn ' + t + ' from worked examples, step by step, before practising.',
        'Do one short set of 8–10 questions on ' + t + ' three times a week, marking each straight away.',
        'Keep a mistakes list and redo every wrong question two days later.'
      ];
    }
    if (topic.band === BANDS.developing) {
      return science ? [
        'Practise open-ended questions on ' + t + ': state the concept, then link it to the question.',
        'Do 10 mixed questions on ' + t + ' twice a week and check answers against the keywords.'
      ] : [
        'Practise word problems on ' + t + ', 10 questions twice a week.',
        'Explain one full solution aloud each week; if it can be explained, it is understood.'
      ];
    }
    return ['Stretch with challenging ' + t + ' questions at exam standard.'];
  }

  // A plan of two-week blocks, weakest topics first, ending with mixed timed
  // practice. With nothing to fix it becomes a stretch plan.
  function buildPlan(report, weeks) {
    const total = PLAN_WEEKS.includes(Number(weeks)) ? Number(weeks) : DEFAULT_WEEKS;
    const s = summarise(report);
    const subject = report && report.subject;
    const blocks = total / 2;
    const steps = [];
    const focus = s.focus.slice();
    // Leave the last block for mixed revision whenever there is room for it.
    const topicBlocks = Math.max(1, blocks - 1);
    if (focus.length) {
      const groups = [];
      const perBlock = Math.ceil(focus.length / topicBlocks);
      for (let i = 0; i < focus.length; i += perBlock) groups.push(focus.slice(i, i + perBlock));
      groups.forEach(group => {
        const tasks = [];
        group.forEach(topic => tasksFor(topic, subject).forEach(task => { if (!tasks.includes(task)) tasks.push(task); }));
        steps.push({ focus: group.map(t => t.name).join(', '), tasks: tasks.slice(0, LIMITS.tasks) });
      });
    } else if (s.scored.length) {
      steps.push({ focus: 'Challenge problems', tasks: [
        'Work through harder, multi-step questions across ' + listWords(s.strong.slice(0, 3).map(t => lowerTopic(t.name))) + '.',
        'Try one top-school exam question each day and write out the full working.'
      ] });
    }
    while (steps.length < blocks - 1 && steps.length) {
      steps.push({ focus: 'Consolidate', tasks: [
        'Mix questions from every topic studied so far, 15 questions twice a week.',
        'Redo the questions on the mistakes list until each one is correct without help.'
      ] });
    }
    steps.push({ focus: 'Timed exam practice', tasks: subject === 'Science' ? [
      'One timed paper a week, then mark it with the answer key and correct every answer.',
      'Check open-ended answers for the keywords: what was asked, the concept, the link to the question.'
    ] : [
      'One timed paper a week, then go through every mistake.',
      'Redo the weakest topics from this test and aim for 75% or more.'
    ] });
    const used = steps.slice(0, Math.min(blocks, LIMITS.steps));
    // Spread the weeks so the plan always covers exactly `total` weeks.
    const base = Math.floor(total / used.length), extra = total % used.length;
    let start = 1;
    used.forEach((step, i) => {
      const length = base + (i < extra ? 1 : 0);
      const end = start + length - 1;
      step.when = length === 1 ? 'Week ' + start : 'Weeks ' + start + '–' + end;
      start = end + 1;
    });
    return { weeks: total, steps: used };
  }

  // ─── The recommended class ───
  const WEEKDAY_TIMES = ['3:00pm – 4:45pm', '5:00pm – 6:45pm', '7:00pm – 8:45pm'];
  const SATURDAY_TIMES = ['9:00am – 10:45am', '11:00am – 12:45pm', '1:00pm – 2:45pm'];
  const DAY_NAME = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
  const SLOT_RE = /^(MON|TUE|WED|THU|FRI|SAT)-([123])$/;
  function slotLabel(id) {
    const m = SLOT_RE.exec(String(id || ''));
    if (!m) return '';
    return DAY_NAME[m[1]] + ' ' + (m[1] === 'SAT' ? SATURDAY_TIMES : WEEKDAY_TIMES)[Number(m[2]) - 1];
  }
  // Every open class of this subject on the timetable, the child's 2027 level first,
  // then Master Classes before regular ones, then in weekly order.
  function classOptions(config, level, subject) {
    const slots = config && config.slots && typeof config.slots === 'object' ? config.slots : {};
    const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const want = levelCode(level);
    return Object.keys(slots).filter(id => SLOT_RE.test(id)).map(id => Object.assign({ id }, slots[id]))
      .filter(s => s.status === 'open' && s.level && s.subject === subject)
      .sort((a, b) => (a.level === want ? 0 : 1) - (b.level === want ? 0 : 1)
        || (a.type === 'master' ? 0 : 1) - (b.type === 'master' ? 0 : 1)
        || order.indexOf(a.id.split('-')[0]) - order.indexOf(b.id.split('-')[0]) || a.id.localeCompare(b.id))
      .map(s => ({ slot: s.id, label: slotLabel(s.id), level: s.level, subject: s.subject,
        type: s.type === 'master' ? 'master' : 'regular', mode: s.type === 'master' ? 'Physical' : (s.mode || 'Both') }));
  }
  function className(rec) {
    if (!rec) return '';
    return levelName(rec.level) + ' ' + subjectName(rec.subject) + (rec.type === 'master' ? ' Master Class' : ' class');
  }
  const MODE_WORDS = { Physical: 'at our Clementi centre', Online: 'online on Zoom', Both: 'at our Clementi centre or online' };
  function suggestWhy(report, rec) {
    if (!rec) return '';
    const s = summarise(report);
    const name = firstName(report && report.studentName);
    const parts = [];
    parts.push('This ' + className(rec) + ' is for ' + levelName(rec.level) + ' in 2027, so ' + name + ' learns each topic with us as school covers it.');
    if (rec.type === 'master') parts.push('Master Class goes deeper into exam-standard problem solving, in a small group taught in person.');
    if (s.focus.length) parts.push('We will start ' + name + ' on ' + listWords(s.focus.slice(0, 2).map(t => lowerTopic(t.name))) + ' from the first lesson.');
    else if (s.scored.length) parts.push('It keeps ' + name + ' stretched with challenging questions.');
    return parts.join(' ');
  }

  // /schedule opens the class's booking form with these filled in (schedule page
  // v1.7.0: ?book=SLOT&kind=enrol|trial&parent=&child=&email=&from=diagnostic).
  function bookingUrl(report, kind) {
    const rec = report && report.recommended;
    if (!rec || !SLOT_RE.test(rec.slot || '')) return SCHEDULE_PAGE;
    const params = new URLSearchParams();
    params.set('book', rec.slot);
    params.set('kind', kind === 'trial' ? 'trial' : 'enrol');
    if (report.parentName) params.set('parent', oneLine(report.parentName, LIMITS.name));
    if (report.studentName) params.set('child', oneLine(report.studentName, LIMITS.name));
    if (report.email) params.set('email', oneLine(report.email, 120));
    params.set('from', 'diagnostic');
    return SCHEDULE_PAGE + '?' + params.toString();
  }
  const enrolUrl = report => bookingUrl(report, 'enrol');
  const trialUrl = report => bookingUrl(report, 'trial');
  function reportUrl(code, token) {
    return REPORT_PAGE + '?c=' + encodeURIComponent(code || '') + '&t=' + encodeURIComponent(token || '');
  }

  // ─── The stored record, trimmed ───
  function cleanReport(input) {
    const r = input && typeof input === 'object' ? input : {};
    const topics = (Array.isArray(r.topics) ? r.topics : []).slice(0, LIMITS.topics).map(t => ({
      name: oneLine(t && t.name, LIMITS.topic),
      score: number(t && t.score), max: number(t && t.max),
      note: oneLine(t && t.note, LIMITS.note)
    })).filter(t => t.name);
    const plan = r.plan && typeof r.plan === 'object' ? r.plan : {};
    const steps = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, LIMITS.steps).map(step => ({
      when: oneLine(step && step.when, LIMITS.when),
      focus: oneLine(step && step.focus, LIMITS.focus),
      tasks: (Array.isArray(step && step.tasks) ? step.tasks : []).slice(0, LIMITS.tasks).map(x => oneLine(x, LIMITS.task)).filter(Boolean)
    })).filter(step => step.focus || step.tasks.length);
    const rec = r.recommended && typeof r.recommended === 'object' && SLOT_RE.test(r.recommended.slot || '') ? {
      slot: r.recommended.slot,
      label: oneLine(r.recommended.label, LIMITS.label) || slotLabel(r.recommended.slot),
      level: /^P[3-6]$/.test(r.recommended.level || '') ? r.recommended.level : '',
      subject: SUBJECTS.includes(r.recommended.subject) ? r.recommended.subject : '',
      type: r.recommended.type === 'master' ? 'master' : 'regular',
      mode: ['Physical', 'Online', 'Both'].includes(r.recommended.mode) ? r.recommended.mode : 'Physical',
      why: paragraph(r.recommended.why, LIMITS.why)
    } : null;
    return {
      version: REPORT_VERSION,
      code: oneLine(r.code, 20),
      studentName: oneLine(r.studentName, LIMITS.name),
      parentName: oneLine(r.parentName, LIMITS.name),
      email: oneLine(r.email, 120),
      level: LEVELS.includes(r.level) ? r.level : '',
      subject: SUBJECTS.includes(r.subject) ? r.subject : '',
      testDate: DAY_KEY.test(r.testDate || '') ? r.testDate : '',
      topicSet: oneLine(r.topicSet, 30),
      topics,
      comment: paragraph(r.comment, LIMITS.comment),
      plan: { weeks: PLAN_WEEKS.includes(Number(plan.weeks)) ? Number(plan.weeks) : DEFAULT_WEEKS, steps },
      recommended: rec,
      teacher: oneLine(r.teacher, LIMITS.teacher)
    };
  }

  // Problems that stop a report being sent; the admin shows them in words.
  function reportProblems(report) {
    const r = report || {};
    const problems = [];
    const s = summarise(r);
    if (!s.results.length) problems.push('Add at least one topic.');
    else if (!s.scored.length) problems.push('Enter the marks for at least one topic.');
    const blank = [];
    s.results.forEach(t => {
      if (t.score === null && t.max === null) { blank.push(t.name); return; }
      if (t.max === null || t.max <= 0) problems.push(t.name + ': the marks need an "out of" above 0.');
      else if (t.score === null || t.score < 0 || t.score > t.max) problems.push(t.name + ': the score must be between 0 and ' + t.max + '.');
    });
    if (blank.length && s.scored.length)
      problems.push('No marks yet for ' + listWords(blank) + '. Enter them, or remove the topics that were not tested.');
    if (!r.plan || !Array.isArray(r.plan.steps) || !r.plan.steps.length) problems.push('Build the study plan.');
    if (!r.studentName) problems.push('The student\'s name is missing.');
    return problems;
  }

  // ─── HTML, inline styles only ───
  const INK = '#10303a', TEAL = '#056c76', MUTED = '#5c6b70', LINE = '#d1eaee', PAPER = '#f2f9fa', PINK = '#ec008c';
  const FONT = "'DM Sans','Century Gothic',CenturyGothic,AppleGothic,Arial,sans-serif";

  function pill(b) {
    if (!b) return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:700">Not tested</span>';
    return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:' + b.soft + ';color:' + b.colour
      + ';font-size:12px;font-weight:700;white-space:nowrap">' + escapeHtml(b.label) + '</span>';
  }
  function bar(pct, b) {
    const width = Math.max(0, Math.min(100, pct || 0));
    // A table bar renders in every mail client; divs with widths do not in Outlook.
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;background:#eef2f4;border-radius:6px;height:10px"><tr>'
      + (width > 0 ? '<td width="' + width + '%" style="background:' + (b ? b.bar : '#cbd5e1') + ';border-radius:6px;height:10px;font-size:0;line-height:0">&nbsp;</td>' : '')
      + (width < 100 ? '<td style="height:10px;font-size:0;line-height:0">&nbsp;</td>' : '') + '</tr></table>';
  }
  function ring(pct, b) {
    const colour = b ? b.colour : TEAL;
    return '<div style="display:inline-block;width:112px;height:112px;border-radius:50%;background:' + (b ? b.soft : PAPER)
      + ';text-align:center;border:6px solid ' + colour + ';box-sizing:border-box">'
      + '<div style="font-size:30px;font-weight:800;color:' + colour + ';line-height:1;padding-top:30px">' + (pct === null ? '–' : pct + '%') + '</div>'
      + '<div style="font-size:11px;color:' + MUTED + ';margin-top:4px;letter-spacing:.04em;text-transform:uppercase">overall</div></div>';
  }
  function sectionTitle(text, emoji) {
    return '<h2 style="font-size:18px;color:' + INK + ';margin:30px 0 12px;font-weight:800">' + (emoji ? emoji + ' ' : '') + escapeHtml(text) + '</h2>';
  }
  function paragraphsHtml(text, style) {
    return String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
      .map(p => '<p style="' + style + '">' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
  }
  function button(href, text, primary) {
    return '<a href="' + escapeHtml(href) + '" style="display:inline-block;padding:13px 22px;border-radius:12px;font-weight:800;font-size:15px;text-decoration:none;'
      + (primary ? 'background:' + PINK + ';color:#ffffff;' : 'background:#ffffff;color:' + TEAL + ';border:2px solid ' + TEAL + ';')
      + 'margin:4px 8px 4px 0">' + escapeHtml(text) + '</a>';
  }

  // options: { mode: 'email' | 'web', code, token, preview }
  function renderReport(input, options) {
    const opts = options || {};
    const r = cleanReport(input);
    const s = summarise(r);
    const name = r.studentName || 'Your child';
    const first = firstName(r.studentName);
    const subject = subjectName(r.subject);
    const web = opts.mode === 'web';
    const link = opts.code && opts.token ? reportUrl(opts.code, opts.token) : '';
    const out = [];

    out.push('<div style="font-family:' + FONT + ';color:' + INK + ';max-width:680px;margin:0 auto;background:#ffffff;' + (web ? '' : 'padding:28px 22px;') + '">');
    if (!web) out.push('<img src="' + LOGO_URL + '" alt="Polymath Learning Centre" height="52" style="height:52px;margin-bottom:18px">');
    if (!web && r.parentName) {
      out.push('<p style="font-size:15px;line-height:1.6;margin:0 0 10px">Dear ' + escapeHtml(r.parentName) + ',</p>');
      out.push('<p style="font-size:15px;line-height:1.6;margin:0 0 18px">Thank you for bringing ' + escapeHtml(first)
        + ' for the free diagnostic test. Here is ' + escapeHtml(first) + '\'s personal report, with a study plan and the class we recommend.</p>');
    }

    // Header card
    out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#056c76,#2e9ca6);background-color:' + TEAL + ';border-radius:18px;color:#ffffff"><tr>'
      + '<td style="padding:24px 24px 22px">'
      + '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;font-weight:700">Diagnostic report</div>'
      + '<div style="font-size:26px;font-weight:800;margin:6px 0 4px;line-height:1.2">' + escapeHtml(name) + '</div>'
      + '<div style="font-size:14px;opacity:.92">' + escapeHtml([r.level, subject].filter(Boolean).join(' · '))
      + (r.testDate ? ' · Test sat on ' + escapeHtml(fmtDate(r.testDate)) : '') + '</div>'
      + '</td></tr></table>');

    // Overall
    out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid ' + LINE + ';border-radius:16px"><tr>'
      + '<td width="140" align="center" valign="middle" style="padding:18px 8px 18px 18px">' + ring(s.pct, s.band) + '</td>'
      + '<td valign="middle" style="padding:18px 18px 18px 10px">'
      + '<div style="font-size:13px;color:' + MUTED + '">' + (s.max ? 'Total ' + s.score + ' / ' + s.max + ' marks' : 'No marks yet') + '</div>'
      + '<div style="margin:8px 0 10px">' + pill(s.band) + '</div>'
      + '<div style="font-size:13px;line-height:1.7">'
      + '<span style="color:' + BANDS.strong.colour + ';font-weight:700">' + s.strong.length + ' strong</span> &nbsp;·&nbsp; '
      + '<span style="color:' + BANDS.developing.colour + ';font-weight:700">' + s.developing.length + ' developing</span> &nbsp;·&nbsp; '
      + '<span style="color:' + BANDS.needs.colour + ';font-weight:700">' + s.needs.length + ' need work</span></div>'
      + '</td></tr></table>');

    // Teacher's note
    if (r.comment) {
      out.push(sectionTitle('Teacher\'s note', '💬'));
      out.push('<div style="background:' + PAPER + ';border-left:4px solid ' + TEAL + ';border-radius:10px;padding:14px 16px">'
        + paragraphsHtml(r.comment, 'font-size:15px;line-height:1.65;margin:0 0 8px')
        + (r.teacher ? '<div style="font-size:13px;color:' + MUTED + ';margin-top:6px">— ' + escapeHtml(r.teacher) + '</div>' : '') + '</div>');
    }

    // Topics
    out.push(sectionTitle('Results by topic', '📊'));
    out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">');
    s.results.forEach(t => {
      out.push('<tr><td style="padding:10px 0;border-bottom:1px solid #edf2f4">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        + '<td style="font-weight:700;color:' + INK + ';padding-bottom:6px">' + escapeHtml(t.name) + '</td>'
        + '<td align="right" style="white-space:nowrap;padding-bottom:6px;color:' + MUTED + ';font-size:13px">'
        + (t.scored ? t.score + '/' + t.max + ' &nbsp;<b style="color:' + INK + '">' + t.pct + '%</b>' : '') + ' &nbsp;' + pill(t.band) + '</td></tr>'
        + '<tr><td colspan="2">' + bar(t.pct, t.band) + '</td></tr>'
        + (t.note ? '<tr><td colspan="2" style="font-size:13px;color:' + MUTED + ';padding-top:6px">' + escapeHtml(t.note) + '</td></tr>' : '')
        + '</table></td></tr>');
    });
    out.push('</table>');

    // Strengths and focus
    const listBox = (title, items, b, empty) => '<td valign="top" width="50%" style="padding:6px">'
      + '<div style="border:1px solid ' + LINE + ';border-radius:14px;padding:14px 16px;height:100%">'
      + '<div style="font-weight:800;color:' + b.colour + ';margin-bottom:8px">' + escapeHtml(title) + '</div>'
      + (items.length ? '<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">' + items.map(t => '<li>' + escapeHtml(t.name) + '</li>').join('') + '</ul>'
        : '<div style="font-size:14px;color:' + MUTED + '">' + escapeHtml(empty) + '</div>')
      + '</div></td>';
    out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;margin-left:-6px;width:calc(100% + 12px)"><tr>'
      + listBox('⭐ Strengths', s.strong, BANDS.strong, 'Building up. Strengths will show as the plan goes on.')
      + listBox('🎯 Focus areas', s.focus, BANDS.needs, 'No weak topics. Time to stretch with harder questions.')
      + '</tr></table>');

    // Plan
    if (r.plan.steps.length) {
      out.push(sectionTitle(first + '\'s ' + r.plan.weeks + '-week study plan', '🗓️'));
      out.push('<p style="font-size:14px;color:' + MUTED + ';margin:-4px 0 12px;line-height:1.6">About 20–30 minutes a day, four days a week. Tick each week off together.</p>');
      r.plan.steps.forEach((step, i) => {
        out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;border:1px solid ' + LINE + ';border-radius:14px"><tr>'
          + '<td width="56" valign="top" align="center" style="padding:14px 0 14px 14px">'
          + '<div style="width:36px;height:36px;border-radius:50%;background:' + (i === r.plan.steps.length - 1 ? PINK : TEAL) + ';color:#fff;font-weight:800;font-size:15px;line-height:36px;text-align:center">' + (i + 1) + '</div></td>'
          + '<td valign="top" style="padding:14px 16px 14px 10px">'
          + '<div style="font-size:12px;font-weight:800;color:' + TEAL + ';text-transform:uppercase;letter-spacing:.06em">' + escapeHtml(step.when) + '</div>'
          + '<div style="font-size:16px;font-weight:800;margin:2px 0 6px">' + escapeHtml(step.focus) + '</div>'
          + (step.tasks.length ? '<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:' + INK + '">' + step.tasks.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul>' : '')
          + '</td></tr></table>');
      });
    }

    // Recommendation
    if (r.recommended) {
      const rec = r.recommended;
      out.push(sectionTitle('Our recommended class', '🏫'));
      out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:18px;background:#fff0f8;border:2px solid ' + PINK + '"><tr><td style="padding:20px 20px 18px">'
        + (rec.type === 'master' ? '<div style="display:inline-block;background:' + PINK + ';color:#fff;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">✦ Master Class</div>' : '')
        + '<div style="font-size:20px;font-weight:800;color:' + INK + '">' + escapeHtml(className(rec)) + '</div>'
        + '<div style="font-size:15px;color:' + INK + ';margin:4px 0 10px">Every ' + escapeHtml(rec.label) + ', ' + escapeHtml(MODE_WORDS[rec.mode] || MODE_WORDS.Physical) + '</div>'
        + (rec.why ? paragraphsHtml(rec.why, 'font-size:14px;line-height:1.65;margin:0 0 12px;color:' + INK) : '')
        + '<div>' + button(opts.preview ? '#' : enrolUrl(r), 'Enrol ' + first + ' now', true) + button(opts.preview ? '#' : trialUrl(r), 'Book a trial lesson first', false) + '</div>'
        + '<div style="font-size:12px;color:' + MUTED + ';margin-top:10px">Your details are filled in for you. Places are limited in each class.</div>'
        + '</td></tr></table>');
    }

    // Footer
    out.push('<p style="font-size:14px;line-height:1.65;margin:26px 0 0">Questions about the report? Reply to this email or WhatsApp us at '
      + '<a href="https://wa.me/' + WHATSAPP_NUMBER + '" style="color:' + TEAL + ';font-weight:700">' + WHATSAPP_DISPLAY + '</a>.</p>');
    if (!web && link) out.push('<p style="font-size:14px;margin:10px 0 0"><a href="' + escapeHtml(link) + '" style="color:' + TEAL + ';font-weight:700">View and print this report online</a></p>');
    if (!web) out.push('<p style="font-size:15px;line-height:1.6;margin:22px 0 0">Warm regards,<br>' + escapeHtml(r.teacher || SENDER_NAME)
      + (r.teacher ? '<br><span style="color:' + MUTED + ';font-size:13px">' + SENDER_NAME + '</span>' : '') + '</p>');
    out.push('<p style="font-size:12px;color:#8a9a9f;margin:26px 0 0;line-height:1.6">' + SENDER_NAME + ' · Clementi, Singapore · '
      + '<a href="' + SITE + '/" style="color:#8a9a9f">polymathlc.com.sg</a></p>');
    out.push('</div>');
    return out.join('');
  }

  function renderText(input, options) {
    const opts = options || {};
    const r = cleanReport(input);
    const s = summarise(r);
    const first = firstName(r.studentName);
    const lines = [];
    if (r.parentName) lines.push('Dear ' + r.parentName + ',', '');
    lines.push('Diagnostic report: ' + r.studentName + ' (' + [r.level, subjectName(r.subject)].filter(Boolean).join(' ') + ')');
    if (r.testDate) lines.push('Test sat on ' + fmtDate(r.testDate));
    lines.push('Overall: ' + (s.pct === null ? '-' : s.pct + '%') + (s.max ? ' (' + s.score + '/' + s.max + ' marks)' : '') + (s.band ? ', ' + s.band.label : ''), '');
    if (r.comment) lines.push('Teacher\'s note:', r.comment, '');
    lines.push('Results by topic:');
    s.results.forEach(t => lines.push('- ' + t.name + ': ' + (t.scored ? t.score + '/' + t.max + ' (' + t.pct + '%) ' + t.band.label : 'not tested')));
    lines.push('');
    if (r.plan.steps.length) {
      lines.push(first + '\'s ' + r.plan.weeks + '-week study plan:');
      r.plan.steps.forEach(step => { lines.push(step.when + ': ' + step.focus); step.tasks.forEach(x => lines.push('  * ' + x)); });
      lines.push('');
    }
    if (r.recommended) {
      lines.push('Recommended class: ' + className(r.recommended) + ', every ' + r.recommended.label);
      if (r.recommended.why) lines.push(r.recommended.why);
      lines.push('Enrol: ' + enrolUrl(r), 'Book a trial lesson: ' + trialUrl(r), '');
    }
    if (opts.code && opts.token) lines.push('View this report online: ' + reportUrl(opts.code, opts.token), '');
    lines.push('Questions? Reply to this email or WhatsApp ' + WHATSAPP_DISPLAY + '.', '', 'Warm regards,', r.teacher || SENDER_NAME);
    return lines.join('\n');
  }

  // The document the Trigger Email extension sends. `to` is the parent, or the
  // teacher for a test copy (marked in the subject so it is never mistaken).
  function reportMail(input, { code, token, to, test } = {}) {
    const r = cleanReport(input);
    const subject = (test ? '[TEST] ' : '') + r.studentName + '\'s diagnostic report and study plan — ' + subjectName(r.subject);
    return {
      to: [String(to || r.email || '').trim()],
      from: SENDER_NAME + ' <' + SENDER_EMAIL + '>',
      replyTo: SENDER_EMAIL,
      message: {
        subject,
        html: '<div style="background:#f2f6f7;padding:18px 0">' + renderReport(r, { mode: 'email', code, token }) + '</div>',
        text: renderText(r, { code, token })
      },
      polymathDiagnostic: { code: code || '', kind: test ? 'diagnostic-report-test' : 'diagnostic-report' }
    };
  }

  // A link-safe random key for the parent's report page.
  function newToken(getRandomValues) {
    const bytes = new Uint8Array(18);
    getRandomValues(bytes);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // A new report for a booking: the paper's topics with no marks yet.
  function blankReport(booking, teacher) {
    const b = booking || {};
    const level = LEVELS.includes(b.level) ? b.level : '';
    const subject = SUBJECTS.includes(b.subject) ? b.subject : '';
    return {
      version: REPORT_VERSION,
      code: b.code || b._id || '',
      studentName: b.childName || '', parentName: b.parentName || '', email: b.email || '',
      level, subject, testDate: b.diagnosticDate || '',
      topicSet: level && subject ? level + '|' + subject : '',
      topics: topicsFor(level, subject).map(name => ({ name, score: null, max: null, note: '' })),
      comment: '', plan: { weeks: DEFAULT_WEEKS, steps: [] }, recommended: null, teacher: teacher || 'Mr Chung'
    };
  }

  return {
    REPORT_VERSION, REPORT_PAGE, SCHEDULE_PAGE, SENDER_NAME, SENDER_EMAIL, REPORT_MAIL_PREFIX, STRONG, DEVELOPING, BANDS,
    PLAN_WEEKS, DEFAULT_WEEKS, LIMITS, LEVELS, SUBJECTS, TOPIC_SETS,
    escapeHtml, subjectName, levelCode, levelName, fmtDate, slotLabel, topicsFor, topicSetKeys,
    band, topicResult, summarise, suggestComment, tasksFor, buildPlan, classOptions, className, suggestWhy,
    enrolUrl, trialUrl, reportUrl, cleanReport, reportProblems, renderReport, renderText, reportMail, newToken, blankReport
  };
}));
