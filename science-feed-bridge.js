// Embedded games receive one fresh, locally selected question from the portal.
// This bridge never calls an AI or substitutes an unclassified sample pool.
(function (root) {
  'use strict';
  root.ScienceFeedBridge = {
    create: function (options) {
      var pool = [], key = '', level = '', pending = null, sequence = 0, epoch = 0, active = null;
      var shown = new Map(), message = 'Open this game from the Science Learning Portal to receive suitable questions.';
      var retryTimer = null, retryCount = 0;
      function cancelRetry() { if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; } }
      // Empty startup responses and temporary delivery failures recover without
      // requiring a new run or reload. The portal still owns every question,
      // grade/quality gate and endless-cycle decision.
      function retry(delay) {
        if (root.parent === root || pending || retryTimer !== null) return;
        // Students must never sit on a "connecting" screen: retry quickly
        // (0.5s, 1s, 2s, then every 3s) instead of backing off to 15 seconds.
        var wait = delay == null ? Math.min(3000, 500 * Math.pow(2, Math.min(retryCount++, 3))) : delay;
        // A retry only fetches; it never drops the question on screen, so an
        // answer given while a retry runs is still recorded.
        retryTimer = setTimeout(function () { retryTimer = null; request(); }, wait);
      }
      function settle(value) { if (pending) { clearTimeout(pending.timer); var resolve = pending.resolve; pending = null; resolve(value); } }
      function clear() { active = null; pool = []; if (options.onPool) options.onPool([]); }
      function receive(event) {
        if (!event || event.source !== root.parent || event.origin !== root.location.origin || root.parent === root) return;
        var data = event.data || {};
        if (data.type === 'SD_FEED_INVALIDATE') {
          epoch++; cancelRetry(); settle(false); key = String(data.studentKey || ''); level = String(data.studentLevel || '');
          retryCount = 0; message = 'Refreshing your class questions…'; clear();
          if (options.onInvalidate) options.onInvalidate();
          retry(250);
          return;
        }
        if (data.type !== 'SD_QUESTIONS' || data.feedPolicyVersion !== 1) return;
        if (pending && data.requestId !== pending.id) return;
        if (data.requestId && !pending) return;
        var nextKey = String(data.studentKey || ''), nextLevel = String(data.studentLevel || '');
        if (key && (key !== nextKey || level !== nextLevel)) return;
        key = nextKey; level = nextLevel;
        pool = key && /^(?:P[3-6]|S1)$/.test(level) && Array.isArray(data.questions) ? data.questions.filter(function (q) {
          return q && q.id && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer)
            && q.answer >= 0 && q.answer < q.options.length && (String(q.q || '').trim() || String(q.html || '').trim());
        }) : [];
        cancelRetry();
        if (pool.length) { retryCount = 0; message = 'Class questions ready. Questions refresh throughout your run.'; }
        else message = String(data.feedMessage || 'Your class questions are refreshing. Reconnecting automatically…');
        // Metadata consumers must share the exact response accepted by these guards.
        if (options.onPool) options.onPool(pool, event);
        settle(true);
        if (!pool.length) retry();
      }
      // Ask the portal for the next question WITHOUT clearing the question
      // that is on screen. Used by retries and by the look-ahead prefetch.
      function request() {
        if (pending) return pending.promise;
        cancelRetry();
        if (root.parent === root) return Promise.resolve(false);
        var id = 'science-feed-' + (++sequence) + '-' + epoch;
        var resolve; var promise = new Promise(function (done) { resolve = done; });
        pending = { id: id, promise: promise, resolve: resolve, timer: setTimeout(function () {
          message = 'Reconnecting to your class questions…'; settle(false); retry(0);
        }, 6000) };
        root.parent.postMessage({ type: 'SD_REQUEST_QUESTIONS', requestId: id }, root.location.origin);
        return promise;
      }
      // A fresh request: drops any held question first (the old behaviour,
      // still used to reload credits and after a learner change).
      function refresh() {
        if (pending) return pending.promise;
        cancelRetry();
        clear();
        return request();
      }
      // 🎮 Look-ahead (options.prefetch): as soon as a question is handed to
      // the game, the next one is fetched in the background, so the next
      // question opens instantly instead of waiting on the portal.
      function prefetch() {
        if (!options.prefetch || root.parent === root || pool.length || pending || retryTimer !== null) return;
        setTimeout(function () { if (!pool.length && !pending) request(); }, 0);
      }
      // Resolve straight away when a question is already waiting; otherwise
      // fetch one. Games call this right before they show a question.
      function ready() {
        if (pool.length) return Promise.resolve(true);
        return request();
      }
      root.addEventListener('message', receive);
      return {
        refresh: refresh,
        ready: ready,
        take: function (predicate) {
          var now = Date.now();
          // A question the portal RECYCLED (the arcade's endless cycle) is
          // due again by design, so the 15-minute repeat guard lets it through.
          var q = pool.find(function (item) { return (!predicate || predicate(item)) && (item.recycled === true || now - (shown.get(key + ':' + item.id) || 0) >= 900000); });
          pool = []; // Another question always asks the parent to re-evaluate.
          if (q) { shown.set(key + ':' + q.id, now); prefetch(); }
          else retry(0);
          return q || null;
        },
        current: function (question) { return !!question && question === active && question.__feedKey === key && question.__feedEpoch === epoch; },
        stamp: function (question) { active = question || null; if (question) { question.__feedKey = key; question.__feedEpoch = epoch; } return question; },
        fail: function (question, url) {
          if (!question || question !== active || question.__feedKey !== key || question.__feedEpoch !== epoch) return;
          root.parent.postMessage({type:'SD_IMAGE_FAILED',studentKey:key,studentLevel:level,questionId:question.id,url:String(url || '')},root.location.origin);
          epoch++; settle(false); clear(); message='This diagram could not load. The question has been set aside.';
          if(options.onInvalidate)options.onInvalidate();
          retry();
        },
        message: function () { return message; },
        context: function () { return { studentKey: key, studentLevel: level }; }
      };
    }
  };
})(window);
