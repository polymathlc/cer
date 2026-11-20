/*
  POLYMATH EMAIL SIGN-IN  (v1.0.0, November 2026)
  ===============================================
  One script that gives every Polymath student app the same three things,
  next to the "Sign in with Google" button it already has:

    • Create an account with an email address and a password
    • Sign in with that email and password
    • Forgot password → a reset link by email

  and makes sure a new email account confirms its address (a verification
  link by email) before it can ask the centre for access.

  It is loaded by the student access gate (access-gate.js, in this folder), so
  every app that already carries the gate gets it with no change of its own:
  Science, Math, Answer Keys, Study Buddy, English, Chinese, Rewards, the
  worksheets portal (/online), My Polymath (/student), Mind Map, Homework
  Helper, Mistake Notebook. A page may also load it directly:

      <script defer src="https://polymathlc.github.io/cer/student/email-sign-in.js"></script>

  HOW IT FINDS THE PAGE'S SIGN-IN
  All the apps share one Firebase project (mathgen--app), so one account works
  everywhere. The script never brings its own Firebase: it uses the page's own
  sign-in, either the compat SDK (window.firebase) or the modular SDK at the
  very same version the page imported (read from the page's loaded scripts),
  so the account it signs in is the page's account and the page reacts to it
  exactly as it does to a Google sign-in.

  WHERE THE BUTTON GOES
  It looks for the page's Google sign-in buttons (a button or link whose text,
  title or label says "… with Google") and puts a matching
  "✉️ Sign in with email" button right after each one. The button shows and
  hides together with the Google button, so it disappears once somebody is
  signed in. A page that already has its own email form switches this off:

      <meta name="polymath-email-sign-in" content="off">

  and may still open the dialog from its own buttons:
      PolymathEmailSignIn.open('signin' | 'create' | 'reset')

  ONE ACCOUNT PER EMAIL
  Firebase keeps one account per email address. A parent who joined with
  Google and now tries to "create an account" with the same address is told
  the address already has an account, and offered "Forgot password": the
  reset link adds a password to the SAME account (same approval, same
  subjects, same classes), so nothing is ever split in two.

  EMAIL VERIFICATION
  A new email account is sent a verification link at once. Until the link is
  opened, the access gate shows "Confirm your email address" instead of the
  enrolment form, so the centre is never asked to approve a mistyped or made-up
  address. Accounts the centre already approved are never asked; Google
  accounts are verified by Google; centre usernames (no inbox) are never asked.

  Tests: tools/email-sign-in-tests.mjs (logic) and tools/email-sign-in-browser.mjs
  (the dialog on a compat page and a modular page, in a real Chromium).
*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : this;
  if (root.PolymathEmailSignIn && root.PolymathEmailSignIn.version) return;   // loaded twice: the first one wins

  var VERSION = '1.0.0';
  var DEFAULT_SDK_VERSION = '11.10.0';
  var MIN_PASSWORD = 8;
  // Centre usernames are stored as username@this-domain. They have no inbox.
  var USERNAME_DOMAINS = ['students.sciencequest.app'];
  // Pages a verification / reset link may send people back to (Firebase must
  // list the domain under Authentication → Settings → Authorised domains; if
  // it does not, the email is sent without the "Continue" button instead).
  var RETURN_HOSTS = ['polymathlc.com.sg', 'www.polymathlc.com.sg', 'polymathlc.github.io', 'mathgen--app.web.app', 'mathgen--app.firebaseapp.com'];
  var WHATSAPP_NUMBER = '+65 9645 0588';
  var WHATSAPP_LINK = 'https://wa.me/6596450588';
  var SENT_PREFIX = 'polymath-verify-sent-v1:';
  var RESEND_GAP_MS = 60 * 1000;

  /* ================================================================== */
  /*  Pure logic (no DOM, no network) — exported as .core for the tests  */
  /* ================================================================== */

  function lower(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

  function cleanText(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }

  function isEmail(value) {
    var text = String(value == null ? '' : value).trim();
    return text.length >= 6 && text.length <= 200 && /^[^@\s"'<>,;:]+@[^@\s"'<>,;:]+\.[a-z]{2,}$/i.test(text);
  }

  /** True for the made-up address behind a centre username (no inbox to verify). */
  function isUsernameEmail(email) {
    var text = lower(email);
    for (var i = 0; i < USERNAME_DOMAINS.length; i++) {
      if (text.slice(-(USERNAME_DOMAINS[i].length + 1)) === '@' + USERNAME_DOMAINS[i]) return true;
    }
    return false;
  }

  /** Every sign-in method on the account: "password", "google.com", … */
  function providersOf(user) {
    var list = [];
    var data = user && Array.isArray(user.providerData) ? user.providerData : [];
    for (var i = 0; i < data.length; i++) {
      var id = data[i] && data[i].providerId;
      if (id && list.indexOf(id) < 0) list.push(id);
    }
    return list;
  }

  /**
   * Must this account confirm its email before it can ask for access?
   * Only a real email-and-password account whose address is not confirmed yet.
   * Never: signed out, a guest, Google (verified by Google), a centre username.
   */
  function needsVerification(user) {
    if (!user || !user.uid || user.isAnonymous) return false;
    if (user.emailVerified === true) return false;
    if (!user.email || isUsernameEmail(user.email)) return false;
    var providers = providersOf(user);
    if (!providers.length) return false;          // an unknown kind of account: never lock it out
    return providers.indexOf('password') >= 0;
  }

  /** What is wrong with a new password, or '' when it is fine. */
  function passwordProblem(password, confirm) {
    var text = String(password == null ? '' : password);
    if (!text) return 'Choose a password.';
    if (text.length < MIN_PASSWORD) return 'Use at least ' + MIN_PASSWORD + ' characters.';
    if (text.length > 128) return 'That password is too long (128 characters at most).';
    if (/^\s|\s$/.test(text)) return 'Please do not start or end the password with a space.';
    if (confirm !== undefined && confirm !== null && String(confirm) !== text) return 'The two passwords are not the same.';
    return '';
  }

  /** Checks one of the three forms. Returns { ok, errors: { field: message } }. */
  function validate(mode, values) {
    var v = values || {};
    var errors = {};
    var email = String(v.email == null ? '' : v.email).trim();
    if (!email) errors.email = 'Type your email address.';
    else if (!isEmail(email)) errors.email = 'That email address does not look right. Check it for typing mistakes.';
    else if (isUsernameEmail(email)) errors.email = 'This is a centre username. Use the username box on the page instead.';
    if (mode === 'create') {
      var name = cleanText(v.name, 80);
      if (name.length < 2) errors.name = 'Type your name (a parent\'s or the student\'s).';
      var problem = passwordProblem(v.password, v.confirm);
      if (problem) errors[problem.indexOf('same') >= 0 ? 'confirm' : 'password'] = problem;
    } else if (mode === 'signin') {
      if (!v.password) errors.password = 'Type your password.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  /**
   * A Firebase error → { message, field, offer } in plain words.
   * offer: 'signin' | 'reset' | 'create' — a button the dialog shows next to it.
   */
  function friendlyError(error, mode) {
    var code = String(error && error.code || '').replace(/^auth\//, '');
    switch (code) {
      case 'email-already-in-use':
        return { field: 'email', offer: 'reset', message: 'This email already has a Polymath account. Sign in with it instead. If you joined with Google, use the Google button — or tap "Set a password" and we will email you a link to add a password to the same account.' };
      case 'invalid-email':
      case 'missing-email':
        return { field: 'email', message: 'That email address does not look right. Check it for typing mistakes.' };
      case 'weak-password':
      case 'password-does-not-meet-requirements':
        return { field: 'password', message: 'Please choose a stronger password: at least ' + MIN_PASSWORD + ' characters, ideally with a number or two.' };
      case 'missing-password':
        return { field: 'password', message: 'Type your password.' };
      case 'wrong-password':
      case 'invalid-credential':
      case 'invalid-login-credentials':
      case 'invalid-password':
        return { field: 'password', offer: 'reset', message: 'The email or the password is not right. If you usually sign in with Google, use the Google button instead. Forgot the password? Tap "Reset my password".' };
      case 'user-not-found':
        return { field: 'email', offer: 'create', message: 'We could not find an account with this email. Check it for typing mistakes, or create a new account.' };
      case 'user-disabled':
        return { message: 'This account has been switched off. Please WhatsApp us on ' + WHATSAPP_NUMBER + '.' };
      case 'too-many-requests':
        return { message: 'Too many tries in a short time. Please wait a few minutes, then try again.' };
      case 'network-request-failed':
        return { message: 'We could not reach the internet. Check your connection, then try again.' };
      case 'operation-not-allowed':
      case 'admin-restricted-operation':
        return { message: 'Email sign-in is not switched on for this app yet. Please use Google for now, or WhatsApp us on ' + WHATSAPP_NUMBER + '.' };
      case 'popup-blocked':
      case 'web-storage-unsupported':
        return { message: 'This browser is blocking the sign-in. Please open the page in Chrome or Safari and try again.' };
      case 'quota-exceeded':
        return { message: 'We have sent a lot of emails today. Please try again in a little while, or WhatsApp us on ' + WHATSAPP_NUMBER + '.' };
      case 'requires-recent-login':
        return { message: 'For your safety, please sign out and sign in again, then try once more.' };
      default:
        return { message: (mode === 'reset' ? 'The reset email could not be sent' : 'That did not work') + (code ? ' (' + code + ')' : '') + '. Please try again, or WhatsApp us on ' + WHATSAPP_NUMBER + '.' };
    }
  }

  /** The address a verification / reset email sends people back to, or null. */
  function returnUrl(location) {
    if (!location || !/^https:$/.test(location.protocol || '')) return null;
    if (RETURN_HOSTS.indexOf(lower(location.hostname)) < 0) return null;
    var path = String(location.pathname || '/');
    var search = String(location.search || '').replace(/([?&])(mode|oobCode|apiKey|continueUrl|lang)=[^&]*/g, '$1').replace(/[?&]+$/, '');
    return location.protocol + '//' + location.hostname + path + (search && search !== '?' ? search : '');
  }

  /** Errors that mean "Firebase does not accept this return address" → send without one. */
  function isReturnUrlProblem(error) {
    var code = String(error && error.code || '');
    return /continue-uri|unauthorized-domain|invalid-dynamic-link-domain|argument-error/.test(code);
  }

  /** The modular SDK versions the page loaded (firebasejs/<version>/firebase-auth.js). */
  function sdkVersionsFrom(urls) {
    var found = [];
    (urls || []).forEach(function (url) {
      var match = /firebasejs\/(\d+\.\d+\.\d+)\/firebase-(auth|app)\.js/.exec(String(url || ''));
      if (match && found.indexOf(match[1]) < 0) found.push(match[1]);
    });
    return found;
  }

  /**
   * Is this element one of the page's Google sign-in buttons?
   * text: its visible text, title, aria-label joined together.
   */
  function looksLikeGoogleSignIn(text) {
    var t = lower(text).replace(/\s+/g, ' ');
    if (t.indexOf('google') < 0) return false;
    if (/sign ?out|log ?out|switch account|disconnect|unlink|google (drive|docs|classroom|meet|sheets|slides|forms|calendar|maps|translate)/.test(t)) return false;
    return /(sign|log) ?(in|up)|continue|join|start|use|login|register/.test(t);
  }

  /** May the remembered "verification sent at" time allow another send now? */
  function maySendAgain(sentAt, now) {
    var at = Number(sentAt) || 0;
    return !at || (Number(now) || 0) - at >= RESEND_GAP_MS;
  }

  var core = {
    version: VERSION,
    MIN_PASSWORD: MIN_PASSWORD,
    isEmail: isEmail,
    isUsernameEmail: isUsernameEmail,
    providersOf: providersOf,
    needsVerification: needsVerification,
    passwordProblem: passwordProblem,
    validate: validate,
    friendlyError: friendlyError,
    returnUrl: returnUrl,
    isReturnUrlProblem: isReturnUrlProblem,
    sdkVersionsFrom: sdkVersionsFrom,
    looksLikeGoogleSignIn: looksLikeGoogleSignIn,
    maySendAgain: maySendAgain
  };

  if (typeof document === 'undefined') {
    // Node (the tests): only the logic.
    root.PolymathEmailSignIn = { version: VERSION, core: core };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.PolymathEmailSignIn;
    return;
  }

  /* ================================================================== */
  /*  The page's sign-in (compat, or modular at the page's own version)   */
  /* ================================================================== */
  function compatAuth() {
    var fb = root.firebase;
    if (!fb || !fb.apps || !fb.apps.length || typeof fb.auth !== 'function') return null;
    var auth;
    try { auth = fb.auth(); } catch (error) { return null; }
    if (!auth || typeof auth.onAuthStateChanged !== 'function') return null;
    return {
      kind: 'compat',
      current: function () { return auth.currentUser; },
      listen: function (fn) { return auth.onAuthStateChanged(fn); },
      create: function (email, password) { return auth.createUserWithEmailAndPassword(email, password); },
      signIn: function (email, password) { return auth.signInWithEmailAndPassword(email, password); },
      reset: function (email, settings) { return settings ? auth.sendPasswordResetEmail(email, settings) : auth.sendPasswordResetEmail(email); },
      verify: function (user, settings) { return settings ? user.sendEmailVerification(settings) : user.sendEmailVerification(); },
      rename: function (user, name) { return user.updateProfile({ displayName: name }); },
      reload: function (user) { return user.reload(); },
      signOut: function () { return auth.signOut(); }
    };
  }

  var modular = { tried: {}, found: null };
  function pageSdkVersions() {
    var urls = [];
    try {
      var entries = root.performance && root.performance.getEntriesByType ? root.performance.getEntriesByType('resource') : [];
      for (var i = 0; i < entries.length; i++) urls.push(entries[i].name);
    } catch (error) { /* older browsers */ }
    try {
      var scripts = document.querySelectorAll('script');
      for (var j = 0; j < scripts.length; j++) {
        if (scripts[j].src) urls.push(scripts[j].src);
        else if (scripts[j].type === 'module') {
          var text = scripts[j].textContent || '';
          var re = /firebasejs\/\d+\.\d+\.\d+\/firebase-(?:auth|app)\.js/g, m;
          while ((m = re.exec(text))) urls.push(m[0]);
        }
      }
    } catch (error) { /* nothing to read */ }
    var versions = sdkVersionsFrom(urls);
    if (versions.indexOf(DEFAULT_SDK_VERSION) < 0) versions.push(DEFAULT_SDK_VERSION);
    return versions;
  }

  function tryModular(version) {
    if (modular.tried[version]) return modular.tried[version];
    var base = 'https://www.gstatic.com/firebasejs/' + version + '/';
    modular.tried[version] = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js')]).then(function (mods) {
      return { app: mods[0], auth: mods[1] };
    }, function () { return null; });
    return modular.tried[version];
  }

  function modularFrom(mods) {
    if (!mods || !mods.app || !mods.auth) return null;
    var apps = [];
    try { apps = mods.app.getApps(); } catch (error) { return null; }
    var app = null;
    for (var i = 0; i < apps.length; i++) if (apps[i].name === '[DEFAULT]') app = apps[i];
    if (!app) return null;
    var A = mods.auth, auth;
    try { auth = A.getAuth(app); } catch (error) { return null; }
    if (!auth) return null;
    return {
      kind: 'modular',
      current: function () { return auth.currentUser; },
      listen: function (fn) { return A.onAuthStateChanged(auth, fn); },
      create: function (email, password) { return A.createUserWithEmailAndPassword(auth, email, password); },
      signIn: function (email, password) { return A.signInWithEmailAndPassword(auth, email, password); },
      reset: function (email, settings) { return settings ? A.sendPasswordResetEmail(auth, email, settings) : A.sendPasswordResetEmail(auth, email); },
      verify: function (user, settings) { return settings ? A.sendEmailVerification(user, settings) : A.sendEmailVerification(user); },
      rename: function (user, name) { return A.updateProfile(user, { displayName: name }); },
      reload: function (user) { return A.reload(user); },
      signOut: function () { return A.signOut(auth); }
    };
  }

  var adapter = null, adapterWaiters = [], findingAuth = false;
  /** Resolves with the page's sign-in once there is one (polls; never rejects). */
  function whenAuth() {
    if (adapter) return Promise.resolve(adapter);
    return new Promise(function (resolve) {
      adapterWaiters.push(resolve);
      if (findingAuth) return;
      findingAuth = true;
      var tries = 0;
      (function poll() {
        tries++;
        var found = compatAuth();
        var done = function (value) {
          if (!value || adapter) return;
          adapter = value;
          var waiting = adapterWaiters.splice(0);
          waiting.forEach(function (fn) { fn(value); });
          try { value.listen(onUser); } catch (error) { /* nothing to follow */ }
        };
        if (found) return done(found);
        var versions = tries >= 2 ? pageSdkVersions() : [];
        Promise.all(versions.map(tryModular)).then(function (list) {
          if (adapter) return;
          for (var i = 0; i < list.length; i++) {
            var m = modularFrom(list[i]);
            if (m) return done(m);
          }
          if (tries < 400) root.setTimeout(poll, tries < 40 ? 250 : 1000);
        });
      })();
    });
  }

  var currentUser = null;
  function onUser(user) {
    currentUser = user || null;
    syncButtons();
    if (user && !user.isAnonymous && dialog.open && dialog.mode !== 'verify' && dialog.mode !== 'sent') {
      // Signed in (by us, or by Google in another tab): the dialog has done its job.
      if (!needsVerification(user)) closeDialog();
    }
  }

  function signedIn() { return !!(currentUser && !currentUser.isAnonymous); }

  /* ================================================================== */
  /*  Verification email (shared with the access gate)                    */
  /* ================================================================== */
  function storage() { try { return root.localStorage; } catch (error) { return null; } }
  function sentAt(uid) { var s = storage(); try { return s ? Number(s.getItem(SENT_PREFIX + uid)) || 0 : 0; } catch (error) { return 0; } }
  function rememberSent(uid) { var s = storage(); try { if (s) s.setItem(SENT_PREFIX + uid, String(Date.now())); } catch (error) { /* private mode */ } }

  function actionSettings() {
    var url = returnUrl(root.location);
    return url ? { url: url } : null;
  }

  /** Sends the verification link to the signed-in account. Resolves true / rejects with the Firebase error. */
  function sendVerification(user, force) {
    return whenAuth().then(function (a) {
      var who = user || a.current();
      if (!who) throw { code: 'auth/no-current-user' };
      if (!force && !maySendAgain(sentAt(who.uid), Date.now())) return false;
      var settings = actionSettings();
      return Promise.resolve(a.verify(who, settings)).catch(function (error) {
        if (settings && isReturnUrlProblem(error)) return a.verify(who, null);
        throw error;
      }).then(function () { rememberSent(who.uid); return true; });
    });
  }

  /** Re-reads the account from Firebase. Resolves with true once its email is confirmed. */
  function refreshVerified(user) {
    return whenAuth().then(function (a) {
      var who = user || a.current();
      if (!who) return false;
      return Promise.resolve(a.reload(who)).then(function () {
        var fresh = a.current() || who;
        if (fresh.emailVerified && typeof fresh.getIdToken === 'function') {
          // A new ID token carries email_verified: true for the rest of the session.
          return Promise.resolve(fresh.getIdToken(true)).then(function () { return true; }, function () { return true; });
        }
        return !!fresh.emailVerified;
      });
    });
  }

  function sendReset(email) {
    return whenAuth().then(function (a) {
      var settings = actionSettings();
      return Promise.resolve(a.reset(email, settings)).catch(function (error) {
        if (settings && isReturnUrlProblem(error)) return a.reset(email, null);
        throw error;
      });
    });
  }

  /* ================================================================== */
  /*  The dialog (its own shadow root: no app's CSS can reach it)         */
  /* ================================================================== */
  var dialog = { open: false, mode: 'signin', busy: false, values: { name: '', email: '', password: '', confirm: '' }, errors: {}, banner: null, note: '', show: false };
  var host = null, shadow = null, lastFocus = null, savedOverflow = null;

  var STYLE = [
    ':host{all:initial}',
    '.veil{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;',
    '  padding:max(16px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom));box-sizing:border-box;',
    "  background:rgba(26,26,26,0.55);font-family:'Century Gothic',CenturyGothic,AppleGothic,'Segoe UI',Roboto,Arial,sans-serif;",
    '  color:#1A1A1A;-webkit-font-smoothing:antialiased;line-height:1.5;font-size:16px}',
    '.veil.enter{animation:fade .2s ease}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '*{box-sizing:border-box}',
    '.card{position:relative;width:100%;max-width:440px;margin:6vh auto 24px;background:#FFFFFF;border:1px solid #E8E8E4;border-radius:22px;',
    '  box-shadow:0 4px 6px rgba(0,0,0,0.05),0 18px 40px rgba(0,0,0,0.18);padding:26px 22px 22px}',
    '.enter .card{animation:rise .35s cubic-bezier(.34,1.56,.64,1)}',
    '@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.card,.veil{animation:none}}',
    '.close{position:absolute;top:10px;right:10px;width:40px;height:40px;border-radius:50%;border:0;background:transparent;color:#5C5C5C;font-size:22px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0;min-height:0}',
    '.close:hover{background:#F2F2EF;color:#1A1A1A}',
    '.brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}',
    '.mark{width:40px;height:40px;border-radius:12px;background:#2E8B6B;color:#FFFFFF;display:grid;place-items:center;font-weight:700;font-size:20px;flex:none}',
    '.brand b{display:block;font-size:15px}.brand span{display:block;font-size:13px;color:#5C5C5C}',
    'h1{font-size:22px;line-height:1.25;margin:0 0 6px;letter-spacing:-0.01em}',
    'p{margin:0 0 12px;color:#3D3D3D}',
    '.muted{color:#5C5C5C;font-size:14px}',
    '.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#F2F2EF;border-radius:999px;padding:4px;margin:4px 0 14px}',
    '.tab{border:0;background:transparent;border-radius:999px;padding:9px 10px;font:inherit;font-weight:700;font-size:14px;color:#5C5C5C;cursor:pointer;min-height:40px}',
    '.tab[aria-selected=true]{background:#FFFFFF;color:#0B6B4F;box-shadow:0 1px 3px rgba(0,0,0,0.12)}',
    'label.field{display:block;margin:12px 0 0;font-weight:600;font-size:15px}',
    '.hint{display:block;font-weight:400;font-size:13px;color:#5C5C5C;margin-top:2px}',
    '.pw{position:relative;margin-top:6px}',
    'input{display:block;width:100%;margin-top:6px;padding:11px 12px;border:1.5px solid #D4D4CF;border-radius:10px;font:inherit;font-weight:400;color:#1A1A1A;background:#FFFFFF;min-height:46px}',
    '.pw input{margin-top:0;padding-right:72px}',
    'input:focus{outline:none;border-color:#2E8B6B;box-shadow:0 0 0 3px #DCEFE7}',
    'input[aria-invalid=true]{border-color:#B3261E}',
    '.peek{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:#F2F2EF;border-radius:999px;padding:6px 10px;font:inherit;font-size:13px;font-weight:700;color:#3D3D3D;cursor:pointer;min-height:0}',
    '.error{color:#B3261E;font-size:14px;margin-top:6px}',
    '.banner{border-radius:12px;padding:10px 12px;margin-top:14px;font-size:14px}',
    '.banner.bad{background:#FDECEA;color:#8C1D18}',
    '.banner.good{background:#F1F8F5;color:#0B6B4F;border:1px solid #DCEFE7}',
    '.banner .inline{margin-top:8px}',
    '.actions{display:flex;flex-direction:column;gap:10px;margin-top:18px}',
    'button.primary,button.ghost,a.button{font:inherit;font-weight:700;border-radius:999px;padding:12px 20px;border:1.5px solid transparent;cursor:pointer;',
    '  text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;width:100%}',
    '.primary{background:#2E8B6B;color:#FFFFFF}.primary:hover{background:#0B6B4F}',
    '.primary[disabled]{opacity:.6;cursor:progress}',
    '.ghost{background:#FFFFFF;color:#1A1A1A;border-color:#D4D4CF}.ghost:hover{border-color:#2E8B6B}',
    '.small{font-size:14px;min-height:40px;padding:8px 14px;width:auto;display:inline-flex}',
    '.links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 14px;margin-top:14px;font-size:14px}',
    '.link{background:none;border:0;padding:6px 2px;color:#0B6B4F;text-decoration:underline;font:inherit;font-size:14px;cursor:pointer;min-height:0}',
    '.who{display:inline-block;background:#F1F8F5;color:#0B6B4F;border-radius:999px;padding:2px 10px;font-size:14px;word-break:break-all}',
    '.big{font-size:44px;line-height:1;margin:4px 0 10px}',
    '.steps{margin:6px 0 12px;padding-left:20px;color:#3D3D3D}',
    '.steps li{margin:4px 0}',
    '.help{margin-top:16px;font-size:13px;color:#5C5C5C}',
    '.help a{color:#0B6B4F}',
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
  ].join('\n');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'polymath-email-sign-in';
    host.setAttribute('data-version', VERSION);
    shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    shadow.addEventListener('click', onClick);
    shadow.addEventListener('submit', function (event) { event.preventDefault(); submit(); });
    shadow.addEventListener('input', readForm);
    shadow.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !dialog.busy) { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') trapFocus(event);
    });
  }

  function trapFocus(event) {
    var items = shadow.querySelectorAll('button:not([disabled]),input,a[href]');
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], active = shadow.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  function brand() {
    return '<div class="brand"><div class="mark" aria-hidden="true">P</div><div><b>Polymath Learning Centre</b><span>One account for every Polymath app</span></div></div>';
  }

  function err(key) {
    var text = dialog.errors && dialog.errors[key];
    return text ? '<div class="error" id="pe-' + key + '-error" role="alert">' + escapeHtml(text) + '</div>' : '';
  }

  function input(name, type, label, attrs, hint) {
    var bad = dialog.errors && dialog.errors[name];
    var value = dialog.values[name] || '';
    var describe = bad ? ' aria-describedby="pe-' + name + '-error" aria-invalid="true"' : '';
    if (type === 'password') {
      return '<label class="field">' + escapeHtml(label) + (hint ? '<span class="hint">' + escapeHtml(hint) + '</span>' : '') +
        '<div class="pw"><input name="' + name + '" type="' + (dialog.show ? 'text' : 'password') + '" value="' + escapeHtml(value) + '" ' + (attrs || '') + describe + '>' +
        '<button type="button" class="peek" data-action="peek" aria-label="' + (dialog.show ? 'Hide' : 'Show') + ' password">' + (dialog.show ? 'Hide' : 'Show') + '</button></div>' +
        err(name) + '</label>';
    }
    return '<label class="field">' + escapeHtml(label) + (hint ? '<span class="hint">' + escapeHtml(hint) + '</span>' : '') +
      '<input name="' + name + '" type="' + type + '" value="' + escapeHtml(value) + '" ' + (attrs || '') + describe + '>' + err(name) + '</label>';
  }

  function bannerHtml() {
    var b = dialog.banner;
    if (!b) return '';
    var offer = '';
    if (b.offer === 'reset') offer = '<div class="inline"><button type="button" class="ghost small" data-action="go-reset">' + (dialog.mode === 'create' ? 'Set a password' : 'Reset my password') + '</button></div>';
    if (b.offer === 'signin') offer = '<div class="inline"><button type="button" class="ghost small" data-action="go-signin">Sign in instead</button></div>';
    if (b.offer === 'create') offer = '<div class="inline"><button type="button" class="ghost small" data-action="go-create">Create an account</button></div>';
    return '<div class="banner ' + (b.good ? 'good' : 'bad') + '" role="' + (b.good ? 'status' : 'alert') + '">' + escapeHtml(b.message) + offer + '</div>';
  }

  function tabs() {
    return '<div class="tabs" role="tablist">' +
      '<button type="button" class="tab" role="tab" data-action="go-signin" aria-selected="' + (dialog.mode === 'signin') + '">Sign in</button>' +
      '<button type="button" class="tab" role="tab" data-action="go-create" aria-selected="' + (dialog.mode === 'create') + '">Create account</button>' +
      '</div>';
  }

  function helpLine() {
    return '<p class="help">Need a hand? WhatsApp us on <a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">' + WHATSAPP_NUMBER + '</a>.</p>';
  }

  function signInHtml() {
    return brand() + '<h1 id="pe-title">Sign in with email</h1>' +
      '<p class="muted">Use the email and password of your Polymath account. The same account works in every Polymath app.</p>' + tabs() +
      '<form novalidate>' +
      input('email', 'email', 'Email', 'autocomplete="email" inputmode="email" maxlength="200" autocapitalize="off" spellcheck="false"') +
      input('password', 'password', 'Password', 'autocomplete="current-password" maxlength="128"') +
      bannerHtml() +
      '<div class="actions"><button type="submit" class="primary"' + (dialog.busy ? ' disabled' : '') + '>' + (dialog.busy ? 'Signing in…' : 'Sign in') + '</button></div>' +
      '<div class="links"><button type="button" class="link" data-action="go-reset">Forgot your password?</button>' +
      '<button type="button" class="link" data-action="go-create">New here? Create an account</button></div>' +
      '</form>' + helpLine();
  }

  function createHtml() {
    return brand() + '<h1 id="pe-title">Create your Polymath account</h1>' +
      '<p class="muted">Sign up with any email address. We will email you a link to confirm it.</p>' + tabs() +
      '<form novalidate>' +
      input('name', 'text', 'Your name', 'autocomplete="name" maxlength="80"', 'A parent\'s or the student\'s name') +
      input('email', 'email', 'Email', 'autocomplete="email" inputmode="email" maxlength="200" autocapitalize="off" spellcheck="false"') +
      input('password', 'password', 'Choose a password', 'autocomplete="new-password" maxlength="128"', 'At least ' + MIN_PASSWORD + ' characters') +
      input('confirm', 'password', 'Type the password again', 'autocomplete="new-password" maxlength="128"') +
      bannerHtml() +
      '<div class="actions"><button type="submit" class="primary"' + (dialog.busy ? ' disabled' : '') + '>' + (dialog.busy ? 'Creating your account…' : 'Create account') + '</button></div>' +
      '<div class="links"><button type="button" class="link" data-action="go-signin">Already have an account? Sign in</button></div>' +
      '</form>' + helpLine();
  }

  function resetHtml() {
    return brand() + '<h1 id="pe-title">Reset your password</h1>' +
      '<p class="muted">Type the email of your Polymath account. We will email you a link to choose a new password.</p>' +
      '<form novalidate>' +
      input('email', 'email', 'Email', 'autocomplete="email" inputmode="email" maxlength="200" autocapitalize="off" spellcheck="false"') +
      bannerHtml() +
      '<div class="actions"><button type="submit" class="primary"' + (dialog.busy ? ' disabled' : '') + '>' + (dialog.busy ? 'Sending…' : 'Email me a reset link') + '</button></div>' +
      '<div class="links"><button type="button" class="link" data-action="go-signin">Back to sign in</button></div>' +
      '<p class="help">Joined with Google? This link adds a password to the same account, so you can sign in either way. Centre usernames have no inbox: ask your teacher to reset those.</p>' +
      '</form>';
  }

  function sentHtml() {
    return brand() + '<div class="big" aria-hidden="true">📬</div><h1 id="pe-title">Check your inbox</h1>' +
      '<p>We have sent a link to <span class="who">' + escapeHtml(dialog.values.email) + '</span>.</p>' +
      '<ol class="steps"><li>Open the email from Polymath (look in Spam or Promotions too).</li><li>Tap the link and choose a new password.</li><li>Come back here and sign in with it.</li></ol>' +
      '<p class="muted">The link works for one hour. No email after a few minutes? Check the address for typing mistakes and send it again.</p>' +
      '<div class="actions"><button type="button" class="primary" data-action="go-signin">Back to sign in</button>' +
      '<button type="button" class="ghost" data-action="go-reset">Send it again</button></div>' + helpLine();
  }

  function verifyHtml() {
    var email = currentUser && currentUser.email ? currentUser.email : dialog.values.email;
    return brand() + '<div class="big" aria-hidden="true">✉️</div><h1 id="pe-title">Confirm your email address</h1>' +
      '<p>Welcome! We have sent a link to <span class="who">' + escapeHtml(email) + '</span>. Open it to confirm this is your email.</p>' +
      '<ol class="steps"><li>Open the email from Polymath (look in Spam or Promotions too).</li><li>Tap the link in it.</li><li>Come back to this page: it carries on by itself.</li></ol>' +
      bannerHtml() +
      '<div class="actions"><button type="button" class="primary" data-action="verified"' + (dialog.busy ? ' disabled' : '') + '>' + (dialog.busy ? 'Checking…' : 'I have opened the link') + '</button>' +
      '<button type="button" class="ghost" data-action="resend">Send the email again</button></div>' +
      '<div class="links"><button type="button" class="link" data-action="sign-out">Wrong email? Sign out and start again</button></div>' + helpLine();
  }

  function render() {
    if (!dialog.open) return;
    ensureHost();
    // Inside a page's own modal <dialog> (a sign-in pop-up), only things inside
    // that dialog can be seen or tapped: open over it from inside it.
    var modal = null;
    try { modal = lastFocus && lastFocus.closest ? lastFocus.closest('dialog[open]') : null; } catch (error) { modal = null; }
    if (!modal) {
      try { var open = document.querySelector('dialog[open]'); if (open && open.matches(':modal')) modal = open; } catch (error) { modal = null; }
    }
    var mount = modal && modal.isConnected ? modal : document.documentElement;
    if (host.parentNode !== mount) mount.appendChild(host);
    var body = dialog.mode === 'create' ? createHtml()
      : dialog.mode === 'reset' ? resetHtml()
      : dialog.mode === 'sent' ? sentHtml()
      : dialog.mode === 'verify' ? verifyHtml()
      : signInHtml();
    var active = shadow.activeElement, focusName = active && active.name ? active.name : null;
    var caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    // Animate only when the dialog first opens, never on a re-render while typing.
    var enter = !dialog.entered;
    dialog.entered = true;
    shadow.innerHTML = '<style>' + STYLE + '</style><div class="veil' + (enter ? ' enter' : '') + '" data-action="backdrop"><div class="card" role="dialog" aria-modal="true" aria-labelledby="pe-title">' +
      '<button type="button" class="close" data-action="close" aria-label="Close">×</button>' + body + '</div></div>';
    if (focusName) {
      var again = shadow.querySelector('[name="' + focusName + '"]');
      if (again) {
        try { again.focus({ preventScroll: true }); } catch (error) { again.focus(); }
        if (caret !== null && again.setSelectionRange) { try { again.setSelectionRange(caret, caret); } catch (error) { /* email inputs */ } }
      }
    }
  }

  function focusFirst() {
    if (!shadow) return;
    var target = shadow.querySelector('[aria-invalid=true]') || shadow.querySelector('input') || shadow.querySelector('.primary');
    if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (error) { target.focus(); } }
  }

  function readForm() {
    if (!shadow) return;
    ['name', 'email', 'password', 'confirm'].forEach(function (name) {
      var el = shadow.querySelector('[name="' + name + '"]');
      if (el) dialog.values[name] = el.value;
    });
  }

  function setMode(mode, keepBanner) {
    readForm();
    dialog.mode = mode;
    dialog.errors = {};
    if (!keepBanner) dialog.banner = null;
    if (mode !== 'create') dialog.values.confirm = '';
    render();
    focusFirst();
  }

  function openDialog(mode, options) {
    var opts = options || {};
    if (opts.email) dialog.values.email = String(opts.email);
    dialog.open = true;
    dialog.entered = false;
    dialog.busy = false;
    dialog.errors = {};
    dialog.banner = null;
    dialog.mode = mode === 'create' || mode === 'reset' || mode === 'verify' ? mode : 'signin';
    lastFocus = document.activeElement;
    if (savedOverflow === null) { savedOverflow = document.documentElement.style.overflow || ''; document.documentElement.style.overflow = 'hidden'; }
    render();
    focusFirst();
    whenAuth();   // start looking for the page's sign-in now
  }

  function closeDialog() {
    dialog.open = false;
    dialog.busy = false;
    dialog.values.password = '';
    dialog.values.confirm = '';
    stopVerifyPoll();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (savedOverflow !== null) { document.documentElement.style.overflow = savedOverflow; savedOverflow = null; }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (error) { /* gone */ } }
  }

  function fail(error, mode) {
    var nice = friendlyError(error, mode);
    dialog.busy = false;
    dialog.errors = {};
    dialog.banner = { message: nice.message, offer: nice.offer };
    render();
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = root.setTimeout(function () { reject({ code: 'auth/network-request-failed' }); }, ms);
      Promise.resolve(promise).then(function (v) { root.clearTimeout(timer); resolve(v); }, function (e) { root.clearTimeout(timer); reject(e); });
    });
  }

  function submit() {
    if (dialog.busy) return;
    readForm();
    var mode = dialog.mode;
    if (mode === 'verify') return checkVerified();
    var check = validate(mode, dialog.values);
    if (!check.ok) { dialog.errors = check.errors; dialog.banner = null; render(); focusFirst(); return; }
    var email = dialog.values.email.trim();
    dialog.busy = true;
    dialog.errors = {};
    dialog.banner = null;
    render();
    withTimeout(whenAuth(), 20000).then(function (a) {
      if (mode === 'signin') {
        return a.signIn(email, dialog.values.password).then(function (cred) {
          dialog.busy = false;
          var user = (cred && cred.user) || a.current();
          if (needsVerification(user) && !root.PolymathAccess) {
            // No access gate on this page: the dialog itself asks for the email.
            currentUser = user;
            sendVerification(user, false).catch(function () { /* they can press "Send again" */ });
            setMode('verify');
            startVerifyPoll();
          } else closeDialog();
        });
      }
      if (mode === 'create') {
        var name = cleanText(dialog.values.name, 80);
        return a.create(email, dialog.values.password).then(function (cred) {
          var user = (cred && cred.user) || a.current();
          currentUser = user;
          var gate = !!(root.PolymathAccess && root.PolymathAccess.version);
          return Promise.resolve(user && name ? a.rename(user, name) : null).catch(function () { /* the name is a nicety */ })
            // With the access gate on the page, the gate sends the link itself (once)
            // and shows "Confirm your email" over the whole app.
            .then(function () { return gate ? null : sendVerification(user, true).catch(function () { return false; }); })
            .then(function (sent) {
              dialog.busy = false;
              if (gate) {
                closeDialog();
              } else {
                dialog.banner = sent === false ? { message: 'Your account is ready, but the email could not be sent just now. Press "Send the email again".' } : null;
                setMode('verify', true);
                startVerifyPoll();
              }
            });
        });
      }
      if (mode === 'reset') {
        return sendReset(email).then(function () { dialog.busy = false; setMode('sent'); });
      }
    }).catch(function (error) { fail(error, mode); });
  }

  /* ---------------- "Confirm your email" inside the dialog (pages without the gate) ---------------- */
  var verifyTimer = null;
  function startVerifyPoll() {
    stopVerifyPoll();
    verifyTimer = root.setInterval(function () {
      if (!dialog.open || dialog.mode !== 'verify') return stopVerifyPoll();
      if (document.visibilityState === 'hidden') return;
      refreshVerified().then(function (ok) { if (ok) verifiedDone(); }, function () { /* try again next time */ });
    }, 5000);
  }
  function stopVerifyPoll() { if (verifyTimer) { root.clearInterval(verifyTimer); verifyTimer = null; } }

  function verifiedDone() {
    stopVerifyPoll();
    closeDialog();
    toast('✅ Email confirmed. Welcome to Polymath!');
  }

  function checkVerified() {
    if (dialog.busy) return;
    dialog.busy = true;
    render();
    refreshVerified().then(function (ok) {
      dialog.busy = false;
      if (ok) return verifiedDone();
      dialog.banner = { message: 'We cannot see the confirmation yet. Open the link in the email first, then press this button again.' };
      render();
    }, function (error) { fail(error, 'verify'); });
  }

  function resend() {
    sendVerification(null, true).then(function () {
      dialog.banner = { good: true, message: 'Sent again. It can take a minute or two to arrive. Look in Spam or Promotions too.' };
      render();
    }, function (error) { fail(error, 'verify'); });
  }

  function onClick(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'backdrop') {
      if (event.target === target && !dialog.busy && dialog.mode !== 'verify') closeDialog();
      return;
    }
    if (dialog.busy && action !== 'close') return;
    if (action === 'close') { if (!dialog.busy) closeDialog(); }
    else if (action === 'go-signin') setMode('signin');
    else if (action === 'go-create') setMode('create');
    else if (action === 'go-reset') setMode('reset');
    else if (action === 'peek') { readForm(); dialog.show = !dialog.show; render(); }
    else if (action === 'verified') checkVerified();
    else if (action === 'resend') resend();
    else if (action === 'sign-out') {
      whenAuth().then(function (a) { return a.signOut(); }).then(function () { setMode('create'); }, function () { closeDialog(); });
    }
  }

  var toastEl = null;
  function toast(text) {
    try {
      if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      toastEl.textContent = text;
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;background:#0B6B4F;color:#fff;' +
        "font:600 15px/1.4 'Century Gothic','Segoe UI',Roboto,Arial,sans-serif;padding:12px 18px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:calc(100% - 32px);text-align:center";
      document.documentElement.appendChild(toastEl);
      var mine = toastEl;
      root.setTimeout(function () { if (mine.parentNode) mine.parentNode.removeChild(mine); }, 5000);
    } catch (error) { /* no toast */ }
  }

  /* ================================================================== */
  /*  The "✉️ Sign in with email" button next to each Google button        */
  /* ================================================================== */
  var pairs = [];   // { google: Element, host: Element }
  var BUTTON_STYLE = [
    ':host{all:initial;display:inline-block;vertical-align:middle}',
    ':host([data-block]){display:block}',
    'button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;',
    "  font-family:'Century Gothic',CenturyGothic,AppleGothic,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;font-size:15px;line-height:1.2;",
    '  color:#1A1A1A;background:#FFFFFF;border:1.5px solid #D4D4CF;border-radius:999px;padding:10px 18px;min-height:44px;white-space:nowrap;',
    '  transition:border-color .15s ease,box-shadow .15s ease}',
    ':host([data-block]) button{display:flex;width:100%}',
    ':host([data-compact]) button{font-size:13px;padding:4px 12px;min-height:var(--pe-height,34px);height:var(--pe-height,34px)}',
    'button:hover{border-color:#2E8B6B;box-shadow:0 2px 8px rgba(46,139,107,.15)}',
    '.short{display:none}:host([data-short]) .long{display:none}:host([data-short]) .short{display:inline}',
    'button:focus-visible{outline:none;box-shadow:0 0 0 3px #DCEFE7;border-color:#2E8B6B}'
  ].join('\n');

  function autoAttachOff() {
    try {
      var meta = document.querySelector('meta[name="polymath-email-sign-in"]');
      if (meta && lower(meta.getAttribute('content')) === 'off') return true;
    } catch (error) { /* no DOM */ }
    return !!(ownScript && lower(ownScript.getAttribute('data-auto')) === 'off');
  }

  function labelOf(el) {
    return [el.textContent || '', el.getAttribute('title') || '', el.getAttribute('aria-label') || '', el.value || ''].join(' ');
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (!el.getClientRects || !el.getClientRects().length) return false;
    var style = root.getComputedStyle ? root.getComputedStyle(el) : null;
    return !(style && (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0));
  }

  function makeCompanion(google) {
    var holder = document.createElement('polymath-email-button');
    holder.setAttribute('data-polymath-email', VERSION);
    var inner = holder.attachShadow ? holder.attachShadow({ mode: 'open' }) : holder;
    inner.innerHTML = '<style>' + BUTTON_STYLE + '</style><button type="button" part="button"><span aria-hidden="true">✉️</span><span class="long">Sign in with email</span><span class="short">Email</span></button>';
    var button = inner.querySelector('button');
    button.setAttribute('aria-label', 'Sign in with email');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openDialog('signin');
    });
    return holder;
  }

  function findGoogleButtons() {
    var out = [];
    var list = document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && el.closest('polymath-email-button,#polymath-email-sign-in,#polymath-access-gate,[data-polymath-email-skip]')) continue;
      // The innermost clickable element only (a link inside a button counts once).
      if (el.parentElement && el.parentElement.closest && el.parentElement.closest('button,a,[role="button"]')) continue;
      if (looksLikeGoogleSignIn(labelOf(el))) out.push(el);
    }
    return out;
  }

  function scan() {
    if (autoAttachOff()) return;
    pairs = pairs.filter(function (pair) {
      if (pair.google.isConnected) return true;
      if (pair.host.parentNode) pair.host.parentNode.removeChild(pair.host);
      return false;
    });
    findGoogleButtons().forEach(function (google) {
      for (var i = 0; i < pairs.length; i++) if (pairs[i].google === google) return;
      if (!google.parentNode) return;
      var holder = makeCompanion(google);
      google.parentNode.insertBefore(holder, google.nextSibling);
      pairs.push({ google: google, host: holder });
    });
    syncButtons();
  }

  /**
   * Look like a sibling of the Google button: full width under a wide one (a
   * sign-in card), a pill of the same height beside a small one (a header).
   * Measured again whenever the Google button's size changes.
   */
  function layoutCompanion(pair) {
    var google = pair.google, holder = pair.host;
    var rect = google.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var parent = google.parentElement;
    var parentRect = parent ? parent.getBoundingClientRect() : null;
    var key = Math.round(rect.width) + 'x' + Math.round(rect.height) + '/' + (parentRect ? Math.round(parentRect.width) : 0) + '/' + (root.innerWidth || 0);
    if (pair.layout === key) return;
    pair.layout = key;
    var style = root.getComputedStyle ? root.getComputedStyle(google) : {};
    var parentStyle = parent && root.getComputedStyle ? root.getComputedStyle(parent) : {};
    // A row of buttons (a header) is never "wide", even when Google is its only child.
    var rowParent = /flex/.test(parentStyle.display || '') && !/column/.test(parentStyle.flexDirection || '');
    var wide = !!(parentRect && parentRect.width > 0 && rect.width >= parentRect.width * 0.7 && rect.width >= 180 &&
      !rowParent && !/^inline/.test(parentStyle.display || ''));
    holder.removeAttribute('data-block');
    holder.removeAttribute('data-compact');
    holder.removeAttribute('data-short');
    holder.style.cssText = '';
    if (wide) {
      holder.setAttribute('data-block', '');
      holder.style.marginTop = '10px';
      holder.style.width = Math.round(rect.width) + 'px';
      holder.style.maxWidth = '100%';
      holder.style.marginLeft = style.marginLeft || '';
      holder.style.marginRight = style.marginRight || '';
    } else {
      holder.style.flex = '0 0 auto';
      // Beside it when it sits in a row; under it when the parent stacks its children.
      var column = parentStyle.display && /flex/.test(parentStyle.display) && /column/.test(parentStyle.flexDirection || '');
      var blockLevel = !/inline|table-cell/.test(style.display || '') && !/flex|grid/.test(parentStyle.display || '');
      if (column || blockLevel) holder.style.marginTop = '10px';
      else holder.style.marginLeft = '8px';
      // A small screen with the Google button in a crowded row (a header): say just "✉️ Email".
      if ((root.innerWidth || 1024) < 640 && !column && !blockLevel) holder.setAttribute('data-short', '');
      if (rect.height < 40) {
        holder.setAttribute('data-compact', '');
        holder.style.setProperty('--pe-height', Math.max(30, Math.round(rect.height)) + 'px');
      }
      // Still runs off the right edge of the screen? Say just "✉️ Email".
      var right = holder.getBoundingClientRect().right;
      var edge = document.documentElement.clientWidth || root.innerWidth || 0;
      if (edge && right > edge - 4) holder.setAttribute('data-short', '');
    }
  }

  function syncButtons() {
    pairs.forEach(function (pair) {
      var show = !signedIn() && isVisible(pair.google);
      if (show) { try { layoutCompanion(pair); } catch (error) { /* plain pill */ } }
      if (pair.host.parentNode !== pair.google.parentNode || pair.host.previousSibling !== pair.google) {
        // The page moved things around: keep the email button right after Google.
        if (pair.google.parentNode) pair.google.parentNode.insertBefore(pair.host, pair.google.nextSibling);
      }
      pair.host.style.display = show ? '' : 'none';
    });
  }

  var scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    root.setTimeout(function () { scanQueued = false; scan(); }, 200);
  }

  /* ================================================================== */
  /*  Start                                                               */
  /* ================================================================== */
  var ownScript = document.currentScript || null;

  function start() {
    if (!autoAttachOff()) {
      scan();
      if (root.MutationObserver) {
        new root.MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var t = records[i].target;
            if (t && t.nodeName === 'POLYMATH-EMAIL-BUTTON') continue;
            return queueScan();
          }
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      root.setInterval(syncButtons, 1000);
    }
    whenAuth();
  }

  root.PolymathEmailSignIn = {
    version: VERSION,
    core: core,
    open: function (mode, options) { openDialog(mode, options); },
    close: closeDialog,
    sendVerification: function (user, force) { return sendVerification(user || null, force !== false); },
    refreshVerified: function (user) { return refreshVerified(user || null); },
    lastSentAt: function (uid) { return sentAt(uid); },
    rescan: scan
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
