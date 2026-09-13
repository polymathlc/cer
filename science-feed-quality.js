// Science feeding quality checks are local, deterministic and free of AI calls.
// Poor student performance is not evidence that a question is wrong.
export const PRACTICE_QUALITY_VERSION = 1;
const SEVERITY = Object.freeze({
  'content-missing': 'blocked', 'content-malformed': 'blocked',
  'image-missing': 'blocked', 'image-invalid': 'blocked', 'image-unavailable': 'blocked',
  'options-malformed': 'blocked', 'options-duplicate': 'blocked',
  'table-malformed': 'blocked', 'table-truncated': 'blocked',
  'answer-key-review': 'blocked', 'checked-issue': 'blocked', 'teacher-quarantine': 'blocked',
  'table-shape-review': 'suspect', 'placeholder-review': 'suspect',
  'text-review': 'suspect', 'metadata-review': 'suspect', 'answer-space-review': 'suspect',
  'diagram-review': 'suspect', 'import-warning': 'suspect', 'checked-review': 'suspect',
  'student-report': 'suspect', 'reported-review': 'suspect'
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value == null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const text = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const publicScalar = value => scalar(value) ? value ?? null : null;
const publicList = value => Array.isArray(value) ? value.map(publicScalar) : publicScalar(value);
const placeholder = value => /\[(?:insert|replace with)\s+(?:question|diagram|image|table|text|options?)(?:\s+here)?\]|\{\{\s*(?:QUESTION_TEXT|INSERT_QUESTION|INSERT_DIAGRAM|INSERT_OPTIONS)\s*\}\}|\bLorem ipsum\b|^\s*(?:TODO|TBD):\s*(?:question|diagram|options?|text)\s*$/i.test(String(value ?? ''));
const blankPrompt = value => String(value ?? '')
  .replace(/\[\[[\s\S]+?\]\](?:\s*\[\[[\s\S]+?\]\])*/g, '\uE000')
  .replace(/\[\[[\s\S]*$/g, '\uE000').replace(/\uE000/g, '[[_]]');

function hash(raw) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < raw.length; i++) {
    a = Math.imul(a ^ raw.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ raw.charCodeAt(i);
  }
  return `${raw.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}

function publicGrid(data) {
  if (!data || (!Array.isArray(data) && !object(data))) return null;
  return Object.keys(data).filter(k => /^\d+$/.test(k)).sort((a,b) => +a-+b).map(r => {
    const row = data[r];
    return [r, row && (Array.isArray(row) || object(row))
      ? Object.keys(row).filter(k => /^\d+$/.test(k)).sort((a,b) => +a-+b).map(c => [c, publicScalar(row[c])]) : null];
  });
}

// This is an explicit PUBLIC projection, never a hash of the full document.
// correctId, CER/model answers, explanations, answerKeywords, answerImg and
// answerKey never enter it. Even [[answer]] is replaced by a uniform slot:
// hashing a small private answer space would reveal those answers by guessing.
export function questionQualitySignature(question) {
  const q = object(question) ? question : {};
  const blocks = Array.isArray(q.blocks) ? q.blocks.map(b => {
    if (!object(b)) return null;
    const p = {type: publicScalar(b.type), id: publicScalar(b.id), part: publicScalar(b.part), subPart: publicScalar(b.subPart), marks: publicScalar(b.marks)};
    if (b.type === 'text' || b.type === 'part') p.content = publicScalar(b.content);
    if (b.type === 'part') p.label = publicScalar(b.label);
    if (b.type === 'image') Object.assign(p, {url: publicScalar(b.url), caption: publicScalar(b.caption), annotate: b.annotate !== false});
    if (b.type === 'table') Object.assign(p, {data: publicGrid(b.data), rows: publicScalar(b.rows), cols: publicScalar(b.cols),
      headers: publicList(b.headers), merges: Array.isArray(b.merges) ? b.merges.map(m => object(m)
        ? [m.sr,m.sc,m.er,m.ec].map(publicScalar) : null) : null});
    if (b.type === 'mcq') p.options = Array.isArray(b.options) ? b.options.map(o => object(o)
      ? {id: publicScalar(o.id), text: publicScalar(o.text)} : null) : null;
    if (b.type === 'fillblank') p.text = scalar(b.text) ? blankPrompt(b.text) : null;
    if (b.type === 'commonMistake') Object.assign(p, {title: publicScalar(b.title), text: publicScalar(b.text)});
    // This quoted sample is intentionally visible question context, unlike the
    // model answers in answer/plainanswer/workingSpace blocks.
    if (b.type === 'studentAnswer') p.sample = publicScalar(b.answer);
    if (['answer','plainanswer','answerLine','openLines','workingSpace','objectivesBox','studentAnswer'].includes(b.type)) {
      p.label = publicScalar(b.label); p.lines = publicScalar(b.lines); p.annotate = b.annotate === true;
    }
    return p;
  }) : null;
  return hash(JSON.stringify([publicScalar(q.title), publicScalar(q.level), publicList(q.levels),
    publicScalar(q.topic), publicScalar(q.topic2), publicList(q.topics), publicScalar(q.category), publicList(q.los), blocks,
    q.annotation === true, q.hasDiagram === true, q.diagramWhole === true,
    q.practiceQuarantined === true, publicScalar(q.qualityStatus), publicScalar(q.status)]));
}

function entities(raw) {
  return String(raw ?? '').replace(/&(?:nbsp|#0*160|#x0*a0);/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (s,n) => { const p = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : +n;
      return p > 0 && p <= 0x10ffff ? String.fromCodePoint(p) : s; }).replace(/&amp;/gi, '&');
}

// CER renders rich HTML. Unlike Math's escaped text renderer, ordinary HTML,
// sub/superscripts, inline diagrams and equations are valid question content.
function renderedContent(value) {
  let raw = String(value ?? '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<([a-z][\w:-]*)\b[^>]*(?:\bhidden\b|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const images = [];
  raw.replace(/<img\b[^>]*>/gi, tag => {
    const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const set = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    images.push(entities(m ? m[1] ?? m[2] ?? m[3] : set ? (set[1] ?? set[2]).trim().split(/\s+/)[0].replace(/,$/,'') : ''));
    return tag;
  });
  const vector = /<svg\b[\s\S]*?<(?:path|circle|rect|line|polyline|polygon|text)\b[^>]*>[\s\S]*?<\/svg\s*>/i.test(raw);
  const visible = entities(raw.replace(/<\/?(?:p|div|span|br|b|strong|i|em|u|sup|sub|ul|ol|li|table|tbody|thead|tfoot|tr|th|td|img|svg|path|circle|rect|line|polyline|polygon|text|g|math|mrow|mi|mo|mn|msup|msub|mfrac|semantics|annotation|a|h[1-6]|blockquote|hr|s|strike|font|small)\b[^>]*>/gi, ' '))
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '');
  return {visible: text(visible), images, vector};
}

function imageReason(value) {
  const url = String(value ?? '').trim();
  if (!url) return 'image-missing';
  if (/^blob:/i.test(url)) return 'image-unavailable';
  if (/^data:/i.test(url)) {
    const m = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,([\s\S]+)$/i.exec(url);
    if (!m || !m[1].trim() || (/;base64,/i.test(url) && !/^[a-z0-9+/\s]+={0,2}$/i.test(m[1]))) return 'image-invalid';
    return '';
  }
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
    try { return new URL(url.startsWith('//') ? `https:${url}` : url).hostname ? '' : 'image-invalid'; }
    catch { return 'image-invalid'; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /[<>\u0000-\u001f]/.test(url)) return 'image-invalid';
  return /^(?:\.{0,2}\/)/.test(url) || /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(url) ? '' : 'image-invalid';
}

function assessment(reasons) {
  const unique = [...new Set(reasons)].filter(r => own(SEVERITY, r)).sort();
  const tier = unique.some(r => SEVERITY[r] === 'blocked') ? 'blocked' : unique.length ? 'suspect' : 'sound';
  return {eligible: tier !== 'blocked', tier, penalty: tier === 'blocked' ? 100000 : tier === 'suspect' ? 10000 : 0, reasons: unique};
}

function structuralReasons(q, options) {
  const reasons = [], failed = new Set(options.failedImageUrls || []);
  let content = false, images = 0, answerSpace = false;
  const inspectImage = url => {
    images++;
    const reason = imageReason(url);
    if (reason) reasons.push(reason);
    if (failed.has(String(url ?? '').trim())) reasons.push('image-unavailable');
    return !reason;
  };
  const inspectText = value => {
    if (!scalar(value)) { reasons.push('content-malformed'); return false; }
    const r = renderedContent(value || '');
    if (placeholder(r.visible)) reasons.push('placeholder-review');
    if ((r.visible.match(/\uFFFD/g) || []).length >= 2) reasons.push('text-review');
    const diagram = r.images.map(inspectImage).some(Boolean) || r.vector;
    return !!r.visible.replace(/[\s_.…—–-]/g, '') || diagram;
  };
  if (!Array.isArray(q.blocks)) reasons.push('content-malformed');
  else for (const b of q.blocks) {
    if (!object(b)) { reasons.push('content-malformed'); continue; }
    switch (b.type) {
      case 'text': case 'part': content = inspectText(b.content) || content; break;
      case 'image': content = inspectImage(b.url) || content; answerSpace ||= q.annotation === true && b.annotate !== false; break;
      case 'table': {
        const data = b.data;
        if (!data || (!Array.isArray(data) && !object(data))) { reasons.push('table-malformed'); break; }
        const rows = Number(b.rows || 3), cols = Number(b.cols || 3);
        if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 200 || cols > 100) {
          reasons.push('table-malformed'); break;
        }
        // The renderer accepts both arrays and Firestore's numeric-key maps.
        // Cells missing from a declared grid are blank writing cells, not errors.
        for (const rk of Object.keys(data)) {
          if (!/^\d+$/.test(rk) || !data[rk] || (!Array.isArray(data[rk]) && !object(data[rk]))) { reasons.push('table-malformed'); continue; }
          for (const ck of Object.keys(data[rk])) {
            if (!/^\d+$/.test(ck) || !scalar(data[rk][ck])) { reasons.push('table-malformed'); continue; }
            const has = inspectText(data[rk][ck]);
            if (+rk >= rows || +ck >= cols) { if (has) reasons.push('table-truncated'); }
            else content ||= has;
          }
        }
        if (b.headers) {
          if (!Array.isArray(data) || (!Array.isArray(b.headers) && !object(b.headers))) reasons.push('table-malformed');
          else for (const ck of Object.keys(b.headers)) {
            const has = inspectText(b.headers[ck]);
            if (+ck >= cols && has) reasons.push('table-truncated'); else content ||= has;
          }
        }
        if (b.merges != null && !Array.isArray(b.merges)) reasons.push('table-malformed');
        else for (const m of b.merges || []) {
          if (!object(m) || ![m.sr,m.sc,m.er,m.ec].every(Number.isInteger)
            || m.sr < 0 || m.sc < 0 || m.er < m.sr || m.ec < m.sc || m.er >= rows || m.ec >= cols) reasons.push('table-shape-review');
        }
        break;
      }
      case 'mcq': {
        answerSpace = true;
        if (!Array.isArray(b.options) || b.options.length < 2) { reasons.push('options-malformed'); break; }
        const ids = [], choices = [];
        for (const o of b.options) {
          if (!object(o) || !scalar(o.id) || !text(o.id) || !inspectText(o.text)) { reasons.push('options-malformed'); continue; }
          const r = renderedContent(o.text);
          ids.push(String(o.id));
          // Preserve case, scientific symbols and image identities. Superscripts
          // remain distinct from plain digits via the original markup identity.
          const significantMarkup = /<(?:sup|sub|math|svg)\b/i.test(String(o.text));
          choices.push(JSON.stringify([significantMarkup ? text(o.text) : r.visible, r.images]));
        }
        if (new Set(ids).size !== ids.length) reasons.push('options-malformed');
        if (new Set(choices).size !== choices.length) reasons.push('options-duplicate');
        // CER stores this key with the question. Absence is allowed in a future
        // public projection; an explicitly invalid key cannot mark any answer.
        if (own(b,'correctId') && (!scalar(b.correctId) || !ids.includes(String(b.correctId)))) reasons.push('answer-key-review');
        break;
      }
      case 'fillblank': {
        if (!scalar(b.text)) { reasons.push('content-malformed'); break; }
        const prompt = blankPrompt(b.text);
        content = inspectText(prompt) || content;
        answerSpace ||= /\[\[[\s\S]+?\]\]/.test(String(b.text ?? ''));
        if (/\[\[|\]\]/.test(String(b.text ?? '').replace(/\[\[[\s\S]+?\]\]/g,''))) reasons.push('text-review');
        break;
      }
      case 'answer': case 'plainanswer': case 'openLines': case 'workingSpace': answerSpace = true; break;
      case 'commonMistake': inspectText(b.text); break;
      case 'studentAnswer': inspectText(b.answer); break; // Visible context; never a substitute for a stem.
      case 'answerLine': case 'answerKey': case 'explanation': case 'widget': case 'video': case 'objectivesBox': case 'pageBreak': break;
      default: reasons.push('content-malformed');
    }
  }
  if (!content) reasons.push('content-missing');
  if (!answerSpace) reasons.push('answer-space-review');
  if (q.hasDiagram === true && !images) reasons.push('image-missing');
  if (q.diagramWhole === true) reasons.push('diagram-review');
  if (q.practiceQuarantined === true || q.qualityStatus === 'quarantined' || q.status === 'flagged' || q.status === 'pending') reasons.push('teacher-quarantine');
  if (options.studentFlagged === true) reasons.push('student-report');
  return reasons;
}

function existingChecks(q, options) {
  const reasons = [];
  if (text(q.importWarning)) reasons.push('import-warning');
  const check = q.autoCheck;
  if (object(check) && typeof options.importSignature === 'string' && options.importSignature && check.sig === options.importSignature) {
    if (check.state === 'red') reasons.push('checked-issue');
    if (check.state === 'amber') reasons.push('checked-review');
  }
  // This optional value is the existing tlStateOf(q), which verifies freshness.
  // Reading it does not run the traffic-light checker or spend AI tokens.
  const checked = options.checkedState;
  if (object(checked) && checked.stale !== true) {
    if (checked.state === 'red') reasons.push('checked-issue');
    if (checked.state === 'amber') reasons.push('checked-review');
  }
  return reasons;
}

export function evaluateQuestionQuality(question, options = {}) {
  const q = object(question) ? question : {};
  const reasons = structuralReasons(q, options).concat(existingChecks(q, options));
  const summary = q.practiceQuality, signature = questionQualitySignature(q);
  if (options.ignoreStoredSummary !== true && object(summary) && summary.version === PRACTICE_QUALITY_VERSION
    && summary.signature === signature && Array.isArray(summary.reasonCodes)) {
    reasons.push(...summary.reasonCodes.filter(r => own(SEVERITY,r)));
  }
  return assessment(reasons);
}

export function questionHasUnresolvedStudentFlag(question, report) {
  if (!object(report)) return false;
  const signature = questionQualitySignature(question);
  if (report.signature !== signature) return false;
  const summary = question?.practiceQuality;
  const reportedAt = typeof report.at === 'number' ? report.at : Date.parse(report.at);
  const reviewedAt = typeof summary?.reportsReviewedAt === 'number' ? summary.reportsReviewedAt : Date.parse(summary?.reportsReviewedAt);
  return !(summary?.version === PRACTICE_QUALITY_VERSION && summary.signature === signature && summary.reportCount === 0
    && Number.isFinite(reportedAt) && Number.isFinite(reviewedAt) && reviewedAt >= reportedAt);
}

export function buildQuestionQualitySummary(question, options = {}) {
  const q = object(question) ? question : {};
  const reasons = structuralReasons(q, {}).concat(existingChecks(q,options));
  const signature = questionQualitySignature(q);
  const previous = q.practiceQuality?.version === PRACTICE_QUALITY_VERSION && q.practiceQuality.signature === signature ? q.practiceQuality : {};
  const count = own(options,'unresolvedFlagCount') ? options.unresolvedFlagCount : previous.reportCount;
  const reportCount = Math.min(100000, Math.max(0, Math.floor(Number(count) || 0)));
  if (reportCount) reasons.push('reported-review');
  const ack = own(options,'reportsReviewedAt') ? options.reportsReviewedAt : previous.reportsReviewedAt;
  const reportsReviewedAt = typeof ack === 'number' ? ack : Date.parse(ack);
  const result = assessment(reasons);
  return {version: PRACTICE_QUALITY_VERSION, signature, tier: result.tier, reasonCodes: result.reasons, reportCount,
    ...(reportCount === 0 && Number.isFinite(reportsReviewedAt) && reportsReviewedAt > 0 ? {reportsReviewedAt} : {})};
}
