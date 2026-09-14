import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Exercise the exact bundled game independently from the portal dialog fixtures.
export const root = fileURLToPath(new URL('..', import.meta.url));
export async function withBrowser(callback) {
  const pw = process.env.PLAYWRIGHT_MODULE || 'playwright';
  const {chromium} = await import(path.isAbsolute(pw) ? pathToFileURL(pw).href : pw);
  const html = await fs.readFile(path.join(root, 'hades-game.html'));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/' || pathname === '/hades-game.html') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(html);
    } else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {})});
    await callback({browser, url: `http://127.0.0.1:${server.address().port}/hades-game.html`, root});
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

export async function preparePage(browser, options = {}) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, ...options});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.**', route => route.abort());
  await page.addInitScript(() => {
    let seed = 1826;
    Math.random = () => ((seed = Math.imul(1664525, seed) + 1013904223 | 0) >>> 0) / 4294967296;
  });
  return {page, errors};
}
