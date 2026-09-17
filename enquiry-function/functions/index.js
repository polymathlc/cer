'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { createService, recipientConfiguration } = require('./service');
const { createRepository } = require('./repository');
initializeApp();
const service = createService({
  repository: createRepository(getFirestore(), Timestamp),
  recipients: recipientConfiguration(process.env.POLYMATH_ENQUIRY_RECIPIENTS),
  report: code => logger.warn(code)
});
exports.submitPolymathEnquiry = onRequest({
  region: 'us-central1', invoker: 'public', timeoutSeconds: 20,
  maxInstances: 2, concurrency: 20, memory: '256MiB'
}, service.handler);
exports.cleanupPolymathEnquiries = onSchedule({
  region: 'us-central1', schedule: 'every day 03:00', timeZone: 'Asia/Singapore',
  timeoutSeconds: 120, maxInstances: 1, memory: '256MiB', retryCount: 2
}, service.cleanup);
