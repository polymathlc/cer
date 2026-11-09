// One comment form for game questions. Reporting does not answer the question.
(function (root) {
  'use strict';

  const COMMENT_LIMIT = 1000;
  let sequence = 0;

  function requestId() {
    const random = new Uint32Array(2);
    root.crypto.getRandomValues(random);
    return 'game-flag-' + random[0].toString(36) + '-' + random[1].toString(36) + '-' + (++sequence);
  }

  function installStyles(document) {
    if (document.getElementById('gameQuestionFlagStyles')) return;
    const style = document.createElement('style');
    style.id = 'gameQuestionFlagStyles';
    style.textContent = `
      .game-question-flag { min-width: 0; flex: 1 1 13rem; margin-block: .4rem; text-align: left; }
      .game-question-flag[hidden], .game-question-flag [hidden] { display: none !important; }
      .game-question-flag button { border: 1px solid currentColor; border-radius: .5rem; padding: .5rem .7rem; background: transparent; color: inherit; font: inherit; font-size: .86rem; cursor: pointer; }
      .game-question-flag button:disabled { opacity: .65; cursor: default; }
      .game-question-flag form { display: grid; gap: .5rem; width: min(100%, 27rem); }
      .game-question-flag label { display: grid; gap: .35rem; color: inherit; font-size: .86rem; }
      .game-question-flag textarea { box-sizing: border-box; width: 100%; min-height: 4rem; resize: vertical; padding: .5rem; border: 1px solid currentColor; border-radius: .5rem; background: transparent; color: inherit; font: inherit; font-size: 16px; }
      .gqf-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
      .gqf-status { margin: .4rem 0 0; font-size: .84rem; }
      .gqf-status:empty { margin: 0; }
    `;
    document.head.appendChild(style);
  }

  function create(host, options) {
    installStyles(host.ownerDocument);
    host.classList.add('game-question-flag');
    host.innerHTML = `
      <button class="gqf-toggle" type="button" aria-expanded="false">⚑ Flag this question</button>
      <form hidden>
        <label>Describe the issue
          <textarea rows="3" maxlength="${COMMENT_LIMIT}" placeholder="For example, an incorrect answer or unclear diagram"></textarea>
        </label>
        <div class="gqf-actions">
          <button class="gqf-cancel" type="button">Cancel</button>
          <button class="gqf-submit" type="submit">Submit flag</button>
        </div>
      </form>
      <p class="gqf-status" role="status"></p>
    `;
    const toggle = host.querySelector('.gqf-toggle');
    const form = host.querySelector('form');
    const comment = host.querySelector('textarea');
    const cancel = host.querySelector('.gqf-cancel');
    const submit = host.querySelector('.gqf-submit');
    const status = host.querySelector('.gqf-status');
    let question = null;
    let pending = null;
    let retry = null;

    function closeForm() {
      form.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    function reset() {
      if (pending) pending.abort();
      pending = null;
      question = null;
      retry = null;
      host.hidden = true;
      toggle.hidden = false;
      closeForm();
      comment.value = '';
      comment.readOnly = false;
      submit.disabled = cancel.disabled = false;
      submit.textContent = 'Submit flag';
      status.textContent = '';
    }

    function setQuestion(next) {
      if (question && question === next) return;
      reset();
      if (next?.id == null || !String(next.id)) return;
      question = next;
      host.hidden = false;
    }

    function available() {
      if (!question || !options.current(question)) return false;
      const reason = options.unavailable?.(question);
      if (reason) status.textContent = reason;
      return !reason;
    }

    toggle.addEventListener('click', function () {
      if (toggle.hidden || !available()) return;
      status.textContent = '';
      toggle.hidden = true;
      toggle.setAttribute('aria-expanded', 'true');
      form.hidden = false;
      comment.focus();
    });

    cancel.addEventListener('click', function () {
      closeForm();
      toggle.hidden = false;
      if (!retry) {
        comment.value = '';
        status.textContent = '';
      }
      toggle.focus();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (pending || form.hidden || !available()) return;
      const text = comment.value.trim();
      if (!text) {
        status.textContent = 'Please describe the issue.';
        comment.focus();
        return;
      }
      const selected = question;
      const title = options.title?.(selected) || selected.q || selected.title || selected.text || '';
      const payload = retry || {
        requestId: requestId(), questionId: String(selected.id),
        questionTitle: String(title).trim().slice(0, 160), comment: text.slice(0, COMMENT_LIMIT)
      };
      const attempt = new AbortController();
      pending = attempt;
      submit.disabled = cancel.disabled = true;
      comment.readOnly = true;
      submit.textContent = 'Submitting…';
      status.textContent = '';
      const timer = root.setTimeout(() => attempt.abort(), 10000);
      try {
        const aborted = new Promise((resolve, reject) => {
          attempt.signal.addEventListener('abort', () => reject(new Error('Flag not confirmed')), { once: true });
        });
        const result = await Promise.race([options.submit(payload, selected, attempt.signal), aborted]);
        if (pending !== attempt || !options.current(selected)) return;
        retry = null;
        if (result?.ok) {
          closeForm();
          toggle.hidden = true;
          status.textContent = 'Flag submitted. Your teacher can review your comment.';
          status.tabIndex = -1;
          status.focus({ preventScroll: true });
        } else {
          status.textContent = result?.message || 'Could not submit the flag. Try again.';
        }
      } catch (error) {
        if (pending !== attempt || !options.current(selected)) return;
        // Keep the same request and comment when a write may have gone through.
        retry = payload;
        status.textContent = 'Submission was not confirmed. Retry to check this report.';
      } finally {
        root.clearTimeout(timer);
        if (pending === attempt) {
          pending = null;
          submit.disabled = cancel.disabled = false;
          comment.readOnly = !!retry;
          submit.textContent = retry ? 'Retry flag' : 'Submit flag';
        }
      }
    });

    reset();
    return { setQuestion, reset };
  }

  function embedded(host, { mode, feed, current, title }) {
    return create(host, {
      current: q => current(q) && feed()?.current(q),
      title,
      unavailable() {
        if (root.parent === root || !feed()?.context().studentKey) {
          return 'Open this game from your signed-in Learning Portal to submit a flag.';
        }
      },
      submit(payload, q, signal) {
        const identity = feed().context();
        return new Promise(function (resolve, reject) {
          function finish(result) {
            root.removeEventListener('message', receive);
            signal.removeEventListener('abort', abort);
            if (result) resolve(result);
            else reject(new Error('Flag not confirmed'));
          }
          function receive(event) {
            if (event.source !== root.parent || event.origin !== root.location.origin) return;
            const data = event.data;
            if (data?.type !== 'SD_FLAG_RESULT' || data.requestId !== payload.requestId ||
                data.questionId !== payload.questionId || data.studentKey !== identity.studentKey ||
                data.studentLevel !== identity.studentLevel) return;
            finish(data);
          }
          function abort() { finish(null); }
          root.addEventListener('message', receive);
          signal.addEventListener('abort', abort, { once: true });
          try {
            root.parent.postMessage({ type: 'SD_FLAG', mode, ...identity, ...payload }, root.location.origin);
          } catch (error) {
            finish(null);
          }
        });
      }
    });
  }

  root.GameQuestionFlag = { create, embedded };
})(window);
