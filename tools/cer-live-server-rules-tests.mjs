import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_COLLECTIONS, LIVE_RULE_BEFORE, LIVE_RULE, addLiveServerRules, liveRuleTests, preservedRuleTests, publishLiveRules } from './cer-live-server-rules.mjs';

const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
${LIVE_RULE_BEFORE}
    // An unrelated policy must remain byte-for-byte unchanged.
    function isPermanentStudentHistoryPath() { return request.path[3] == 'users'; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}
`;
const releasePath = 'projects/mathgen--app/releases/cloud.firestore';
const initialName = 'projects/mathgen--app/rulesets/original';
const candidateName = 'projects/mathgen--app/rulesets/candidate';

function api({ content = original, validationFails = false, invalidResults = false,
  concurrentChange = false, sameRulesetChangedTime = false, unverifiedPublish = false,
  candidateOutsideProject = false, sourceFiles } = {}) {
  let reads = 0, patched = false;
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === releasePath && !options.method) {
      reads++;
      return { rulesetName: patched && !unverifiedPublish ? candidateName : concurrentChange && reads > 1
        ? 'projects/mathgen--app/rulesets/concurrent' : initialName,
      updateTime: sameRulesetChangedTime && reads > 1 ? 'later' : 'initial' };
    }
    if (path === initialName) return { source: { files: sourceFiles || [{ name: 'firestore.rules', content }] } };
    if (path.endsWith(':test')) return {
      issues: validationFails ? [{ severity: 'ERROR' }] : [],
      testResults: options.body.testSuite.testCases.slice(invalidResults ? 1 : 0).map(() => ({ state: 'SUCCESS' }))
    };
    if (path.endsWith('/rulesets')) return { name: candidateOutsideProject ? 'projects/other/rulesets/candidate' : candidateName };
    if (path === releasePath && options.method === 'PATCH') { patched = true; return {}; }
    throw new Error('Unexpected request: ' + path);
  };
  return { request, calls };
}

test('only extends the exact existing Live list with the two CER namespaces', () => {
  const updated = addLiveServerRules(original);
  assert.ok(updated.includes(LIVE_RULE));
  assert.equal(updated.replace(LIVE_RULE, LIVE_RULE_BEFORE), original);
  assert.equal(updated.replace("'ansKeyLiveSessions', 'ansKeyLiveLimits',\n        'cerAinsteinLiveSessions', 'cerAinsteinLiveLimits'", "'ansKeyLiveSessions', 'ansKeyLiveLimits'"), original);
  assert.equal(addLiveServerRules(updated), updated);
});
test('supports the previously protected true catch-all without changing its expression', () => {
  const source = original.replace('!isPermanentStudentHistoryPath() &&', 'true &&');
  const updated = addLiveServerRules(source);
  assert.ok(updated.includes('if true && !isLiveServerPath();'));
  assert.equal(addLiveServerRules(updated), updated);
});
test('refuses unfamiliar, duplicate or partially applied rules', () => {
  for (const source of [null, '', original.replace('if !isPermanentStudentHistoryPath() && !isLiveServerPath();', 'if request.auth != null;'),
    original + original, original.replace(' && !isLiveServerPath()', ''),
    original.replace(LIVE_RULE_BEFORE, ''), original.replace("'ansKeyLiveLimits'", "'unexpectedCollection'"),
    original + LIVE_RULE.replace('request.path[3]', 'request.path[4]')])
    assert.throws(() => addLiveServerRules(source));
});
test('covers all six server namespaces, descendants and collection lists for every client role', () => {
  const cases = liveRuleTests();
  assert.equal(cases.length, 180);
  for (const root of LIVE_COLLECTIONS) for (const uid of [null, 'live-test-user', 'live-test-admin']) {
    const matching = cases.filter(item => item.request.path.includes('/documents/' + root + (item.request.method === 'list' ? '' : '/'))
      && (item.request.auth?.uid || null) === uid);
    assert.equal(matching.length, 10);
    assert.ok(matching.every(item => item.expectation === 'DENY'));
    assert.ok(matching.some(item => item.request.path.endsWith('/nested/child')));
    assert.ok(matching.some(item => item.request.path.endsWith(root) && item.request.method === 'list'));
  }
});
test('legacy tests cover existing apps and similarly named unrelated paths', () => {
  const cases = preservedRuleTests(original + '// permanent-student-question-history-v1');
  assert.equal(cases.length, 176);
  assert.ok(cases.some(item => item.request.path.includes('pdfAnnotator/')));
  assert.ok(cases.some(item => item.request.path.includes('LiveSessionsArchive/')));
  assert.ok(cases.some(item => item.request.path.includes('/users/probe/studyBuddyLiveSessions/')));
  assert.equal(cases.filter(item => item.expectation === 'DENY').length, 124);
});
test('read mode only retrieves the current release and source', async () => {
  const server = api();
  const result = await publishLiveRules({ ...server, readOnly: true });
  assert.equal(result.changeNeeded, true);
  assert.equal(server.calls.length, 2);
  assert.ok(server.calls.every(call => !call.method));
});
test('default mode tests old permissions and the candidate without publishing', async () => {
  const server = api();
  const result = await publishLiveRules(server);
  assert.equal(result.validated, 350);
  assert.equal(result.changed, false);
  assert.equal(result.changeNeeded, true);
  const batches = server.calls.filter(call => call.path.endsWith(':test'));
  assert.equal(batches.length, 6);
  assert.ok(batches.every(call => call.body.testSuite.testCases.length <= 100));
  assert.equal(batches.reduce((n, call) => n + call.body.testSuite.testCases.length, 0), 520);
  assert.ok(!server.calls.some(call => call.path.endsWith('/rulesets') || call.method === 'PATCH'));
});
test('apply mode compiles, checks the current release, publishes and verifies', async () => {
  const server = api();
  const result = await publishLiveRules({ ...server, deploy: true });
  assert.equal(result.changed, true);
  assert.equal(result.ruleset, candidateName);
  assert.deepEqual(server.calls.map(call => call.method || 'GET'), ['GET', 'GET', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'GET', 'PATCH', 'GET']);
  assert.equal(server.calls.find(call => call.method === 'PATCH').body.release.rulesetName, candidateName);
  assert.equal(server.calls[2].body.source.files[0].content, original);
  assert.equal(server.calls[4].body.source.files[0].content, addLiveServerRules(original));
});
test('already protected source is tested but never published again', async () => {
  const server = api({ content: addLiveServerRules(original) });
  const result = await publishLiveRules({ ...server, deploy: true });
  assert.equal(result.changed, false);
  assert.equal(result.changeNeeded, false);
  assert.ok(!server.calls.some(call => call.method === 'PATCH'));
});
test('validation failures and missing results prevent compilation and publication', async () => {
  for (const options of [{ validationFails: true }, { invalidResults: true }]) {
    const server = api(options);
    await assert.rejects(publishLiveRules({ ...server, deploy: true }), /permission tests failed/);
    assert.ok(!server.calls.some(call => call.path.endsWith('/rulesets') || call.method === 'PATCH'));
  }
});

test('a failure in the final permission batch prevents ruleset creation and publication', async () => {
  const server = api(); let tested = 0;
  const request = async (path, options) => {
    const result = await server.request(path, options);
    if (path.endsWith(':test') && ++tested === 6) result.testResults[0].state = 'FAILURE';
    return result;
  };
  await assert.rejects(publishLiveRules({ request, deploy: true }), /permission tests failed/);
  assert.equal(tested, 6);
  assert.ok(!server.calls.some(call => call.path.endsWith('/rulesets') || call.method === 'PATCH'));
});
test('concurrent release changes, including an ABA timestamp change, prevent overwrite', async () => {
  for (const options of [{ concurrentChange: true }, { sameRulesetChangedTime: true }]) {
    const server = api(options);
    await assert.rejects(publishLiveRules({ ...server, deploy: true }), /changed during validation/);
    assert.ok(!server.calls.some(call => call.method === 'PATCH'));
  }
});
test('verifies publication and refuses a candidate outside the shared project', async () => {
  await assert.rejects(publishLiveRules({ ...api({ unverifiedPublish: true }), deploy: true }), /Could not verify/);
  const server = api({ candidateOutsideProject: true });
  await assert.rejects(publishLiveRules({ ...server, deploy: true }), /candidate ruleset path/);
  assert.ok(!server.calls.some(call => call.method === 'PATCH'));
});
test('wrong project, conflicting modes and unexpected source bundles fail closed', async () => {
  const server = api();
  await assert.rejects(publishLiveRules({ ...server, project: 'other' }), /Unexpected shared Firebase project/);
  await assert.rejects(publishLiveRules({ ...server, deploy: true, readOnly: true }), /cannot be combined/);
  assert.equal(server.calls.length, 0);
  await assert.rejects(publishLiveRules(api({ sourceFiles: [] })), /source bundle/);
});
