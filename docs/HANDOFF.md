# Handoff

Everything a new person or a new AI session needs to continue this project without the
conversation that built it. Read this first, then `docs/ARCHITECTURE.md` for the reasons
behind each design.

## What this is

A web game based on the French TikTok "enchères animés" format. Two players build teams of
anime characters by auction. Each round one player draws a card and sees it, the other
does not, and both bid from a fictional budget (500M by default). The drawer can bluff.
When the cards run out, the stronger team wins.

The English name is **Anime Auction Draft**; the French name, used when the interface is
in French, is **Enchères Animés**. The repository and URLs keep `anime-encheres`.

## Where everything lives

| Thing | Where |
| --- | --- |
| Live site | https://anime-encheres.netlify.app |
| Source | https://github.com/Faryaan-Khan/anime-encheres (branch `main`) |
| Hosting | Netlify, builds and deploys every push to `main` |
| Database | Supabase project `iwlmrwwuslebvaqjahnt` (URL and publishable key are in `.env`; both are public by design) |
| Edge Function | `opponent` in the same Supabase project: the stronger computer opponent |
| CI | GitHub Actions: type check, tests, build (`.github/workflows/ci.yml`) |

Nothing runs on anyone's computer or browser. The site is served by Netlify and the game
state lives in Supabase, so the game keeps working whatever happens to the machine it was
built from. The only manual step in the whole system is applying a new database migration
(see "Changing the database").

## Working on it

```
npm install
npm run dev          # local site, talks to the live database through .env
npm run typecheck    # TypeScript strict
npm test             # 207 unit and database tests (no external service needed)
npm run test:e2e     # real browsers against the real SQL; needs Chrome (CHROME_PATH)
npm run ratings      # after editing src/data/rosters.json
npm run build:opponent  # after editing src/bot/: rebuild the Edge Function bundle
npm run build
```

To ship a change: commit, push to `main`, wait for CI, and Netlify deploys within about a
minute. If the change needs new database functions, apply the migration **before** pushing
the client that calls them.

### Conventions

- TypeScript strict, React function components, plain CSS in `src/styles.css`.
- Every user-facing string is in `src/i18n/strings.ts`, in French and English. The
  dictionaries are typed: a missing key does not compile.
- Routes are hash routes (`#/match`, `#/room/CODE`); see `src/router.ts`.
- Commits are authored as `Faryaan Khan <Faryaan-Khan@users.noreply.github.com>`. The
  owner's personal email must not appear in the repository.
- No copyrighted or fan-made character art. Cards are drawn from the name; pictures the
  owner has the right to use can be dropped in `src/assets/cards/`.
- Documentation is part of the work: update the relevant file in `docs/` in the same
  commit as the code.

## Map of the code

```
src/game/        The rules as a pure engine (engine.ts), shared types, the team verdict
src/data/        Characters and power ratings (rosters.json is the source of truth)
src/bot/         Offline computer opponent; styleForSkill mirrors the online one
src/local/       Same-device and offline play, saved in the browser
src/online/      Supabase calls: api.ts (rooms, matchmaking), profile.ts (profile,
                 leaderboards, friends, feedback), account.ts (Google sign-in),
                 useOnlineRoom.ts (sync)
src/match/       Quick-match settings and the list of ranked modes
src/screens/     One file per screen
src/components/  Board, cards, bid controls, final screen, avatar
src/ranking.ts   Leagues, badges and the overall-score formula (display side)
src/theme.ts     Light/dark theme
src/sound.ts     Sound effects, synthesized with Web Audio (no audio files)
supabase/functions/opponent/   Edge Function: the look-ahead opponent (bundle.js is generated)
supabase/migrations/   The database, in order (below)
supabase/tests/        Database tests, run in PGlite (Postgres in WebAssembly)
e2e/online.e2e.mjs     Browser test: several isolated browsers play through the real UI
scripts/ratings.mjs    Generates docs/POWER_RATINGS.md, the CSV and migration 0004
```

## The database

All tables are in the `encheres` schema, which the API does not expose. Row-level security
is on with no policies. The browser can only call `SECURITY DEFINER` functions in
`public`, and each of them checks who is calling. This is what keeps the hidden card
hidden and the rankings honest; do not add direct table access.

Migrations, to be run in this order in the Supabase SQL editor. All are idempotent.

| File | Adds |
| --- | --- |
| `0001_init.sql` | Rooms, players, the rules of the auction (`play`), private rooms |
| `0002_matchmaking.sql` | Quick-match queue, turn clock, resign and forfeit |
| `0003_ranking.sql` | Profiles, match records, feedback, rate limits, server-side verdict |
| `0004_character_powers.sql` | Generated. Every card's power and universe. Re-run after rating changes |
| `0005_accounts_and_opponent.sql` | Recovery codes, sign-in linking, the computer opponent played by the database, `encheres.config` |
| `0006_modes_and_friends.sql` | One queue, rating and leaderboard per mode, overall score, friends, invitations |
| `0007_seasons.sql` | Monthly seasons from zero, `season_results` history, rights-request feedback |
| `0008_opponent_brain.sql` | pg_net hand-off of strong opponents' bids to the Edge Function, with fallback |
| `0009_google_accounts.sql` | Guest to Google: keep the guest or start fresh |
| `0010_fair_play.sql` | Automatic draw for a player who cannot buy, presence (`seen_at`, `leaving`), 30 s clock with 3 strikes enforced in `get_room`; `play` split into `encheres.play_as` |
| `0011_autopilot.sql` | A player who cannot buy any more is never forfeited (leaving, disconnecting or "Forfeit"); the computer finishes at once; results move on after 12 s; `encheres.sweep_games()` every minute via pg_cron; leaderboard top 1000 plus the player's neighbours (`around`) |

Functions the client calls:

| Function | Purpose |
| --- | --- |
| `create_room`, `join_room`, `start_game` | Private rooms |
| `get_room`, `play` | Read the room as one seat sees it; draw, bid, pass, next |
| `find_match`, `leave_queue`, `resign` | Quick match in a mode |
| `leaving` | Beacon from a closing page: the player counts as gone after about 8 s |
| `claim_forfeit` | Old clients only; the server now ends timed-out and abandoned games itself |
| `get_profile`, `update_profile` | The player's profile, per-mode trophies, recent games |
| `leaderboard` | Overall or one mode; world, one country, or friends |
| `get_friends`, `add_friend`, `answer_friend`, `remove_friend` | Friends by player tag |
| `invite_friend`, `dismiss_invite` | Invitations to a private room |
| `recovery_code`, `redeem_code` | Keeping a profile across devices with a code |
| `link_account(token, intent)` | After Google sign-in: `link` keeps the guest, `fresh` starts a new account; answers `linked`, `created`, `switched` or `already` |
| `send_feedback` | The feedback form (also rights requests) |
| `opponent_claim` | Used only by the Edge Function, with a one-time secret from the database |

Tables: `rooms`, `room_players`, `profiles`, `devices`, `ratings` (trophies per mode),
`season_results` (each finished season per player and mode), `matches` (every finished
online game with its action log), `friends`, `invites`, `feedback`, `characters`,
`config`, `rate_limits`.

Settings that can be changed without a migration are rows of `encheres.config`:
`opponent_enabled`, `opponent_after_seconds`, `opponent_pace`, `opponent_function_url`
(`null` turns the Edge Function off), `opponent_lookahead_from` (skill from which it is
used, 0.6), `season` (managed by the server).

To read player feedback: Supabase, Table Editor, schema `encheres`, table `feedback`.

### Changing the database

1. Write a new numbered file in `supabase/migrations/`. Make it safe to run twice (the
   tests apply every migration twice).
2. Add it to `MIGRATIONS` in `supabase/tests/helpers.ts` and to the list in
   `e2e/online.e2e.mjs`, and test.
3. Commit and push it, then paste it into the Supabase SQL editor and run it. The editor
   warns about "destructive operations" whenever a script contains `drop`, `revoke` or
   `delete`; read what the script drops before confirming.
4. Only then push the client code that needs it.

Things that have bitten this project, so that they do not again:

- **Old clients stay open in people's browsers.** Keep existing function names and
  parameters working. When a function gains a parameter, give it a default and drop the
  old signature, otherwise PostgREST sees two overloads.
- **An error undoes the rate-limit counter.** `encheres.hit` counts calls, but an
  exception rolls the count back. Functions that must count failed attempts
  (`redeem_code`, `add_friend`) return a status instead of raising.
- **A statement does not see its own writes.** In `roll_season`, updating ratings and
  recomputing overall scores in one statement used the old ratings. Use two statements.
- **Where the latest version of a function lives.** Later migrations replace functions
  from earlier ones. As of 0011: the auction rules are `encheres.play_as` (0010; `public.play`
  only maps the token to a seat), `room_view` and `get_room` are in 0010,
  `end_by_forfeit` and `settle_match` in 0003; `enforce`, `bot_step`, `leaderboard`,
  `resign` and `sweep_abandoned` in 0011. Copy from the newest file when replacing one.
- **Rules exist in two languages.** The auction (TypeScript engine and SQL `play_as`) and
  the rule-based opponent (TypeScript `byRules` and SQL `bot_choice`) are each kept in
  step by a test that plays whole games and compares every step. If you change one side,
  change the other; the test will tell you.
- **Floating point.** The opponent's arithmetic is written with explicit
  `double precision` casts and the same order of operations as the TypeScript, so that
  both round the same way. Keep that when editing.
- **The site's content policy** (`netlify.toml`) names the Supabase host. A new backend
  host must be added to `connect-src` or the browser blocks it.

## How the main pieces work

Short versions; details and reasons are in `docs/ARCHITECTURE.md`.

- **Identity.** Each browser generates a random token and the server stores only its
  hash. A profile is created on first use. More devices are attached to a profile with a
  recovery code, or with a one-time Google sign-in (guest kept, or a fresh account).
- **Ranked modes.** A quick match is played in one mode: a single universe, or `mix`. The
  server deals from its own card list. Trophies, leagues and leaderboards are per mode.
- **Trophies.** +30 for a win against an equal, between +10 and +50 depending on the gap;
  -26 for a loss, between -8 and -44; never below zero. The server computes the winner
  from its own copy of the power ratings.
- **Overall score.** A weighted average of a player's trophies over every mode. `mix`
  counts double; a mode never played counts as zero. With seven universes that is nine
  shares. It is what the world ranking and the profile headline show.
- **Seasons.** On the first of each month (UTC) every rating and overall score returns
  to 0, after each player's result for the month is filed in `season_results`. It
  happens the first time anyone calls the server in the new month. All-time bests are
  kept; the profile shows records and past seasons.
- **Computer opponent online.** If nobody is found in 12 to 18 seconds, the database
  seats an opponent with an ordinary name and plays its moves when the player's device
  polls. Players are not told; this was the owner's decision. Its skill follows the
  player's trophies in that mode. `opponent_enabled` turns it off. From skill 0.6 its
  bids come from the Edge Function's look-ahead player (about 63% against the offline
  hard level); below that, or if the function does not answer within 6 seconds, from
  the SQL rule-based player.
- **Cards and presentation.** Rarity frames (Common to Mythic, Apex for each universe's
  strongest) are CSS only. Dark theme, synthesized sounds and effects are described in
  `docs/ARCHITECTURE.md`.
- **Fair play in quick matches.** 30 seconds per move; when time is up the server moves
  for the slow player (draw or pass) and gives a strike, and the third strike loses. A
  player not heard from for 40 seconds has left and loses; closing the page sends a
  `leaving` beacon that cuts this to about 8 seconds. All of it runs inside `get_room`, so
  no scheduler is needed and nobody has to claim a win. A player who can no longer buy
  (full team, or less than the minimum bid) never holds the other up: their card is drawn
  for them, in every kind of game.
- **Finished players and the autopilot.** A player who cannot buy any more (team full,
  or less money than the minimum bid) is only watching: the board says so, results move
  on after 1.5 s instead of 5, and "Leave (result still counts)" replaces "Forfeit". The
  server never counts them as gone and `resign` from them is not a forfeit, so the
  match is played out and settled, trophies included, without them. Against the
  computer (online and offline) the computer then finishes its team at once and the
  final screen follows. Every result moves on by itself after a countdown on the button
  (`NextButton` in `Board.tsx`); between two people the server moves on after 12 s as a
  backstop. `encheres.sweep_games()` runs every minute through pg_cron
  (job `encheres-sweep`) so games nobody is looking at still end and are settled.
- **Leaderboards** show the top 1000; a player below that gets `around`: themselves and
  the players directly above and below, shown after a gap.
- **Friends.** Players exchange a seven-character tag. A request must be accepted. There
  is a friends leaderboard, and the host of a private room can invite a friend, who sees
  the invitation on the home screen.

## State of things

Done and live: same-device and offline play against two computer levels; private online
rooms; quick matches in eight modes with a 30-second clock, strikes, automatic wins over players who leave, and an autopilot that settles the match once a player cannot buy any more; server-played opponent; profiles
with statistics, badges, avatar and country; leaderboards (overall, per mode, friends,
country); monthly seasons from zero with history; recovery codes; friends and
invitations; feedback form with rights requests; match recording; stronger opponent in
an Edge Function; rarity cards; dark theme; sound; security headers; French and English.

Google sign-in is on and the Google app is published (not "Testing"). Branding: app name
"Anime Auction Draft", logo `public/logo.svg` (PNG sizes made by `npm run logo`), home
page, `public/privacy.html` and `public/terms.html`. Authorized domains: only
`anime-encheres.netlify.app` (the Supabase callback host was removed so that every listed
domain can be verified; sign-in was checked to still reach Google's account chooser).
Google shows the name and logo only after brand verification; until then it shows the
supabase.co callback address. The site is verified in Google Search Console with
`public/google5ef95c3ea69c5ef4.html`, which must stay. The first brand check (17 Nov 2026)
only reported that the home page was not yet registered to the owner, because Search
Console needs 24 hours to propagate; re-request verification on the Branding page ("View
issues", "I have fixed the issues"). If Google later objects to the supabase.co address
on the sign-in screen, the remaining fix is a Supabase custom domain (paid).

Google sign-in details: Everyone starts as a guest; a guest can keep their progress with
Google (`link`) or start a new Google account and delete the guest (`fresh`), and a
Google account that already has a profile simply opens on the device. "Sign out on this
device" starts a new guest and leaves the account untouched. The redirect to Google and
the provider settings were checked live; a full sign-in needs a person to choose a
Google account, so test it by hand after changes.

### Open decisions (the owner's)

- **English name.** Chosen: Anime Auction Draft. It is close to "Ultimate Auction Draft",
  an existing 1v1 anime auction game; no trademark search has been done.
- **Repository visibility.** Public today, with an all-rights-reserved licence.
- **App stores, donations, paid features, in-game currency.** Deferred by the owner.
- **Character rights.** Names only, no artwork. Draft Anime (draftanime.com), which the
  owner pointed to, shows character pictures and relies on a fan-made disclaimer, a
  statement that franchise material belongs to its owners, and a DMCA/rights-request
  process. This game has the same notices (`#/legal`, footer, a "rights" feedback topic)
  but deliberately no pictures: a disclaimer and a takedown route reduce risk, they do
  not grant the right to use the art. Pictures can be dropped into `src/assets/cards/`
  only if the owner has the rights to them.
- **When to switch off the computer opponent.** The owner's idea is once there are
  enough players (he mentioned about ten thousand).

### Ideas discussed and not built

- A learning opponent trained on the recorded matches (`encheres.matches.log`).
- Cheat detection from the same records.
- "Undercover" and dice variants, spectators.
- Teaching the online opponent from recorded games, or letting it learn each player's
  bluffing during a match (the offline levels already do the latter; the Edge Function
  starts each decision with a neutral guess).

### Known limits

- A recovery code is a bearer secret: whoever has it can open the profile.
- Rate limits are per device and per network address; they slow abuse, they do not stop
  a determined attacker with many addresses.
- Front-end code is public, as on any website. The rules, the ratings and the data are
  on the server, which is what a copy would lack.
- Supabase pauses free projects after about a week without activity.
- Statistics (games, wins, streaks) are global; only trophies are per mode.
- The Edge Function is deployed by pasting `bundle.js` in the dashboard; it is not
  redeployed by CI. Rebuild and redeploy it when `src/bot/` changes.
- Sound needs one tap on the page before browsers allow it.
