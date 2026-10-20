'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { createService } = require('./service');
const { createRepository } = require('./repository');
const { createStripe } = require('./stripe');
initializeApp();
// Both keys arrive as environment variables written at deploy time from the GitHub
// repository secrets STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (see
// tools/shop-deploy-setup.mjs). Without the secret key the page is told card
// payments are off and offers PayNow; without the webhook secret, payments are
// still recorded when the parent comes back from Stripe.
const service = createService({
  repository: createRepository(getFirestore(), Timestamp),
  stripe: createStripe({ secretKey: process.env.STRIPE_SECRET_KEY }),
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  // The admin's Google sign-in on the products page, for sendShopReceipt.
  verifyIdToken: token => getAuth().verifyIdToken(token),
  report: code => logger.warn(code)
});
const web = { region: 'us-central1', invoker: 'public', timeoutSeconds: 30, maxInstances: 3, concurrency: 20, memory: '256MiB' };
exports.createShopCheckout = onRequest(web, service.createCheckout);
exports.shopCheckoutStatus = onRequest(web, service.checkoutStatus);
exports.stripeShopWebhook = onRequest(web, service.webhook);
exports.sendShopReceipt = onRequest(web, service.sendReceipt);
