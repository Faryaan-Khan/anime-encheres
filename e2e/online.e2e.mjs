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
 * keeps the player's seat. Then quick matches: two searching players are
 * paired, a forfeit is announced, and a lone player gets a stand-in opponent.
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
for (const file of ['0001_init.sql', '0002_matchmaking.sql', '0003_ranking.sql', '0004_character_powers.sql', '0005_accounts_and_opponent.sql', '0006_modes_and_friends.sql', '0007_seasons.sql', '0008_opponent_brain.sql', '0009_google_accounts.sql']) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
}

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
// Set E2E_SHOTS to a folder to keep screenshots of the main screens.
const snap = (page, name) =>
  process.env.E2E_SHOTS
    ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true })
    : Promise.resolve();
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

  console.log(`PASS  private room: ${rounds} rounds, ${secrecyChecks} secrecy checks, results seen ${JSON.stringify(results)}`);

  // --- Quick match between two people ---------------------------------------

  const ana = await phone('ana');
  const ben = await phone('ben');
  for (const [page, name] of [[ana, 'Ana'], [ben, 'Ben']]) {
    await page.goto(`${base}#/match`, { waitUntil: 'networkidle2' });
    await page.type('input[autocomplete=nickname]', name);
    await click(page, 'Find an opponent');
  }
  await until(ana, () => sees(ana, '.scoreboard'), 'a match for Ana', 20000);
  await until(ben, () => sees(ben, '.scoreboard'), 'a match for Ben', 20000);
  for (const page of [ana, ben]) {
    const shown = await text(page);
    assert(shown.includes('Ana') && shown.includes('Ben'), 'both names are on the board');
    assert(!/Room [A-Z0-9]{5}/.test(shown), 'a quick match does not show its room code');
    assert(new URL(page.url()).hash === '#/match', 'the address stays on the quick-match page');
  }
  // One round, then Ben gives up with two taps.
  await until(ana, async () => (await click(ana, 'Draw a card')) || (await click(ben, 'Draw a card')), 'someone to draw');
  await click(ben, 'Forfeit');
  await until(ben, () => click(ben, 'Confirm forfeit'), 'the confirmation');
  await until(ben, () => sees(ben, '.final'), 'the final screen');
  await until(ana, () => sees(ana, '.final'), 'the final screen');
  assert((await text(ana)).includes('Ana wins: Ben left the game'), 'the forfeit is announced to the winner');
  assert(!(await click(ana, 'Rematch')), 'no rematch in a quick match');
  // The total counts up on screen: wait for it to land.
  await until(ana, async () => (await text(ana)).includes('+30 trophies, 30 in total'), 'the trophies won');
  await until(ben, async () => (await text(ben)).includes('Trophies unchanged: 0'), 'trophies never below zero');
  console.log('PASS  quick match: paired, played, forfeit announced, trophies awarded');
  await snap(ana, 'match-forfeit');

  // Both search again and are paired again; this time one of them stops playing.
  await click(ana, 'Find another opponent');
  await click(ben, 'Find another opponent');
  await until(ana, () => sees(ana, '.scoreboard'), 'a second match for Ana', 20000);
  await until(ben, () => sees(ben, '.scoreboard'), 'a second match for Ben', 20000);
  const idler = (await sees(ana, '.controls .btn--primary')) ? ana : ben;
  const waiter = idler === ana ? ben : ana;
  const idleFor = (seconds) =>
    db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $1) where matched and status = 'playing'`, [seconds]);
  await idleFor(45);
  await until(idler, async () => (await text(idler)).includes('left to play'), 'the clock on the idle side');
  await until(waiter, async () => (await text(waiter)).includes('left to play'), 'the clock on the waiting side');
  assert((await text(idler)).includes('You have'), 'the idle player is warned');
  assert(!(await click(waiter, 'Claim the win')), 'the win cannot be claimed early');
  await snap(waiter, 'match-clock');
  await idleFor(62);
  await until(waiter, () => click(waiter, 'Claim the win'), 'the claim button');
  await until(waiter, () => sees(waiter, '.final'), 'the final screen');
  await until(idler, () => sees(idler, '.final'), 'the final screen');
  assert((await text(idler)).includes('left the game'), 'the timeout is announced to the idle player');
  console.log('PASS  quick match: turn clock shown, win claimed after the limit');

  // --- Quick match when nobody else is looking ------------------------------

  // The computer sits down sooner and thinks faster here than in production.
  await db.exec(`
    update encheres.config set value = '[1, 2]' where key = 'opponent_after_seconds';
    update encheres.config set value = '0.05' where key = 'opponent_pace';`);
  const solo = await phone('solo');
  await solo.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await snap(solo, 'online');
  await click(solo, 'Find an opponent');
  await until(solo, () => sees(solo, 'input[autocomplete=nickname]'), 'the quick-match page');
  await solo.type('input[autocomplete=nickname]', 'Cam');
  await click(solo, 'Find an opponent');
  await sleep(400);
  await snap(solo, 'match-searching');
  await until(solo, () => sees(solo, '.scoreboard'), 'an opponent', 25000);
  await snap(solo, 'match-stand-in');
  const names = await solo.$$eval('.player__name', (els) => els.map((e) => e.textContent));
  assert(names.length === 2 && names[0].startsWith('Cam'), 'the player sits in the first seat');
  assert(!/cpu|computer|ordi|bot/i.test(names[1]), `the opponent has an ordinary name (${names[1]})`);
  let moves = 0;
  for (let step = 0; step < 2400 && !(await sees(solo, '.final')); step++) {
    if (await click(solo, 'Draw a card')) moves++;
    else if (await sees(solo, '.bid__actions button:not(:disabled)')) {
      await click(solo, Math.random() < 0.6 ? 'Bid ' : 'Pass');
      moves++;
    } else if (!(await click(solo, 'Next round'))) await click(solo, 'See the teams');
    await sleep(150);
  }
  await until(solo, () => sees(solo, '.final'), 'the end of the game', 5000);
  assert(moves > 0, 'the game was played');
  assert(!/computer|ordinateur/i.test(await text(solo)), 'the final screen does not mention the computer');
  const judged = await db.query(`select kind, profile1 from encheres.matches where names[1] = 'Cam'`);
  assert(
    judged.rows.length === 1 && judged.rows[0].kind === 'ranked' && judged.rows[0].profile1 === null,
    'the game was played and judged on the server',
  );
  await until(solo, async () => /trophies/i.test(await text(solo)), 'the trophy line');
  await snap(solo, 'match-final');
  assert(await click(solo, 'Find another opponent'), 'a new search can be started');
  await until(solo, async () => (await text(solo)).includes('Looking for an opponent'), 'the new search');
  await click(solo, 'Cancel');
  console.log(`PASS  quick match without players: "${names[1]}" joined from the server, ${moves} moves`);

  // --- Profile, leaderboard, feedback ----------------------------------------

  await solo.goto(`${base}#/profile`, { waitUntil: 'networkidle2' });
  await until(solo, () => sees(solo, '.stats'), 'the profile');
  assert((await solo.$eval('h1', (e) => e.textContent)) === 'Cam', 'the profile carries the player name');
  assert((await solo.$eval('.stats dd', (e) => e.textContent)) === '1', 'the game against the stand-in is counted');
  assert((await solo.$$('.badge--earned')).length >= 1, 'the first badge is earned');
  await solo.select('select', 'MY');
  await solo.evaluate(() => document.querySelectorAll('.avatars input')[4].click());
  await click(solo, 'Save');
  await until(solo, async () => (await text(solo)).includes('Profile saved.'), 'the profile to be saved');
  assert((await text(solo)).includes('Malaysia'), 'the country is shown');
  await snap(solo, 'profile');

  await solo.goto(`${base}#/leaderboard`, { waitUntil: 'networkidle2' });
  await until(solo, () => sees(solo, '.leaders__row--you'), 'the leaderboard');
  const world = await solo.$$eval('.leaders__name', (els) => els.map((e) => e.textContent.trim()));
  assert(world.some((n) => n.endsWith('Ana')) && world.some((n) => n.endsWith('Ben')), `everyone is ranked (${world})`);
  await snap(solo, 'leaderboard');
  await solo.evaluate(() => document.querySelectorAll('.options input')[2].click());
  await until(
    solo,
    async () => (await solo.$$('.leaders__row')).length === 1 && (await sees(solo, '.leaders__row--you')),
    'the country ranking',
  );

  await solo.goto(`${base}#/feedback`, { waitUntil: 'networkidle2' });
  await until(solo, () => sees(solo, 'textarea'), 'the feedback form');
  await snap(solo, 'feedback-empty');
  await solo.type('textarea', 'Please add a tournament mode.');
  await click(solo, 'Send');
  await until(solo, async () => (await text(solo)).includes('Thank you'), 'the thanks');
  const stored = await db.query('select category, message, lang from encheres.feedback');
  assert(
    stored.rows.length === 1 && stored.rows[0].message === 'Please add a tournament mode.' && stored.rows[0].lang === 'en',
    'the feedback is stored',
  );
  console.log(`PASS  profile, leaderboard (${world.length} players) and feedback`);

  // --- The computer plays at every rank ---------------------------------------

  await db.query(`
    update encheres.ratings set trophies = 400, best = 400
     where mode = 'mix' and profile = (select id from encheres.profiles where name = 'Cam')`);
  await solo.goto(`${base}#/match`, { waitUntil: 'networkidle2' });
  await until(solo, async () => (await text(solo)).includes('Silver League, 400 trophies'), 'the level on the match page');
  await click(solo, 'Find an opponent');
  await until(solo, () => sees(solo, '.scoreboard'), 'an opponent at 400 trophies', 25000);
  await click(solo, 'Forfeit');
  await until(solo, () => click(solo, 'Confirm forfeit'), 'the confirmation');
  await until(solo, async () => (await text(solo)).includes('-26 trophies, 374 in total'), 'the trophies lost');
  console.log('PASS  the computer also plays ranked games above the first league');

  // --- Recovering an account on another device --------------------------------

  await solo.goto(`${base}#/profile`, { waitUntil: 'networkidle2' });
  // A guest with progress is offered both ways to sign in with Google.
  await until(solo, async () => (await text(solo)).includes('Keep my progress with Google'), 'the Google choices');
  assert((await text(solo)).includes('New Google account, without my progress'), 'starting fresh is offered');
  await until(solo, () => click(solo, 'Get a recovery code'), 'the recovery button');
  await until(solo, () => sees(solo, '.code'), 'the recovery code');
  const recovery = await solo.$eval('.code', (e) => e.textContent.trim());
  assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(recovery), `the code is readable (${recovery})`);
  await snap(solo, 'account');

  const laptop = await phone('laptop');
  await laptop.goto(`${base}#/profile`, { waitUntil: 'networkidle2' });
  await until(laptop, () => sees(laptop, 'input[placeholder^=XXXX]'), 'the code field');
  await laptop.type('input[placeholder^=XXXX]', 'AAAA-BBBB-CCCC-DDDD');
  await click(laptop, 'Open my account');
  await until(laptop, async () => (await text(laptop)).includes('This code is not valid.'), 'the wrong-code message');
  await laptop.$eval('input[placeholder^=XXXX]', (e) => e.select());
  await laptop.type('input[placeholder^=XXXX]', recovery.toLowerCase());
  await click(laptop, 'Open my account');
  await until(laptop, async () => (await laptop.$eval('h1', (e) => e.textContent)) === 'Cam', 'the recovered profile');
  const mixedTile = await laptop.$$eval('.mode-tile', (tiles) =>
    tiles.map((t) => t.innerText).find((t) => t.startsWith('All mixed')),
  );
  assert(/374/.test(mixedTile) && /Silver League/.test(mixedTile), `the trophies came along (${mixedTile})`);
  console.log('PASS  account recovered on a second device with its code');

  // --- Modes -------------------------------------------------------------------

  // Ana queues for Naruto, Ben for One Piece: different queues, so nobody is paired
  // until the computer arrives; each mode keeps its own trophies.
  for (const page of [ana, ben]) await click(page, 'Back to home'); // leave the finished match
  await ana.goto(`${base}#/match`, { waitUntil: 'networkidle2' });
  await until(ana, () => sees(ana, '.modes'), 'the mode list');
  const modeLabels = await ana.$$eval('.modes__choice strong', (els) => els.map((e) => e.textContent));
  assert(modeLabels[0] === 'All mixed' && modeLabels.includes('Naruto') && modeLabels.length === 8, `modes offered (${modeLabels})`);
  await ana.evaluate(() => [...document.querySelectorAll('.modes__choice')].find((l) => l.textContent.includes('Naruto')).click());
  await click(ana, 'Find an opponent');
  await until(ana, async () => (await text(ana)).includes('Looking for an opponent in Naruto'), 'the Naruto search');
  await until(ana, () => sees(ana, '.scoreboard'), 'a Naruto match', 25000);
  const narutoRoom = await db.query(`select mode, array_length(pool, 1) as cards from encheres.rooms where mode = 'naruto'`);
  assert(narutoRoom.rows.length === 1 && narutoRoom.rows[0].cards === 58, 'the server dealt the Naruto cards');
  await click(ana, 'Forfeit');
  await until(ana, () => click(ana, 'Confirm forfeit'), 'the confirmation');
  await until(ana, () => sees(ana, '.final'), 'the final screen');
  await ana.goto(`${base}#/leaderboard`, { waitUntil: 'networkidle2' });
  await until(ana, () => sees(ana, 'select'), 'the ranking picker');
  await ana.select('select', 'naruto');
  await until(
    ana,
    async () => (await ana.$$('.leaders__row')).length === 1 && (await sees(ana, '.leaders__row--you')),
    'the Naruto ranking',
  );
  console.log('PASS  modes: separate queue, server-dealt cards and a ranking per mode');

  // --- Friends and invitations -------------------------------------------------

  await ana.goto(`${base}#/friends`, { waitUntil: 'networkidle2' });
  await until(ana, () => sees(ana, '.code'), 'the player tag');
  const tag = await ana.$eval('.code', (e) => e.textContent.trim());
  assert(/^[A-Z2-9]{7}$/.test(tag), `the tag is readable (${tag})`);

  await ben.goto(`${base}#/friends`, { waitUntil: 'networkidle2' });
  await until(ben, () => sees(ben, 'form input[type=text]'), 'the add-friend form');
  await ben.type('form input[type=text]', tag.toLowerCase());
  await click(ben, 'Send request');
  await until(ben, async () => (await text(ben)).includes('Request sent.'), 'the request');
  await until(ana, () => click(ana, 'Accept'), 'the request to arrive', 20000);
  await until(ana, async () => (await text(ana)).includes('My friends (1)'), 'the friendship');
  await snap(ana, 'friends');

  // Friends ranking: the two of them only.
  await ana.goto(`${base}#/leaderboard`, { waitUntil: 'networkidle2' });
  await until(ana, () => sees(ana, '.options input'), 'the leaderboard');
  await ana.evaluate(() => document.querySelectorAll('.options input')[1].click());
  await until(ana, async () => (await ana.$$('.leaders__row')).length === 2, 'the friends ranking');

  // Ana opens a private room and invites Ben, who joins from his home screen.
  await ana.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await until(ana, () => click(ana, 'Create the room'), 'the create button');
  await until(ana, () => sees(ana, '.lobby__code'), 'the lobby');
  await snap(ana, 'lobby-invite');
  await until(ana, () => click(ana, 'Invite'), 'the invite button');
  await until(ana, async () => (await text(ana)).includes('Invited'), 'the invitation to be sent');
  await ben.goto(`${base}#/`, { waitUntil: 'networkidle2' });
  await ben.reload({ waitUntil: 'networkidle2' });
  await until(ben, () => click(ben, 'Ana invites you to a room'), 'the invitation on the home screen');
  await until(ben, () => sees(ben, 'input[autocomplete=nickname]'), 'the join form');
  await click(ben, 'Join');
  await until(ben, () => sees(ben, '.lobby__code'), 'the lobby');
  await until(ana, async () => (await ana.$$('.lobby__players li')).length === 2 && !(await sees(ana, '.lobby__empty')), 'Ben in the lobby');
  console.log('PASS  friends: request by tag, friends ranking, invitation to a private room');

  // --- Home ---------------------------------------------------------------------

  await solo.goto(`${base}#/`, { waitUntil: 'networkidle2' });
  const buttons = await solo.$$eval('.home__modes .btn--mode', (els) => els.map((e) => e.firstChild.textContent));
  assert(buttons.join('|') === 'Play online|Play offline', `home offers online first, then offline (${buttons})`);
  assert(await solo.$eval('.home__modes .btn--mode', (e) => e.classList.contains('btn--primary')), 'online is highlighted');
  await snap(solo, 'home');
  console.log('PASS  home: play online first, one offline entry');

  // --- Dark theme, notices -------------------------------------------------------

  await click(solo, '☾');
  await until(solo, () => solo.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'the dark theme');
  // The colours fade over a quarter of a second.
  await until(
    solo,
    async () => (await solo.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(18, 19, 23)',
    'the page to turn dark',
  );
  await solo.reload({ waitUntil: 'networkidle2' });
  assert(await solo.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'the theme is remembered');
  await snap(solo, 'home-dark');
  await solo.goto(`${base}#/profile`, { waitUntil: 'networkidle2' });
  await until(solo, () => sees(solo, '.mode-tile'), 'the profile');
  await snap(solo, 'profile-dark');
  await solo.goto(`${base}#/legal`, { waitUntil: 'networkidle2' });
  await until(solo, async () => (await text(solo)).includes('unofficial fan game'), 'the notices');
  assert((await solo.$$('.team__cards .card')).length === 6, 'every rarity is shown');
  await snap(solo, 'legal-dark');
  await click(solo, 'Send a request');
  await until(solo, () => solo.evaluate(() => [...document.querySelectorAll('input[name=category]')].find((i) => i.checked)?.parentElement.textContent === 'Rights request'), 'the rights topic');
  assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ')})`);
  console.log('PASS  dark theme remembered; notices and rights request');
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
