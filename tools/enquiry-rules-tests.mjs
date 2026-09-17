import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnquiryRules, ENQUIRY_RULE, publishEnquiryRules } from './enquiry-rules.mjs';
const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isLiveServerPath() {
      return request.path[3] in ['cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'];
    }
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`;
test('narrow migration is idempotent and preserves all original bytes except insertion/predicate', () => {
  const updated = addEnquiryRules(original);
  assert.equal(addEnquiryRules(updated), updated);
  assert.equal(updated.replace(ENQUIRY_RULE, '').replace(' && !isPolymathEnquiryServerPath()', ''), original);
});
test('unrecognized, partial and duplicate protections fail closed', () => {
  for (const value of [null, '', original.replace('!isLiveServerPath()', 'true'),
    original.replace('// BEGIN permanent', '// BEGIN polymath-enquiry-server-only-v1\n// BEGIN permanent'),
    addEnquiryRules(original).replace(ENQUIRY_RULE, () => ENQUIRY_RULE + ENQUIRY_RULE)])
    assert.throws(() => addEnquiryRules(value));
});
test('read mode makes no writes or permission-test calls', async () => {
  const paths = [];
  const request = async (path, options = {}) => {
    paths.push(path); assert.equal(options.method, undefined);
    return path.endsWith('cloud.firestore') ? { rulesetName: 'projects/mathgen--app/rulesets/current' }
      : { source: { files: [{ name: 'firestore.rules', content: original }] } };
  };
  const result = await publishEnquiryRules({ request, readOnly: true });
  assert.equal(result.changeNeeded, true); assert.equal(paths.length, 2);
});
test('concurrent production changes prevent release publication', async () => {
  let reads = 0, published = false;
  const request = async (path, options = {}) => {
    if (path.endsWith('cloud.firestore')) {
      if (options.method === 'PATCH') published = true;
      return { rulesetName: 'projects/mathgen--app/rulesets/' + (++reads > 1 ? 'changed' : 'current'), updateTime: String(reads) };
    }
    if (path.endsWith(':test')) return { testResults: options.body.testSuite.testCases.map(() => ({ state: 'SUCCESS' })) };
    if (options.method === 'POST') return { name: 'projects/mathgen--app/rulesets/candidate' };
    return { source: { files: [{ name: 'firestore.rules', content: original }] } };
  };
  await assert.rejects(publishEnquiryRules({ request, deploy: true }), /changed during validation/);
  assert.equal(published, false);
});
