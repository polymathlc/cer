/* The Free Question of the Day box on the home page (index.html, #lp-qotd).
 *
 * Shows today's Maths or Science question (fetched when the box comes into view, so
 * the home page itself loads no faster or slower), lets a visitor lock in an answer
 * (kept on this device, shared with polymathlc.com.sg/question, where tomorrow's
 * worked answer is), and signs parents up for the free email with one field.
 * The full page, with the choice of subjects and daily or weekly, is /question/.
 */
(function () {
  'use strict';
  var API = 'https://us-central1-mathgen--app.cloudfunctions.net/dailyQuestion';
  var PAGE_VERSION = 'home-v1.0.0';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var EMAIL_PATTERN = /^[^\s@<>(),;:\\"]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
  var root = document.getElementById('lp-qotd');
  if (!root) return;
  var box = root.querySelector('[data-qotd-question]');
  var form = root.querySelector('[data-qotd-form]');
  var data = null, subject = 'math', loading = false;

  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function store(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
    return null;
  }
  function getPick(q) {
    var raw = store('qotd-pick-' + q.day + '-' + q.subject);
    if (!raw) return null;
    var parts = raw.split(':');
    return parts[0] === q.id && Number(parts[1]) >= 0 && Number(parts[1]) < 4 ? Number(parts[1]) : null;
  }
  function post(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .catch(function () { return { status: 0, body: {} }; });
  }

  function render() {
    if (!data) return;
    var q = data.questions[subject];
    if (!q) return;
    var pick = getPick(q);
    var html = '<div class="qd-top"><div class="qd-tabs" role="tablist" aria-label="Subject">'
      + ['math', 'science'].map(function (s) {
        return '<button type="button" role="tab" class="qd-tab ' + s + (s === subject ? ' on' : '') + '" aria-selected="' + (s === subject) + '" data-s="' + s + '">'
          + (s === 'math' ? '🔢 Maths' : '🔬 Science') + '</button>';
      }).join('') + '</div><span class="qd-day">' + esc(q.dayShort) + '</span></div>';
    html += '<div class="qd-tags"><span class="qd-tag ' + q.subject + '">' + esc(q.level + ' ' + q.subjectLabel) + '</span> <span class="qd-topic">' + esc(q.topic) + '</span></div>';
    html += '<p class="qd-q">' + esc(q.q) + '</p><div class="qd-opts">';
    q.options.forEach(function (o, i) {
      html += '<button type="button" class="qd-opt' + (i === pick ? ' picked' : '') + '"' + (pick !== null ? ' disabled' : '') + ' data-i="' + i + '">'
        + '<span class="qd-letter">' + LETTERS[i] + '</span><span>' + esc(o) + '</span></button>';
    });
    html += '</div>';
    html += pick !== null
      ? '<div class="qd-locked"><b>Locked in: ' + LETTERS[pick] + '.</b> The worked answer is ready tomorrow. <a href="question/">See yesterday\'s answer →</a></div>'
      : '<div class="qd-foot"><span>Pick an answer. The worked answer comes tomorrow.</span><a href="question/">Yesterday\'s answer →</a></div>';
    box.innerHTML = html;
    box.setAttribute('aria-busy', 'false');
  }
  function load() {
    if (loading || data) return;
    loading = true;
    post({ action: 'today' }).then(function (r) {
      loading = false;
      if (r.status === 200 && r.body && r.body.ok) { data = r.body; render(); }
      else box.innerHTML = '<div class="qd-foot"><span>Today\'s question is on its own page.</span><a href="question/">Open it →</a></div>';
    });
  }
  box.addEventListener('click', function (e) {
    var tab = e.target.closest('.qd-tab');
    if (tab) { subject = tab.getAttribute('data-s'); render(); return; }
    var opt = e.target.closest('.qd-opt');
    if (opt && !opt.disabled && data) {
      var q = data.questions[subject];
      store('qotd-pick-' + q.day + '-' + q.subject, q.id + ':' + opt.getAttribute('data-i'));
      render();
    }
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('[name=email]').value.trim();
      var consent = form.querySelector('[name=consent]').checked;
      var note = form.querySelector('[data-qotd-note]');
      var button = form.querySelector('button[type=submit]');
      note.className = 'qd-note';
      if (!EMAIL_PATTERN.test(email)) { note.textContent = 'Please check your email address.'; note.className = 'qd-note err'; return; }
      if (!consent) { note.textContent = 'Please tick the box to agree to receive the emails.'; note.className = 'qd-note err'; return; }
      button.disabled = true;
      post({ action: 'subscribe', email: email, subjects: ['math', 'science'], frequency: 'daily', consent: true, pageVersion: PAGE_VERSION, source: 'home-page',
        website: form.querySelector('[name=website]').value }).then(function (r) {
        button.disabled = false;
        if (r.status === 200 && r.body.ok) {
          form.innerHTML = '<div class="qd-done"><b>✉️ Almost done! Check your inbox.</b> Click "Yes, send me the questions" in the email we sent to '
            + esc(email) + '. <a href="question/#join">Prefer Saturdays only, or one subject?</a></div>';
        } else {
          note.textContent = r.status === 429 ? 'Too many sign-ups from this connection. Please try again later.' : 'Something went wrong. Please try again.';
          note.className = 'qd-note err';
        }
      });
    });
  }

  if ('IntersectionObserver' in window) {
    var seen = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { seen.disconnect(); load(); }
    }, { rootMargin: '600px 0px' });
    seen.observe(root);
  } else load();
})();
