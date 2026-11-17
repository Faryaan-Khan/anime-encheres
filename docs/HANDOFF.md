# Handoff

Everything a new person or a new AI session needs to continue this project without the
conversation that built it. Read this first, then `docs/ARCHITECTURE.md` for the reasons
behind each design.

## What this is

A web game based on the French TikTok "enchères animés" format. Two players build teams of
anime characters by auction. Each round one player draws a card and sees it, the other
does not, and both bid from a fictional budget (500M by default). The drawer can bluff.
When the cards run out, the stronger team wins.

The French name is **Enchères Animés**. An English name has not been chosen (see
"Open decisions").

## Where everything lives

| Thing | Where |
| --- | --- |
| Live site | https://anime-encheres.netlify.app |
| Source | https://github.com/Faryaan-Khan/anime-encheres (branch `main`) |
| Hosting | Netlify, builds and deploys every push to `main` |
| Database | Supabase project `iwlmrwwuslebvaqjahnt` (URL and publishable key are in `.env`; both are public by design) |
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
npm test             # 179 unit and database tests (no external service needed)
npm run test:e2e     # real browsers against the real SQL; needs Chrome (CHROME_PATH)
npm run ratings      # after editing src/data/rosters.json
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
| `0006_modes_and_friends.sql` | One queue, rating and leaderboard per mode, overall score, monthly seasons, friends, invitations |

Functions the client calls:

| Function | Purpose |
| --- | --- |
| `create_room`, `join_room`, `start_game` | Private rooms |
| `get_room`, `play` | Read the room as one seat sees it; draw, bid, pass, next |
| `find_match`, `leave_queue`, `resign`, `claim_forfeit` | Quick match in a mode |
| `get_profile`, `update_profile` | The player's profile, per-mode trophies, recent games |
| `leaderboard` | Overall or one mode; world, one country, or friends |
| `get_friends`, `add_friend`, `answer_friend`, `remove_friend` | Friends by player tag |
| `invite_friend`, `dismiss_invite` | Invitations to a private room |
| `recovery_code`, `redeem_code`, `link_account` | Keeping a profile across devices |
| `send_feedback` | The feedback form |

Tables: `rooms`, `room_players`, `profiles`, `devices`, `ratings` (trophies per mode),
`matches` (every finished online game with its action log), `friends`, `invites`,
`feedback`, `characters`, `config`, `rate_limits`.

Settings that can be changed without a migration are rows of `encheres.config`:
`opponent_enabled`, `opponent_after_seconds`, `opponent_pace`, `season`.

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
- **Rules exist in two languages.** The auction (TypeScript engine and SQL `play`) and
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
  recovery code, or with a one-time Google sign-in once that provider is configured.
- **Ranked modes.** A quick match is played in one mode: a single universe, or `mix`. The
  server deals from its own card list. Trophies, leagues and leaderboards are per mode.
- **Trophies.** +30 for a win against an equal, between +10 and +50 depending on the gap;
  -26 for a loss, between -8 and -44; never below zero. The server computes the winner
  from its own copy of the power ratings.
- **Overall score.** A weighted average of a player's trophies over every mode. `mix`
  counts double; a mode never played counts as zero. With seven universes that is nine
  shares. It is what the world ranking and the profile headline show.
- **Seasons.** On the first of each month, every rating above 2200 (the Legend entrance)
  returns to 2200. It happens the first time anyone calls the server in the new month.
- **Computer opponent online.** If nobody is found in 12 to 18 seconds, the database
  seats an opponent with an ordinary name and plays its moves when the player's device
  polls. Players are not told; this was the owner's decision. Its skill follows the
  player's trophies in that mode. `opponent_enabled` turns it off.
- **Friends.** Players exchange a seven-character tag. A request must be accepted. There
  is a friends leaderboard, and the host of a private room can invite a friend, who sees
  the invitation on the home screen.

## State of things

Done and live: same-device and offline play against two computer levels; private online
rooms; quick matches in eight modes with a turn clock; server-played opponent; profiles
with statistics, badges, avatar and country; leaderboards (overall, per mode, friends,
country); monthly Legend reset; recovery codes; friends and invitations; feedback form;
match recording; security headers; French and English.

Built but switched off: Google sign-in. It needs an OAuth client created in the owner's
Google Cloud account and its id and secret entered in Supabase (steps in
`docs/DEPLOYMENT.md`), then `VITE_GOOGLE_SIGN_IN=true` in `.env`. It has database tests
but has not been exercised against the live provider.

### Open decisions (the owner's)

- **English name.** "AniDraft" is taken: there is an app of that name on Google Play in
  the same genre. "Anime Draft" is the generic name of the trend and used by several
  sites. A new candidate is needed before any rename.
- **Repository visibility.** Public today, with an all-rights-reserved licence.
- **App stores, donations, paid features, in-game currency.** Deferred by the owner.
- **Character rights.** Names only, no artwork. The owner intends to revisit this before
  any commercial step.
- **When to switch off the computer opponent.** The owner's idea is once there are
  enough players (he mentioned about ten thousand).

### Ideas discussed and not built

- A learning opponent trained on the recorded matches (`encheres.matches.log`).
- Cheat detection from the same records.
- "Undercover" and dice variants, spectators.
- Moving the stronger look-ahead opponent online (it would need a server runtime such as
  a Supabase Edge Function; a database function is too slow for it).

### Known limits

- A recovery code is a bearer secret: whoever has it can open the profile.
- Rate limits are per device and per network address; they slow abuse, they do not stop
  a determined attacker with many addresses.
- Front-end code is public, as on any website. The rules, the ratings and the data are
  on the server, which is what a copy would lack.
- Supabase pauses free projects after about a week without activity.
- Statistics (games, wins, streaks) are global; only trophies are per mode.
