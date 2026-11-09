import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const modes = ['defenders', 'raiders', 'spire', 'legends', 'slayers'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {})
});

try {
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'game-flags.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
          <style>html,body,iframe{margin:0;width:100%;height:100%;display:block;border:0}</style>
          <iframe src="/science-${mode}.html"></iframe>
          <script>
          window.flags = [];
          window.answers = [];
          let questionSerial = 0;
          const identity = {studentKey:'report-child', studentLevel:'P4'};
          const child = document.querySelector('iframe').contentWindow;
          addEventListener('message', event => {
            if (event.source !== child || event.origin !== location.origin) return;
            const data = event.data;
            if (data.type === 'SD_REQUEST_QUESTIONS') child.postMessage({
              type:'SD_QUESTIONS', feedPolicyVersion:1, requestId:data.requestId, ...identity,
              playsLeft:{ ${mode}: 9 },
              questions:[{id:'flag-fixture-'+(++questionSerial),q:'Which part of the plant takes in water?',
                options:['Roots','Leaves','Stem','Flowers'],answer:0,topic:'Plant Systems'}]
            }, location.origin);
            if (data.type === 'LEGENDS_REQUEST_META') child.postMessage({
              type:'LEGENDS_META', ...identity, meta:{inv:[],eq:{},loadout:{},pts:0},gold:0
            }, location.origin);
            if (data.type === 'SD_FLAG') flags.push(data);
            if (data.type === 'SD_RECORD') answers.push(data);
          });
          window.replyToFlag = change => {
            const {requestId,questionId,studentKey,studentLevel} = flags.at(-1);
            child.postMessage({type:'SD_FLAG_RESULT',ok:true,requestId,questionId,studentKey,studentLevel,...change},location.origin);
          };
          </script>`
      });
      const file = path.join(root, decodeURIComponent(url.pathname));
      return fs.existsSync(file) && fs.statSync(file).isFile()
        ? route.fulfill({ path: file })
        : route.abort();
    });

    await page.goto('https://game-flags.test/');
    const game = page.frames().find(frame => frame.url().endsWith('/science-' + mode + '.html'));
    await game.waitForFunction(() => typeof _gameCreditsReady === 'function' && _gameCreditsReady());
    await game.locator(mode === 'defenders' || mode === 'spire' ? '#introStartBtn' : '#startBtn').click();
    if (mode !== 'spire') {
      await game.waitForFunction(slug => slug === 'defenders' ? G.running : G?.state === 'play', mode);
      await game.evaluate(() => openQuestion());
    }
    const flag = game.locator('.gqf-toggle');
    await flag.waitFor();
    assert.equal(await game.evaluate(() => qState.answered), false, mode + ' exposes Flag before an answer');
    await flag.click();
    const textarea = game.locator('#flagBox textarea');
    assert.ok(await textarea.evaluate(element => document.activeElement === element));
    await textarea.press('2');
    assert.equal(await textarea.inputValue(), '2');
    await textarea.fill('Please review choice 2.');

    if (mode === 'defenders') {
      await game.evaluate(() => {
        const realTimeout = window.setTimeout;
        window.setTimeout = (callback, delay, ...args) => realTimeout(callback, delay === 10000 ? 180 : delay, ...args);
      });
    }
    await game.locator('.gqf-submit').click();
    await page.waitForFunction(() => flags.length === 1);
    const first = await page.evaluate(() => flags[0]);
    assert.equal(first.mode, mode);
    assert.equal(first.studentKey, 'report-child');
    assert.equal(first.studentLevel, 'P4');
    assert.equal(first.comment, 'Please review choice 2.');
    assert.equal(first.questionTitle, 'Which part of the plant takes in water?');
    assert.equal(first.questionId, await game.evaluate(() => String(qState.current.id)));

    if (mode === 'defenders') {
      await game.getByText('Submission was not confirmed.').waitFor();
      assert.ok(await textarea.getAttribute('readonly') !== null);
      await game.getByRole('button', { name: 'Retry flag' }).click();
      await page.waitForFunction(() => flags.length === 2);
      assert.deepEqual(await page.evaluate(() => flags[1]), first, 'retry uses exactly the same report');
    }
    await page.evaluate(() => replyToFlag({ requestId: 'obsolete-request' }));
    assert.equal(await game.getByText('Flag submitted.').count(), 0);
    await page.evaluate(() => replyToFlag({}));
    await game.getByText('Flag submitted.').waitFor();
    const sentCount = await page.evaluate(() => flags.length);
    await game.locator('#flagBox form').evaluate(form => form.requestSubmit());
    assert.equal(await page.evaluate(() => flags.length), sentCount, 'confirmed report cannot be sent again');
    assert.equal(await game.evaluate(() => qState.answered), false, mode + ' reporting leaves the question ungraded');
    assert.equal(await page.evaluate(() => answers.length), 0);
    assert.deepEqual(errors, [], mode + ' browser errors');
    await context.close();
  }
  console.log('All five embedded science games passed pre-answer flag, comment, confirmation, and grading isolation checks.');
} finally {
  await browser.close();
}
