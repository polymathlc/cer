// Embedded games receive one fresh, locally selected question from the portal.
// This bridge never calls an AI or substitutes an unclassified sample pool.
(function (root) {
  'use strict';
  root.ScienceFeedBridge = {
    create: function (options) {
      var pool = [], key = '', level = '', pending = null, sequence = 0, epoch = 0, active = null;
      var shown = new Map(), message = 'Open this game from the Science Learning Portal to receive suitable questions.';
      function settle(value) { if (pending) { clearTimeout(pending.timer); var resolve = pending.resolve; pending = null; resolve(value); } }
      function clear() { active = null; pool = []; if (options.onPool) options.onPool([]); }
      function receive(event) {
        if (!event || event.source !== root.parent || event.origin !== root.location.origin || root.parent === root) return;
        var data = event.data || {};
        if (data.type === 'SD_FEED_INVALIDATE') {
          epoch++; settle(false); clear(); key = String(data.studentKey || ''); level = String(data.studentLevel || '');
          if (options.onInvalidate) options.onInvalidate();
          return;
        }
        if (data.type !== 'SD_QUESTIONS' || data.feedPolicyVersion !== 1) return;
        if (pending && data.requestId !== pending.id) return;
        if (data.requestId && !pending) return;
        var nextKey = String(data.studentKey || ''), nextLevel = String(data.studentLevel || '');
        if (key && (key !== nextKey || level !== nextLevel)) return;
        key = nextKey; level = nextLevel;
        message = String(data.feedMessage || 'No suitable questions are ready. Continue another activity or return later.');
        pool = key && /^(?:P[3-6]|S1)$/.test(level) && Array.isArray(data.questions) ? data.questions.filter(function (q) {
          return q && q.id && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer)
            && q.answer >= 0 && q.answer < q.options.length && (String(q.q || '').trim() || String(q.html || '').trim());
        }) : [];
        if (options.onPool) options.onPool(pool);
        settle(true);
      }
      root.addEventListener('message', receive);
      return {
        refresh: function () {
          if (pending) return pending.promise;
          clear();
          if (root.parent === root) return Promise.resolve(false);
          var id = 'science-feed-' + (++sequence) + '-' + epoch;
          var resolve; var promise = new Promise(function (done) { resolve = done; });
          pending = { id: id, promise: promise, resolve: resolve, timer: setTimeout(function () { clear(); settle(false); }, 8000) };
          root.parent.postMessage({ type: 'SD_REQUEST_QUESTIONS', requestId: id }, root.location.origin);
          return promise;
        },
        take: function (predicate) {
          var now = Date.now();
          var q = pool.find(function (item) { return (!predicate || predicate(item)) && now - (shown.get(key + ':' + item.id) || 0) >= 900000; });
          pool = []; // Another question always asks the parent to re-evaluate.
          if (q) shown.set(key + ':' + q.id, now);
          return q || null;
        },
        current: function (question) { return !!question && question === active && question.__feedKey === key && question.__feedEpoch === epoch; },
        stamp: function (question) { active = question || null; if (question) { question.__feedKey = key; question.__feedEpoch = epoch; } return question; },
        fail: function (question, url) {
          if (!question || question !== active || question.__feedKey !== key || question.__feedEpoch !== epoch) return;
          root.parent.postMessage({type:'SD_IMAGE_FAILED',studentKey:key,studentLevel:level,questionId:question.id,url:String(url || '')},root.location.origin);
          epoch++; settle(false); clear(); message='This diagram could not load. The question has been set aside.';
          if(options.onInvalidate)options.onInvalidate();
        },
        message: function () { return message; },
        context: function () { return { studentKey: key, studentLevel: level }; }
      };
    }
  };
})(window);
