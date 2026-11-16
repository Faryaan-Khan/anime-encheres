/**
 * End-to-end test of online play.
 *
 * Two isolated browser sessions (two "phones") play a complete game through
 * the real UI. The backend is the real SQL migration running in PGlite behind
 * a tiny HTTP server that mimics Supabase's REST endpoint, so no network or
 * Supabase project is needed. There is no Realtime server here, which also
 * proves the polling fallback keeps both screens in sync on its own.
 *
 * Checks: the rival's page never contains the hidden character, both players
 * see every result, only the host can start a rematch, and a page reload
 * keeps the player's seat.
 *
 * Run with `npm run test:e2e`. Needs Chrome or Chromium; set CHROME_PATH if
 * it is not found automatically.
 */
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import puppeteer from 'puppeteer-core';
import { build, preview } from 'vite';

const API_PORT = 54399;
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../node_modules/.e2e-dist', import.meta.url));

const chromePath = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH to your Chrome or Chromium executable.');
  process.exit(1);
}

// --- Backend: the real migration behind a Supabase-shaped RPC endpoint -----

const db = new PGlite();
await db.exec('create role anon nologin; create role authenticated nologin;');
await db.exec(readFileSync(new URL('../supabase/migrations/0001_init.sql', import.meta.url), 'utf8'));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const api = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const match = req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (!match || req.method !== 'POST') return res.writeHead(404, cors).end('{}');
  let body = '';
  for await (const chunk of req) body += chunk;
  const args = JSON.parse(body || '{}');
  const names = Object.keys(args);
  try {
    const call = names.map((name, i) => `${name} => $${i + 1}`).join(', ');
    const result = await db.query(`select public.${match[1]}(${call}) as out`, names.map((n) => args[n]));
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(result.rows[0].out));
  } catch (error) {
    res.writeHead(400, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ message: error.message }));
  }
});
await new Promise((resolve) => api.listen(API_PORT, resolve));

// --- Frontend: production build pointed at the local backend ---------------

process.env.VITE_SUPABASE_URL = `http://localhost:${API_PORT}`;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'e2e-key';
await build({ root, logLevel: 'error', build: { outDir, emptyOutDir: true } });
const site = await preview({ root, logLevel: 'error', build: { outDir }, preview: { port: 4174 } });
const base = site.resolvedUrls.local[0];

// --- Helpers ----------------------------------------------------------------

const browser = await puppeteer.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const pageErrors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function phone(label) {
  const context = await browser.createBrowserContext(); // own storage = own player token
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('ae.lang', 'en'));
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  page.label = label;
  return page;
}

const click = (page, text) =>
  page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.includes(text) && !b.disabled,
    );
    button?.click();
    return Boolean(button);
  }, text);

const sees = (page, selector) => page.$(selector).then(Boolean);
const text = (page) => page.evaluate(() => document.body.innerText);
const roundOf = (page) => page.$eval('.board__meta strong', (e) => e.textContent).catch(() => '');

async function until(page, check, what, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`${page.label}: timed out waiting for ${what}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Scenario ---------------------------------------------------------------

let failed = false;
try {
  const host = await phone('host');
  const guest = await phone('guest');

  await host.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await host.type('input[autocomplete=nickname]', 'Ana');
  await click(host, 'Create the room');
  await until(host, () => sees(host, '.lobby__code'), 'the lobby');
  const code = await host.$eval('.lobby__code', (e) => e.textContent.trim());
  assert(/^[A-HJ-NP-Z2-9]{5}$/.test(code), 'room code format');

  await guest.goto(`${base}#/room/ZZZZZ`, { waitUntil: 'networkidle2' });
  await until(guest, () => sees(guest, '.alert'), 'the unknown-room message');

  await guest.goto(`${base}#/room/${code}`, { waitUntil: 'networkidle2' });
  await until(guest, () => sees(guest, 'input[autocomplete=nickname]'), 'the join form');
  await guest.type('input[autocomplete=nickname]', 'Ben');
  await click(guest, 'Join');
  await until(guest, () => sees(guest, '.lobby__code'), 'the lobby');
  assert(!(await click(guest, 'Start the game')), 'guest cannot start the game');

  await until(host, () => click(host, 'Start the game'), 'the guest to appear');
  await until(guest, () => sees(guest, '.scoreboard'), 'the game to start');

  const results = { host: 0, guest: 0 };
  let rounds = 0;
  let secrecyChecks = 0;
  const acknowledge = async (page) => {
    if ((await click(page, 'Next round')) || (await click(page, 'See the teams'))) {
      results[page.label]++;
      return true;
    }
    return false;
  };

  for (let step = 0; step < 600; step++) {
    if ((await sees(host, '.final')) && (await sees(guest, '.final'))) break;
    let acted = false;
    for (const page of [host, guest]) {
      const rival = page === host ? guest : host;
      if (await click(page, 'Draw a card')) {
        rounds++;
        await until(page, async () => (await sees(page, '.stage .card--face')) || (await sees(page, '.stamp')), 'the drawn card');
        const round = await roundOf(page);
        // Wait until the rival's screen has caught up with this round's auction.
        await until(rival, async () => {
          if (await sees(page, '.stamp')) return true; // resolved at once
          if (await sees(rival, '.stamp')) return void (await acknowledge(rival));
          return (await roundOf(rival)) === round && ((await text(rival)).includes('knows the card') || (await sees(rival, '.bid')));
        }, 'the rival to catch up');
        if (!(await sees(page, '.stamp'))) {
          const hidden = await page.$eval('.stage .card__name', (e) => e.textContent);
          assert(!(await sees(rival, '.stage .card--face')), 'rival card is face down');
          assert(!(await rival.content()).includes(hidden), `"${hidden}" is absent from the rival's page`);
          secrecyChecks++;
        }
        acted = true;
        break;
      }
      if (await sees(page, '.bid__actions button:not(:disabled)')) {
        const roll = Math.random();
        if (roll < 0.25) await click(page, '+50');
        await click(page, roll < 0.65 ? 'Bid ' : 'Pass');
        acted = true;
        break;
      }
      if (await acknowledge(page)) {
        acted = true;
        break;
      }
    }
    await sleep(acted ? 200 : 400);
  }

  await until(host, () => sees(host, '.final'), 'the final screen');
  await until(guest, () => sees(guest, '.final'), 'the final screen');
  assert(rounds > 0 && secrecyChecks > 0, 'the game was actually played');
  assert(results.host === rounds && results.guest === rounds, 'both players saw every result');
  assert(!(await click(guest, 'Rematch')), 'guest cannot start a rematch');

  await click(host, 'Rematch');
  await until(guest, () => sees(guest, '.scoreboard'), 'the rematch');
  await guest.reload({ waitUntil: 'networkidle2' });
  await until(guest, () => sees(guest, '.scoreboard'), 'the seat to survive a reload');
  assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ')})`);

  console.log(`PASS  online e2e: ${rounds} rounds, ${secrecyChecks} secrecy checks, results seen ${JSON.stringify(results)}`);
} catch (error) {
  failed = true;
  console.error(`FAIL  ${error.message}`);
} finally {
  await browser.close();
  await new Promise((resolve) => site.httpServer.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  await db.close();
}
process.exit(failed ? 1 : 0);
