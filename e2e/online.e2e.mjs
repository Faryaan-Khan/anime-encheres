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
for (const file of ['0001_init.sql', '0002_matchmaking.sql', '0003_ranking.sql', '0004_character_powers.sql', '0005_accounts_and_opponent.sql', '0006_modes_and_friends.sql', '0007_seasons.sql', '0008_opponent_brain.sql', '0009_google_accounts.sql', '0010_fair_play.sql', '0011_autopilot.sql', '0012_passes_and_scales.sql', '0013_old_site_and_auto_bid.sql', '0014_seasons_names_avatars.sql', '0015_public_rooms.sql', '0016_team_rooms.sql', '0017_three_players.sql', '0018_ranked_trio.sql']) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
}

const calls = { leaving: 0 };
const rosters = JSON.parse(readFileSync(new URL('../src/data/rosters.json', import.meta.url), 'utf8'));
const CHARACTER_COUNT = Object.values(rosters).reduce((n, list) => n + list.length, 0);
const ONE_PIECE_COUNT = rosters['one-piece'].length;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const api = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const match = req.url.match(/^\/rest\/v1\/rpc\/(\w+)(\?.*)?$/);
  if (!match || req.method !== 'POST') return res.writeHead(404, cors).end('{}');
  let body = '';
  for await (const chunk of req) body += chunk;
  // The leaving note is a beacon with a form body, as PostgREST accepts.
  const form = (req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
  const args = form ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body || '{}');
  if (match[1] === 'leaving') calls.leaving += 1;
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

  let rounds = 0;
  let secrecyChecks = 0;
  // Results move on by themselves now, so count the results each screen
  // actually showed (one stamp per round) rather than button presses.
  for (const page of [host, guest]) {
    await page.evaluate(() => {
      window.__results = new Set();
      const check = () => {
        if (document.querySelector('.stamp')) window.__results.add(document.querySelector('.board__meta strong')?.textContent);
      };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  }
  const acknowledge = (page) => page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent.includes('Next round') || b.textContent.includes('See the teams')) && !b.disabled,
    );
    button?.click();
    return Boolean(button);
  });

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
          // Whole names only: with whole-universe decks "Goten" and "Gotenks" can both be in play.
          const names = await rival.$$eval('.card__name, .history li, .slot', (els) => els.map((e) => e.textContent.trim()));
          const html = await rival.content();
          assert(!names.includes(hidden) && !html.includes(`>${hidden}<`), `"${hidden}" is absent from the rival's page`);
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
  // Some rounds start without a click: a player who can no longer buy has
  // their card drawn for them.
  const played = (
    await db.query(`select coalesce(jsonb_array_length(history), 0) as n from encheres.rooms where not matched order by updated_at desc limit 1`)
  ).rows[0].n;
  const results = {
    host: await host.evaluate(() => window.__results.size),
    guest: await guest.evaluate(() => window.__results.size),
  };
  assert(results.host === played && results.guest === played && played >= rounds, `both players saw every result (${JSON.stringify(results)} of ${played})`);
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
  await click(ana, 'Play again');
  await click(ben, 'Play again');
  await until(ana, () => sees(ana, '.scoreboard'), 'a second match for Ana', 20000);
  await until(ben, () => sees(ben, '.scoreboard'), 'a second match for Ben', 20000);
  const idler = (await sees(ana, '.controls .btn--primary')) ? ana : ben;
  const waiter = idler === ana ? ben : ana;
  const idleFor = (seconds) =>
    db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $1) where matched and status = 'playing'`, [seconds]);
  const idlerSeat = () =>
    db.query(
      `select case r.phase when 'draw' then r.drawer else r.turn end as seat
         from encheres.rooms r where r.matched and r.status = 'playing'`,
    );
  await idleFor(20);
  await until(idler, async () => (await text(idler)).includes('left to play'), 'the clock on the idle side');
  await until(waiter, async () => (await text(waiter)).includes('left to play'), 'the clock on the waiting side');
  assert((await text(idler)).includes('You have'), 'the idle player is warned');
  assert(!(await click(waiter, 'Claim the win')), 'there is nothing to claim');
  await snap(waiter, 'match-clock');
  // Time runs out: the server draws for the idle player and counts it.
  await idleFor(31);
  await until(idler, async () => (await text(idler)).includes('Out of time 1/3'), 'the first time-out on the idle side');
  await until(waiter, async () => (await text(waiter)).includes('Out of time 1/3'), 'the first time-out on the waiting side');
  assert(await sees(waiter, '.scoreboard'), 'the game goes on after one time-out');
  await snap(idler, 'match-strike');
  // The third time-out loses the match, with nobody pressing anything.
  const seat = (await idlerSeat()).rows[0].seat;
  await db.query(
    `update encheres.room_players p set strikes = 2 from encheres.rooms r
      where p.room_code = r.code and r.matched and r.status = 'playing' and p.seat = $1`,
    [seat],
  );
  await idleFor(31);
  await until(waiter, () => sees(waiter, '.final'), 'the final screen');
  await until(idler, () => sees(idler, '.final'), 'the final screen');
  assert((await text(idler)).includes('left the game'), 'the timeout is announced to the idle player');
  console.log('PASS  quick match: the server plays for a slow player and the third time-out loses');

  // --- Closing the page in the middle of a quick match ------------------------

  const dee = await phone('dee');
  const eve = await phone('eve');
  for (const [page, name] of [[dee, 'Dee'], [eve, 'Eve']]) {
    await page.goto(`${base}#/match`, { waitUntil: 'networkidle2' });
    await page.type('input[autocomplete=nickname]', name);
    await click(page, 'Find an opponent');
  }
  await until(dee, () => sees(dee, '.scoreboard'), 'a match for Dee', 20000);
  await until(eve, () => sees(eve, '.scoreboard'), 'a match for Eve', 20000);
  // The game started long enough ago that only the leaving note matters.
  await db.query(`update encheres.rooms set seen_at = now() - interval '2 minutes' where matched and status = 'playing'`);
  await eve.close();
  await until(dee, async () => calls.leaving > 0, 'the leaving note from the closed page', 5000);
  await until(dee, async () => (await text(dee)).includes('Eve left the game. You win in'), 'the countdown', 20000);
  await snap(dee, 'match-left');
  await until(dee, () => sees(dee, '.final'), 'the win over a player who left', 30000);
  assert((await text(dee)).includes('Dee wins'), 'the player who stayed wins');
  console.log('PASS  quick match: closing the page loses within seconds');

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
  // Changing verse first: the other universes are offered, and picking one searches in it.
  assert(await click(solo, 'Change verse'), 'the verse can be changed after a game');
  const verses = await solo.$$eval('.again__modes button', (els) => els.map((e) => e.textContent.trim()));
  assert(verses.length >= 2, `other verses are offered (${verses})`);
  assert(await click(solo, verses[0]), 'a new search can be started in another verse');
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
  assert(await sees(solo, '.hero-card .avatar--none'), 'a profile without a picture shows the guest figure');
  assert((await text(solo)).includes('Under 500 trophies you can change your name any time'), 'the name rule is explained');
  // Pick a character with a card picture as the profile picture.
  await solo.evaluate(() => document.querySelector('.avatar-picker__choice .avatar--character img')?.closest('button').click());
  const picked = await solo.$eval('.avatar-picker__choice--on .avatar-picker__name', (e) => e.textContent);
  await click(solo, 'Save');
  await until(solo, async () => (await text(solo)).includes('Profile saved.'), 'the profile to be saved');
  assert(await sees(solo, '.hero-card .avatar--character img'), `the chosen face is shown on the profile (${picked})`);
  const stored0 = await db.query(`select avatar from encheres.profiles where name = 'Cam'`);
  assert(stored0.rows[0].avatar.length > 2, `a character id is stored (${stored0.rows[0].avatar})`);
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
  // Cam changed verse earlier; this check is about the mixed one.
  await solo.evaluate(() => localStorage.setItem('ae.mode', 'mix'));
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
  // Leave the finished match with the final screen's own button (not the bar's).
  for (const page of [ana, ben]) {
    await page.evaluate(() => [...document.querySelectorAll('.final__actions button')].find((b) => b.textContent === 'Home')?.click());
  }
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

  // --- Public rooms ------------------------------------------------------------

  // Ben opens a public room in One Piece; Ana finds it in the list and joins.
  await ben.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await until(ben, () => sees(ben, 'input[name=visibility]'), 'the room form');
  await ben.evaluate(() => {
    [...document.querySelectorAll('input[name=universe]')]
      .find((i) => i.closest('label').textContent.startsWith('One Piece'))
      .click();
    document.querySelectorAll('input[name=visibility]')[1].click();
  });
  await click(ben, 'Create the room');
  await until(ben, () => sees(ben, '.lobby__code'), 'the public lobby');
  assert((await text(ben)).includes('Public room'), 'the lobby says the room is public');
  const publicCode = await ben.$eval('.lobby__code', (e) => e.textContent.trim());

  await ana.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await until(ana, () => sees(ana, '.public-rooms__row'), 'the list of public rooms');
  const listed = await ana.$eval('.public-rooms__row', (e) => e.textContent);
  assert(listed.includes('One Piece') && listed.includes('Ben') && listed.includes('1/2'), `the room is listed (${listed})`);
  await snap(ana, 'public-rooms');
  await ana.evaluate(() => document.querySelector('.public-rooms__row button').click());
  await until(ana, () => sees(ana, '.lobby__code'), 'the lobby after joining from the list');
  assert((await ana.$eval('.lobby__code', (e) => e.textContent.trim())) === publicCode, 'joined the listed room');
  assert(await sees(ana, '.lobby__players .avatar'), 'players show their pictures in a public room');
  assert(await click(ana, 'Add friend'), 'other players can be added as friends');
  await until(ana, async () => (await text(ana)).includes('You are already friends.'), 'the answer to the request');
  await until(ben, () => click(ben, 'Start the game'), 'Ana to appear');
  await until(ben, () => sees(ben, '.scoreboard'), 'the public game');
  const solo2 = await phone('lister');
  await solo2.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await until(solo2, async () => (await text(solo2)).includes('No public rooms right now'), 'a started room leaves the list');
  console.log('PASS  public rooms: listed, joined from the list, friend request, gone once started');

  // --- 2v2 -----------------------------------------------------------------------

  const four = [await phone('t1'), await phone('t2'), await phone('t3'), await phone('t4')];
  const [t1, t2, t3, t4] = four;
  await t1.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await t1.type('input[autocomplete=nickname]', 'Tia');
  await t1.evaluate(() => {
    document.querySelectorAll('input[name=format]')[2].click();
    document.querySelectorAll('input[name=budget]')[0].click();
    document.querySelectorAll('input[name=teamSize]')[0].click();
  });
  await click(t1, 'Create the room');
  await until(t1, () => sees(t1, '.sides'), 'the 2v2 lobby');
  const teamCode = await t1.$eval('.lobby__code', (e) => e.textContent.trim());
  for (const [page, name] of [[t2, 'Uma'], [t3, 'Vic'], [t4, 'Wes']]) {
    await page.goto(`${base}#/room/${teamCode}`, { waitUntil: 'networkidle2' });
    await until(page, () => sees(page, 'input[autocomplete=nickname]'), 'the join form');
    await page.type('input[autocomplete=nickname]', name);
    await click(page, 'Join');
    await until(page, () => sees(page, '.sides'), 'the 2v2 lobby');
  }
  await until(t1, async () => (await t1.$$('.side li:not(.side__empty)')).length === 4, 'four players in the lobby');
  const sides = await t1.$$eval('.side', (els) => els.map((e) => [...e.querySelectorAll('li strong')].map((s) => s.textContent)));
  assert(JSON.stringify(sides) === JSON.stringify([['Tia', 'Vic'], ['Uma', 'Wes']]), `two sides of two (${JSON.stringify(sides)})`);
  await snap(t1, 'teams-lobby');
  await until(t1, () => click(t1, 'Start the game'), 'the start button');
  for (const page of four) await until(page, () => sees(page, '.scoreboard'), 'the 2v2 game');
  const sideOf = new Map([[t1, 0], [t3, 0], [t2, 1], [t4, 1]]);

  let teamRounds = 0;
  let sidesChecked = 0;
  const faceoffs = new Set();
  for (let step = 0; step < 500; step++) {
    if ((await Promise.all(four.map((p) => sees(p, '.final')))).every(Boolean)) break;
    let acted = false;
    for (const page of four) {
      if (await click(page, 'Draw a card')) {
        teamRounds++;
        const line = await page.$eval('.faceoff', (e) => e.textContent).catch(() => '');
        faceoffs.add(line);
        await until(page, async () => (await sees(page, '.stage .card--face')) || (await sees(page, '.stamp')), 'the drawn card');
        if (!(await sees(page, '.stamp'))) {
          const mate = four.find((p) => p !== page && sideOf.get(p) === sideOf.get(page));
          const rivals = four.filter((p) => sideOf.get(p) !== sideOf.get(page));
          await until(mate, async () => (await sees(mate, '.stage .card--face')) || (await sees(mate, '.stamp')), 'the teammate to see the card');
          if (!(await sees(mate, '.stamp'))) {
            assert((await text(mate)).includes('plays this round for your side') || (await text(mate)).includes('Only your side sees the card'), 'the teammate is told who plays');
            const round = await roundOf(page);
            for (const rival of rivals) {
              if ((await sees(rival, '.stamp')) || (await roundOf(rival)) !== round) continue;
              assert(!(await sees(rival, '.stage .card--face')), 'the other side does not see the card');
            }
            sidesChecked++;
          }
        }
        acted = true;
        break;
      }
      if (await sees(page, '.bid__actions button:not(:disabled)')) {
        await click(page, Math.random() < 0.6 ? 'Bid ' : 'Pass');
        acted = true;
        break;
      }
    }
    await sleep(acted ? 200 : 400);
  }
  for (const page of four) await until(page, () => sees(page, '.final'), 'the 2v2 final screen');
  const finalNames = await t2.$$eval('.team__head h2', (els) => els.map((e) => e.textContent));
  assert(finalNames.join('|') === 'Tia & Vic|Uma & Wes', `sides are named after their members (${finalNames})`);
  assert(teamRounds > 0 && sidesChecked > 0, 'the 2v2 game was played');
  assert(faceoffs.size >= 2, `different face-offs came up (${[...faceoffs].join('; ')})`);
  console.log(`PASS  2v2: four players, ${teamRounds} rounds, ${faceoffs.size} face-offs, the drawing side sees the card (${sidesChecked} checks)`);

  // --- 1v1v1 room --------------------------------------------------------------

  const trio = [await phone('r1'), await phone('r2'), await phone('r3')];
  const [r1, r2, r3] = trio;
  await r1.goto(`${base}#/online`, { waitUntil: 'networkidle2' });
  await r1.type('input[autocomplete=nickname]', 'Xia');
  await r1.evaluate(() => {
    document.querySelectorAll('input[name=format]')[1].click();
    document.querySelectorAll('input[name=budget]')[0].click();
    document.querySelectorAll('input[name=teamSize]')[0].click();
  });
  await click(r1, 'Create the room');
  await until(r1, () => sees(r1, '.lobby__code'), 'the 1v1v1 lobby');
  const trioCode = await r1.$eval('.lobby__code', (e) => e.textContent.trim());
  for (const [page, name] of [[r2, 'Yan'], [r3, 'Zoe']]) {
    await page.goto(`${base}#/room/${trioCode}`, { waitUntil: 'networkidle2' });
    await until(page, () => sees(page, 'input[autocomplete=nickname]'), 'the join form');
    await page.type('input[autocomplete=nickname]', name);
    await click(page, 'Join');
    await until(page, () => sees(page, '.lobby__code'), 'the 1v1v1 lobby');
  }
  await until(r1, () => click(r1, 'Start the game'), 'three players in the lobby');
  for (const page of trio) await until(page, () => sees(page, '.scoreboard--three'), 'the 1v1v1 board');
  await snap(r2, 'trio-board');
  let trioRounds = 0;
  for (let step = 0; step < 600; step++) {
    if ((await Promise.all(trio.map((p) => sees(p, '.final')))).every(Boolean)) break;
    let acted = false;
    for (const page of trio) {
      if (await click(page, 'Draw a card')) {
        trioRounds++;
        await until(page, async () => (await sees(page, '.stage .card--face')) || (await sees(page, '.stamp')), 'the drawn card');
        if (!(await sees(page, '.stamp'))) {
          const round = await roundOf(page);
          for (const other of trio.filter((p) => p !== page)) {
            // A screen still showing the last result has that card face up: only
            // screens on this round's auction count.
            if ((await sees(other, '.stamp')) || (await roundOf(other)) !== round) continue;
            assert(!(await sees(other, '.stage .card--face')), 'only the drawer sees the card');
          }
        }
        acted = true;
        break;
      }
      if (await sees(page, '.bid__actions button:not(:disabled)')) {
        await click(page, Math.random() < 0.5 ? 'Bid ' : 'Pass');
        acted = true;
        break;
      }
    }
    await sleep(acted ? 200 : 400);
  }
  for (const page of trio) await until(page, () => sees(page, '.final'), 'the 1v1v1 final screen');
  const trioTeams = await r3.$$eval('.team__head h2', (els) => els.map((e) => e.textContent));
  assert(trioTeams.length === 3 && trioTeams.every((n) => /^(1st|2nd|3rd)/.test(n)), `three teams with places (${trioTeams})`);
  await snap(r3, 'trio-final');
  console.log(`PASS  1v1v1 room: three players, ${trioRounds} rounds, only the drawer sees the card, places shown`);

  // --- 1v1v1 on one device ---------------------------------------------------------

  const couch = await phone('couch');
  await couch.goto(`${base}#/local`, { waitUntil: 'networkidle2' });
  await couch.evaluate(() => document.querySelectorAll('input[name=opponent]')[1].click());
  await until(couch, async () => (await couch.$$('.form__trio input')).length === 3, 'three name fields');
  const nameFields = await couch.$$('.form__trio input');
  for (const [i, name] of ['Ann', 'Bob', 'Cid'].entries()) await nameFields[i].type(name);
  await click(couch, 'Start the game');
  await until(couch, () => sees(couch, '.scoreboard--three'), 'the offline 1v1v1 board');
  const seated = await couch.$$eval('.player__name', (els) => els.map((e) => e.textContent));
  assert(seated.join('|') === 'Ann|Bob|Cid', `three players on one device (${seated})`);
  assert(await click(couch, 'Draw a card'), 'the first player can draw');
  console.log('PASS  1v1v1 on one device: three names, three teams');

  // --- Ranked 1v1v1 ------------------------------------------------------------

  const lone = await phone('lone');
  await lone.goto(`${base}#/match`, { waitUntil: 'networkidle2' });
  await until(lone, () => sees(lone, 'input[name=format]'), 'the quick-match page');
  await lone.type('input[autocomplete=nickname]', 'Lou');
  await lone.evaluate(() => {
    document.querySelectorAll('input[name=format]')[1].click();
  });
  await until(lone, async () => (await text(lone)).includes('One 1v1v1 ranking'), 'the 1v1v1 explanation');
  await lone.evaluate(() => {
    [...document.querySelectorAll('input[name=mode]')].find((i) => i.closest('label').textContent.startsWith('Bleach')).click();
  });
  await click(lone, 'Find an opponent');
  await until(lone, async () => (await text(lone)).includes('1v1v1 · Bleach'), 'the 1v1v1 search');
  // Nobody else is looking: two players join from the server.
  await until(lone, () => sees(lone, '.scoreboard--three'), 'a 1v1v1 game', 40000);
  const trioRoom = (
    await db.query(`select code, bot_seats from encheres.rooms where format = 'trio' and matched order by created_at desc limit 1`)
  ).rows[0];
  assert(trioRoom.bot_seats.length === 2, `two seats filled from the server (${trioRoom.bot_seats})`);
  assert(!/computer|ordinateur/i.test(await text(lone)), 'the 1v1v1 board does not mention the computer');
  await snap(lone, 'trio-ranked');
  await click(lone, 'Forfeit');
  await until(lone, () => click(lone, 'Confirm forfeit'), 'the confirmation');
  await until(lone, () => sees(lone, '.final'), 'the 1v1v1 final screen', 20000);
  const places = await lone.$$eval('.team__head h2', (els) => els.map((e) => e.textContent));
  assert(places.length === 3 && places.some((p) => p.startsWith('3rd') && p.includes('Lou')), `the player who gave up is last (${places})`);
  await until(lone, async () => /trophies/i.test(await text(lone)), 'the 1v1v1 trophy line');
  assert(await sees(lone, '.again'), 'play again is offered');
  assert((await text(lone)).includes('Play again: 1v1v1 · Bleach'), 'play again in the same 1v1v1 queue');
  console.log('PASS  ranked 1v1v1: queue by universe, two stand-ins, giving up places last, trophies');

  // --- Home ---------------------------------------------------------------------

  await solo.goto(`${base}#/`, { waitUntil: 'networkidle2' });
  const buttons = await solo.$$eval('.home__modes .btn--mode', (els) => els.map((e) => e.firstChild.textContent));
  assert(buttons.join('|') === 'Play online|Play offline', `home offers online first, then offline (${buttons})`);
  assert(await solo.$eval('.home__modes .btn--mode', (e) => e.classList.contains('btn--primary')), 'online is highlighted');
  await snap(solo, 'home');
  console.log('PASS  home: play online first, one offline entry');

  // --- Characters and How to play ----------------------------------------------

  await solo.goto(`${base}#/characters`, { waitUntil: 'networkidle2' });
  assert((await solo.$$('.chars__row')).length === 100 && (await text(solo)).includes(`The 100 strongest of ${CHARACTER_COUNT}`), 'the top 100 of everyone');
  await click(solo, 'One Piece');
  await until(solo, async () => (await solo.$eval('.chars__row .chars__power strong', (e) => e.textContent)) === '100', 'One Piece on its own scale');
  // textContent: rows below the fold are skipped by innerText (content-visibility).
  assert((await solo.$eval('.chars__overall', (e) => e.textContent)) === '#48 across all', 'the strongest of One Piece shows its overall rank');
  assert((await solo.$$('.chars__row')).length === ONE_PIECE_COUNT, 'only One Piece characters');
  await snap(solo, 'characters');
  await solo.goto(`${base}#/rules`, { waitUntil: 'networkidle2' });
  const firstCaption = await solo.$eval('.demo__caption', (e) => e.textContent);
  await until(solo, async () => (await solo.$eval('.demo__caption', (e) => e.textContent)) !== firstCaption, 'the demo to move on by itself', 8000);
  await snap(solo, 'rules');
  // A card opens up close; the bar at the top always offers a way back.
  await solo.goto(`${base}#/characters`, { waitUntil: 'networkidle2' });
  await until(solo, () => sees(solo, '.chars__card'), 'the characters');
  await solo.evaluate(() => document.querySelector('.chars__card').click());
  await until(solo, () => sees(solo, 'dialog[open] .card--xl'), 'the card up close');
  await solo.keyboard.press('Escape');
  await until(solo, async () => !(await sees(solo, 'dialog[open]')), 'the card to close');
  await solo.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bar = await solo.$eval('.topbar__back', (e) => [e.textContent, e.getBoundingClientRect().top]);
  assert(bar[0].includes('Back') && bar[1] >= 0 && bar[1] < 80, `the back button stays at the top (${bar})`);
  console.log('PASS  characters on each universe scale; how-to-play demo plays');

  // --- Dark theme, notices -------------------------------------------------------

  // The theme switch is the button with the sun/moon icon.
  await solo.evaluate(() => document.querySelector('.topbar .icon-btn:has(.theme-icon)').click());
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
