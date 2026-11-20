'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { createService, createHttp, hash } = require('./service');
const { createBookingService, BOOKING_SOURCE } = require('./booking');
const { createDiagnosticService } = require('./diagnostic');
const { createDiagnosticReportService } = require('./diagnostic-report');
const { createTrialService } = require('./trial');
const { createTrialStore } = require('./trial-store');
const { createRevisionService, REVISION_SOURCE } = require('./revision');
const { createRevisionStore } = require('./revision-store');
const { createRepository } = require('./repository');
const { createStripe } = require('./stripe');
const { createMapsService, createMapsStore, MAPS_SOURCE } = require('./maps');
const { createNotebookService } = require('./notebook');
const { createNotebookStore } = require('./notebook-store');
initializeApp();
// Both keys arrive as environment variables written at deploy time from the GitHub
// repository secrets STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (see
// tools/shop-deploy-setup.mjs). Without the secret key the page is told card
// payments are off and offers PayNow; without the webhook secret, payments are
// still recorded when the parent comes back from Stripe.
const repository = createRepository(getFirestore(), Timestamp);
const stripe = createStripe({ secretKey: process.env.STRIPE_SECRET_KEY });
const report = code => logger.warn(code);
// Trial lessons and enrolments on /schedule, paid by card with the same account.
const bookings = createBookingService({ repository, stripe, http: createHttp(report), hashIp: hash, report });
// Free diagnostic tests on /diagnostic, at the Master Class sessions on /schedule.
const diagnostics = createDiagnosticService({ repository, http: createHttp(report), hashIp: hash, report });
// The parent's diagnostic report page (/diagnostic/report/), read with the key in their emailed link.
const diagnosticReports = createDiagnosticReportService({ repository, http: createHttp(report) });
// Online trial lessons on /trial: one-time codes, class links, live Zoom link and worksheets.
const trials = createTrialService({
  store: createTrialStore(getFirestore(), Timestamp, { bucket: getStorage().bucket('mathgen--app.firebasestorage.app') }),
  http: createHttp(report), hashIp: hash, verifyIdToken: token => getAuth().verifyIdToken(token), report
});
// Exam countdown revision packs on /revision (and listed on /products): card or PayNow,
// then an access code by email. Kept under trialSettings/revisionPacks (see revision.js).
const revision = createRevisionService({
  store: createRevisionStore(getFirestore(), Timestamp, { bucket: getStorage().bucket('mathgen--app.firebasestorage.app') }),
  stripe, http: createHttp(report), hashIp: hash, verifyIdToken: token => getAuth().verifyIdToken(token),
  cardConfigured: !!process.env.STRIPE_SECRET_KEY, report
});
// Mr Chung's Maps library on /maps: the monthly subscription for people outside the centre.
const maps = createMapsService({
  store: createMapsStore(getFirestore(), Timestamp), stripe, http: createHttp(report),
  verifyIdToken: token => getAuth().verifyIdToken(token), report
});
// The mistake notebook on /notebook: every wrong worksheet and live-lesson question, and the weekly redo quiz.
const notebook = createNotebookService({
  store: createNotebookStore(getFirestore(), { bucket: getStorage().bucket('mathgen--app.firebasestorage.app') }),
  http: createHttp(report), verifyIdToken: token => getAuth().verifyIdToken(token), report
});
const service = createService({
  repository, stripe,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  paidSessionHandlers: { [BOOKING_SOURCE]: bookings.handlePaidSession, [REVISION_SOURCE]: revision.handlePaidSession, [MAPS_SOURCE]: maps.handlePaidSession },
  // The admin's Google sign-in on the products page, for sendShopReceipt.
  verifyIdToken: token => getAuth().verifyIdToken(token),
  report
});
const web = { region: 'us-central1', invoker: 'public', timeoutSeconds: 30, maxInstances: 3, concurrency: 20, memory: '256MiB' };
exports.createShopCheckout = onRequest(web, service.createCheckout);
exports.shopCheckoutStatus = onRequest(web, service.checkoutStatus);
exports.stripeShopWebhook = onRequest(web, service.webhook);
exports.sendShopReceipt = onRequest(web, service.sendReceipt);
exports.createScheduleCheckout = onRequest(web, bookings.createCheckout);
exports.scheduleCheckoutStatus = onRequest(web, bookings.checkoutStatus);
exports.bookDiagnostic = onRequest(web, diagnostics.bookDiagnostic);
exports.diagnosticReport = onRequest(web, diagnosticReports.diagnosticReport);
exports.trialBooking = onRequest(web, trials.trialBooking);
exports.trialAdmin = onRequest(web, trials.trialAdmin);
exports.trialMaterial = onRequest(Object.assign({}, web, { timeoutSeconds: 120, concurrency: 10 }), trials.trialMaterial);
exports.revisionPack = onRequest(Object.assign({}, web, { timeoutSeconds: 120, concurrency: 10 }), revision.revisionPack);
exports.revisionPackAdmin = onRequest(web, revision.revisionPackAdmin);
exports.mapsLibrary = onRequest(web, maps.mapsLibrary);
exports.mistakeNotebook = onRequest(Object.assign({}, web, { timeoutSeconds: 60, memory: '512MiB' }), notebook.mistakeNotebook);
