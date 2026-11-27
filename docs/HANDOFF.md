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
| Live site | https://anime-encheres.pages.dev (Cloudflare Pages). The old address, https://anime-encheres.netlify.app, still serves an older build until it can be turned into a redirect |
| Source | https://github.com/Faryaan-Khan/anime-encheres (branch `main`) |
| Hosting | Cloudflare Pages (account faryaank@gmail.com, project `anime-encheres`), builds and deploys every push to `main`; headers in `public/_headers` |
| Database | Supabase project `iwlmrwwuslebvaqjahnt` (URL and publishable key are in `.env`; both are public by design) |
| Edge Function | `opponent` in the same Supabase project: the stronger computer opponent |
| CI | GitHub Actions: type check, tests, build (`.github/workflows/ci.yml`) |

Nothing runs on anyone's computer or browser. The site is served by Cloudflare Pages and the game
state lives in Supabase, so the game keeps working whatever happens to the machine it was
built from. The only manual step in the whole system is applying a new database migration
(see "Changing the database").

## Working on it

```
npm install
npm run dev          # local site, talks to the live database through .env
npm run typecheck    # TypeScript strict
npm test             # 257 unit and database tests (no external service needed)
npm run test:e2e     # real browsers against the real SQL; needs Chrome (CHROME_PATH)
npm run ratings      # after editing src/data/rosters.json
npm run build:opponent  # after editing src/bot/: rebuild the Edge Function bundle
npm run build
```

To ship a change: commit, push to `main`, wait for CI, and Cloudflare Pages deploys within
about a minute. If the change needs new database functions, apply the migration **before** pushing
the client that calls them.

### Conventions

- TypeScript strict, React function components, plain CSS in `src/styles.css`.
- Every user-facing string is in `src/i18n/strings.ts`, in French and English. The
  dictionaries are typed: a missing key does not compile.
- Routes are hash routes (`#/match`, `#/room/CODE`); see `src/router.ts`.
- Commits are authored as `Faryaan Khan <Faryaan-Khan@users.noreply.github.com>`. The
  owner's personal email must not appear in the repository.
- Commit messages carry no AI co-author or session lines (no `Co-Authored-By: Claude`,
  no `Claude-Session:`). The owner asked for this on 23 Nov 2026, and the whole history
  was rewritten that day to remove the ones already there (old commit ids changed).
- Card pictures: website only (see "Character rights" below). They live in
  `src/assets/cards/<character-id>.webp`, each recorded in `CREDITS.md` there; cards
  without one are drawn from the name. Build app versions with `VITE_CARD_IMAGES=off`.
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
| `0012_passes_and_scales.sql` | Whole-pool decks, 3 passes per player (`rooms.pass_limit`, `room_players.passes`, `encheres.can_pass`), strikes reset by the player's own move (time-outs in a row), `rooms.scale` for display |
| `0013_old_site_and_auto_bid.sql` | A player out of passes facing a card nobody bid on gets the minimum bid after 5 s (`enforce`, any room, no strike). Temporary: requests from the old Netlify address (older client) may pass without limit (`encheres.old_client`, `room_players.old_site`) |
| `0014_seasons_names_avatars.sql` | Season brackets (`season_floor`: below 500 kept, else 500 / 999 / 1499 / 1999), name rules (`name_state`: free below 500, once per 30 days from 500, locked forever from the Legend league; `legend_at` recorded), profile picture = a character id or '' (`profiles.avatar` is text), auto-bid after 8 s |
| `0015_public_rooms.sql` | Public rooms: `rooms.public`, `rooms.verse`, `public.public_rooms` (open lobbies whose host was heard from in the last minute); `create_room` gains `p_public` and `p_verse`; in public rooms `room_view` adds each player's `tag` and `avatar` (never in other rooms, so stand-ins are not given away) |
| `0016_team_rooms.sql` | 2v2 rooms (`rooms.format` = `duel`/`teams`/`trio`, `rooms.lineup`, table `room_members` for each side's second member). `seat_of` also finds teammates; `member_of`, `active_member`, `new_lineup`, `free_slots`, `take_slot`, `free_place`; `switch_side`, `leave_room`; `join_room`, `start_game`, `play`, `get_room`, `leaving`, `create_room` (`p_format`), `public_rooms` and `room_view` replaced (views carry `format`, and for teams `members`, `active`, `youMember`) |
| `0017_three_players.sql` | 1v1v1: seats 0–2 (constraints widened), `play_as` and `begin_game` for two or three players (next seat = `(seat + 1) % n`; sold once everyone but the high bidder has passed), `create_room` accepts `trio`, `settle_trio` records trio games with `matches.places` and `profile2` (no trophies) |
| `0018_ranked_trio.sql` | Ranked 1v1v1: `find_trio` (queue per universe, stand-ins fill empty seats after the usual wait: `trio_fill`), `rooms.bot_seats` and `left_seats`, `enforce_trio`, `bot_step_trio`, `trio_leave`, `trio_finish`, `trio_bot_move`, `bot_choice_seat` (bot_choice for any seat); `settle_trio` ranks (givers-up last) and moves the single `trio` rating (pairwise win/loss, averaged). `is_mode('trio')`, `total_weight` + 1 (overall over 10 shares). `enforce`, `bot_step`, `resign`, `leave_queue` branch off for 1v1v1 and are otherwise as before |
| `0019_friends_after_match.sql` | `add_friend_seat` (friend request from the results screen by seat/member; to a stand-in it is stored in `ghost_requests` and shown as sent, never answered), `decline_all_friends`, `friends_json` and `remove_friend` with ghost requests; `bot_step`, `bot_step_trio`: the computer keeps its pace while the player watches and finishes at once only after `watching_seconds()` (15) without a poll; `resign` finishes a game against the computer at once for a player who can no longer buy |

Functions the client calls:

| Function | Purpose |
| --- | --- |
| `create_room`, `join_room`, `start_game` | Private rooms |
| `get_room`, `play` | Read the room as one seat sees it; draw, bid, pass, next |
| `public_rooms` | Public rooms waiting for players |
| `switch_side`, `leave_room` | 2v2 lobby: change side; give up a place in a lobby |
| `find_match`, `leave_queue`, `resign` | Quick match in a mode |
| `find_trio` | Ranked 1v1v1 in a universe (or mix); `leave_queue` and `resign` work for it too |
| `leaving` | Beacon from a closing page: the player counts as gone after about 8 s |
| `claim_forfeit` | Old clients only; the server now ends timed-out and abandoned games itself |
| `get_profile`, `update_profile` | The player's profile, per-mode trophies, recent games |
| `leaderboard` | Overall or one mode; world, one country, or friends |
| `get_friends`, `add_friend`, `answer_friend`, `remove_friend`, `decline_all_friends` | Friends by player tag |
| `add_friend_seat` | Friend request from the results screen to the player in a seat |
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
  from earlier ones. As of 0019: `bot_step`, `bot_step_trio`, `resign`, `friends_json` and
  `remove_friend` are in 0019; `enforce`, `leave_queue`, `settle_trio`, `is_mode` and
  `total_weight` in 0018; `play_as`, `begin_game` and `create_room` in 0017; `join_room`, `start_game`, `play`, `get_room`, `leaving`, `seat_of`, `public_rooms`
  and `room_view` in 0016; `profile_for`, `profile_json`, `roll_season`,
  `update_profile` and `auto_bid_seconds` in 0014; `touch` in 0013; `bot_choice` in 0012;
  `leaderboard` and `sweep_abandoned` in 0011; `settle_match` in 0006;
  `end_by_forfeit` in 0003. Copy from the newest file when replacing one.
- **Rules exist in two languages.** The auction (TypeScript engine and SQL `play_as`) and
  the rule-based opponent (TypeScript `byRules` and SQL `bot_choice`) are each kept in
  step by a test that plays whole games and compares every step. If you change one side,
  change the other; the test will tell you.
- **Floating point.** The opponent's arithmetic is written with explicit
  `double precision` casts and the same order of operations as the TypeScript, so that
  both round the same way. Keep that when editing.
- **The site's content policy** (`public/_headers`; `netlify.toml` for the old host) names the Supabase host. A new backend
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
  counts double; a mode never played counts as zero; 1v1v1 (`trio`) is one mode. With seven
  universes that is ten shares (nine before 0018, so every overall score dropped by a tenth
  that day). It is what the world ranking and the profile headline show.
- **Seasons.** On the first of each month (UTC), after each player's result for the
  month is filed in `season_results`, every mode drops to the floor of its bracket
  (`encheres.season_floor`, mirrored by `seasonFloor` in `src/ranking.ts`): below 500
  unchanged, 500–999 → 500, 1000–1499 → 999, 1500–1999 → 1499, 2000+ → 1999. The overall
  score is then recomputed. An idle account slides one bracket per month. It happens
  the first time anyone calls the server in the new month. All-time bests are kept.
- **Names.** Free to change below 500 trophies (best mode), once per 30 days from 500
  (`name_changed_at`), and locked forever once any mode reaches 2200 (Legend);
  `legend_at` is kept and shown on the profile. Enforced in `update_profile` and
  `profile_for` (errors `NAME_COOLDOWN`, `NAME_LOCKED`).
- **Profile pictures.** A character id (face cropped from its card picture; initials if
  it has none) or '' for the grey guest figure. Old numeric values count as none. No
  uploads: storing and moderating images was judged not worth it.
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
  computer offline, the computer then finishes its team at once and the final screen
  follows; online it plays on at its usual pace while the player watches, as a person
  would (since 0019), and finishes at once only once the player has gone. Every result moves on by itself after a countdown on the button
  (`NextButton` in `Board.tsx`); between two people the server moves on after 12 s as a
  backstop. `encheres.sweep_games()` runs every minute through pg_cron
  (job `encheres-sweep`) so games nobody is looking at still end and are settled.
- **Passes.** Each player has 3 passes (`settings.passLimit`). A pass costs one only when
  it skips a card nobody has bid on (`passCosts`); conceding a card the other player bid
  on is free, and so is the automatic pass for a player who cannot bid. Out of passes
  with no bid on the table, the player must bid (`canPass`, error `NO_PASSES_LEFT`); the
  10M button counts down and after 8 seconds the minimum is bid for them (server `enforce`; offline `LocalGame`). The
  bots bid the minimum wherever they would have passed (`byRules`, `bot_choice`); a
  timed-out player out of passes gets the minimum bid. The scoreboard shows the passes as
  ✕ marks, with a buzzer sound.
- **Decks** are the whole pool: every character of the universe, or all 326 when mixed.
- **Power scales.** In a one-universe game powers are shown on that universe's own scale
  (strongest = 100; `powerIn`, `scaleFactor`, `GameView.scale`, `rooms.scale`). Display
  only: the verdict and every bot use shared power. Judging on the stretched scale was
  tried and dropped: it made the universe's top card decide almost every game (×3 gaps
  in Demon Slayer) and weakened the look-ahead opponent. The Characters page
  (`#/characters`) shows the top 100 of everyone under "All" (a search finds anyone), and
  each universe in full on its own scale, with the reason for each rating; a universe's
  strongest also shows its overall rank (`overallRank`), as a guide to how strong that
  universe is. The full list with every rank is in `docs/POWER_RATINGS.md` and
  `docs/power-ratings.csv` (generated by `npm run ratings`).
- **Three players.** The engine (`engine.ts`) and `play_as` take two or three players;
  `GameState.players` and `passed` are arrays, `Seat` is 0 | 1 | 2. `judgeAll` (verdict.ts)
  gives power, places and winner for any number of teams; `judge(a, b)` is the two-team
  case. The computer opponents (`src/bot/`, `bot_choice`, the Edge Function) only play
  two-player games, except `bot_choice_seat`, which plays any seat of a 1v1v1 (it reads the
  drawer as the informed rival). Offline "Three players" is a same-device game; rooms take
  `trio`.
- **Ranked 1v1v1.** The client's queue id is `trio:<universe or mix>` (`match/config.ts`:
  `trioQueue`, `trioVerse`, `ratingOf`); trophies go to the `trio` rating. `find_trio` is
  polled like `find_match`; three players of one universe start a game, stand-ins fill the
  rest after `opponent_after_seconds`. Giving up (resign, leaving, third time-out) adds the
  seat to `bot_seats` and `left_seats`: a stand-in plays it out, it is placed last. When no
  person is left, `trio_finish` plays the game out at once. Trophies: for each real player,
  win_gain/loss_cost against each other seat by place (a stand-in counts at the player's own
  level), averaged.
- **Rooms.** Private (reached by code or invitation) or public (listed on the Online
  page, `public_rooms`, refreshed every 5 s). Never ranked. Format `duel` or `teams`
  (2v2): the auction stays between two sides (seats 0 and 1) with one budget and roster
  each, so the engine and `play_as` are unchanged; each side's first member is its
  `room_players` row, the second a `room_members` row. `rooms.lineup` lists, per round,
  which member of each side plays (every pairing, reshuffled every four rounds); `play`
  refuses draw/bid/pass from the member sitting out. Both members of the drawing side see
  the card because the view is per side. Offline, "Teams" is a
  same-device game with team names (`LocalGame`, `opponent === 'teams'`).
- **Navigation.** The top bar is sticky; on every page but home it starts with a button
  (`BackButton`) that reads "Back" and goes to the previous page when there is one in
  this tab (`previousPage`, `goBack` in `router.ts`, which keeps the trail of visited
  pages in sessionStorage), and "Home" when the page was opened directly. The buttons at
  the bottom of pages use the same component. The phone's back gesture works too (hash
  routes).
- **Card pictures.** A card with a picture (`card--photo`) shows it over the whole card
  inside the frame, with the universe and name on a fade at the bottom; cards without one
  keep the universe band and initials. On the Characters page a card opens up close
  (`CardZoom`, a modal dialog, size `xl`) with a sound for its tier (`card-D` to `card-S`,
  and `card-apex` for a universe's number one, in `sound.ts`); up close it tilts with a
  finger as well as a mouse (`touch-action: none` on `.card--xl`), and on A, S and number
  one cards a shine follows it (`startShimmer`): a sparkle "ting" at the start of each swipe, then a glassy shimmer whose volume follows the pointer's speed and whose pitch glides with the band of light. The richer sounds use a
  small synthesis kit in `sound.ts`: a hall reverb (`space`), glass bells (`bell`), harp
  (`pluck`), swelling pads and a choir "aah" (`pad`), and `impact`. The top bar is glass
  (`backdrop-filter`, with an opaque fallback) and Back plays `back`.
- **Scrolling on phones.** The page never bounces past its ends
  (`overscroll-behavior-y: none` on html and body), so it stops at the footer even after a
  fast flick. That also turns off the browser's pull to refresh, which
  `src/pullToRefresh.ts` replaces: pull down at the top and a ring fills; release when it
  is full to reload (it spins while the page reloads).
- **Keyframe names are global.** Two `@keyframes sweep` once made the search radar stand
  still (the later one won). Give each animation its own name.
- **Leaderboards** show the top 1000; a player below that gets `around`: themselves and
  the players directly above and below, shown after a gap.
- **Online games are immersive.** While an online game is on (`Game` in `Room.tsx`), the
  top bar and the footer (whose notices, privacy and terms links would leave the game) are
  hidden and the browser's back is held (`setImmersive` in `chrome.ts`,
  `lockNavigation` in `router.ts`: a hash change not made by `navigate` is undone). The
  game's own Quit/Forfeit uses `navigate` and works.
- **Friends after a match.** The results screen of any online game has "Add friend" for the
  other players (`FriendButtons` in `Final.tsx`, `add_friend_seat`). For a stand-in the
  server keeps a pretend request (`ghost_requests`), shown under requests sent and never
  answered, so players do not learn it was the computer. The Friends screen has "Reject
  all"; the home screen shows the number of requests waiting.
- **Flags.** Countries are shown as flag emoji after the name (leaderboards, profile).
  Windows has no flag emoji and shows two letters ("FR"), so the site bundles
  `src/assets/fonts/TwemojiCountryFlags.woff2` (Twemoji, CC-BY 4.0, credited on the
  Notices page), first in both font stacks but limited by `unicode-range` to the flag
  characters, so it is downloaded only by pages that show a flag.
- **Removing a friend** takes two taps ("Remove", then "Yes, remove" or "Keep").
- **Friends.** Players exchange a seven-character tag. A request must be accepted. There
  is a friends leaderboard, and the host of a private room can invite a friend, who sees
  the invitation on the home screen.

## State of things

Done and live: same-device and offline play against two computer levels; private online
rooms; a Characters page; an animated How to play; quick matches in eight modes (1v1, and 1v1v1 with its own ranking) with 3 passes per player, a 30-second clock, three time-outs in a row, automatic wins over players who leave, and an autopilot that settles the match once a player cannot buy any more; server-played opponent; profiles
with statistics, badges, a character as profile picture and country; leaderboards (overall, per mode, friends,
country); monthly seasons with bracket floors and history; name rules; Play again / Change verse after a match; public rooms; 2v2 and 1v1v1 rooms; offline teams and three players; recovery codes; friends and
invitations; feedback form with rights requests; match recording; stronger opponent in
an Edge Function; rarity cards; dark theme; sound; security headers; French and English.

**Hosting moved on 18 Nov 2026** from Netlify to Cloudflare Pages
(https://anime-encheres.pages.dev), after Netlify's free credits ran out (there, each
production deploy and every GB of traffic costs credits). Netlify cannot publish again
before its credits reset on 16 Dec, so `anime-encheres.netlify.app` still serves build
`main@304a7cd`, which knows nothing about the pass limit; `0013_old_site_and_auto_bid.sql` lets
requests from that origin pass without limit. **To do on or after 16 Dec:** turn the
Netlify site into a redirect to the new address (one deploy, with a `public/_redirects`
line `/* https://anime-encheres.pages.dev/:splat 301`), then remove the old-site
exemption (`encheres.old_client`) in a new migration.

Google sign-in is on and the Google app is published (not "Testing"). Branding: app name
"Anime Auction Draft", logo `public/logo.svg` (PNG sizes made by `npm run logo`), home
page, `public/privacy.html` and `public/terms.html`, all on `anime-encheres.pages.dev`
since 18 Nov 2026. Authorized domains: only `anime-encheres.pages.dev` (the Supabase
callback host was removed so that every listed domain can be verified). Supabase Auth: Site
URL `https://anime-encheres.pages.dev`; redirect allow list has the pages.dev and
netlify.app addresses and `http://localhost:5173/**`. Sign-in from the new address was
checked to reach Google's account chooser with the right return address.
Google shows the name and logo only after brand verification; until then it shows the
supabase.co callback address. Both addresses are verified in Google Search Console with
`public/google5ef95c3ea69c5ef4.html`, which must stay (pages.dev verified 18 Nov 2026).
Brand verification was re-requested on 19 Nov 2026 at 14:12 Malaysia time ("View issues",
"I have fixed the issues", Proceed) and **failed again**: "The website of your home page URL
https://anime-encheres.pages.dev is not registered to you". Search Console still shows the
account as a verified owner of that site (HTML file method). One likely cause: Cloudflare
Pages answers `/google5ef95c3ea69c5ef4.html` with a redirect to the same path without
`.html` (its "pretty URLs"), which Google's brand check may not follow. Options, for the
owner to choose: add the Search Console "HTML tag" method too (a meta tag in `index.html`,
no redirect involved) and retry 24 hours later; or move the site to a custom domain verified
with a DNS record, which is also the clean fix for the supabase.co address shown on the
sign-in screen (Supabase custom domain, paid). Until branding is verified, sign-in works but
Google shows the supabase.co address instead of the app name and logo.

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
  not grant the right to use the art. **Decided by the owner (18 Nov 2026):** the website
  will use pictures of the real characters, under the existing fan-game notices and
  takedown route; the App Store and Google Play versions must not, and will use original
  (e.g. cartoon-style) art instead, since stores reject apps with other companies'
  characters. AI-generated pictures of the characters count as real-character pictures
  here: the characters' owners keep their rights whoever or whatever draws them. Keep the
  source of every picture in a credits file so any one can be removed quickly, and make
  sure app builds cannot include the web pictures (a build setting that leaves them out).
  **How pictures arrive (from 22 Nov 2026):** the owner keeps the originals in a folder
  `card-art` inside his local copy of the project (`Desktop\AnimeDraft\card-art` on his
  PC, connected to the Claude chat), one sub-folder per universe, each picture named
  after the character. `card-art/` is git-ignored: originals never go to GitHub. When he
  says there are new pictures, stage the folder into the session and run
  `python3 scripts/card_art.py <folder>`: it matches names (a close spelling is accepted
  and reported, e.g. "Caulifa" → Caulifla), redoes only new or changed pictures (content
  hashes in `src/assets/cards/sources.json`), cuts wider pictures to 5:7 around the point
  in `src/assets/cards/crops.json`, writes the WebP and the `CREDITS.md` row, and lists
  every character whose face must be placed. Pictures outside a universe folder are
  ignored on purpose (for example "Imu mommy.png", which the owner keeps out of the
  game). As of 27 Nov 2026: all 52 Dragon Ball characters, all 62 One Piece characters and 6 Naruto ones (Hagoromo, Kaguya, Madara, Naruto, Obito, Sasuke). The folder also holds Bellamy, Brogy and Dorry, who are not in the game's One Piece list, so the script skips them. The Notices page's
  "Pictures" paragraph says some cards show pictures made for the fan game, removed on
  request (until 22 Nov 2026 it still said the game had none).
- **Faces for profile pictures** are placed by hand in `src/data/faces.json` (centre x, y
  and face width, as fractions of the card), by looking at each card; `facePlacement` in
  `Avatar.tsx` frames the whole head and the top of the shoulders (face under half the
  circle, a little above the middle), as the owner asked on 23 Nov 2026 after a first,
  tighter version showed only the face. A face detector for anime
  (lbpcascade_animeface) was tried and found 3 faces out of 53, so it is not used. The
  test in `characters.test.ts` fails if a picture has no placed face.

### Decided, to build later

- **Real offline play.** Today "Play offline" needs internet to open the site (there is
  no service worker); only the game itself runs without the server. Agreed on 23 Nov
  2026: make the site work offline (a service worker caching the built files after the
  first visit, installable to the home screen, online modes saying "no connection", and a
  "new version, tap to update" notice). The owner asked to wait until the game is
  further along, so do not build it until he says so.

### Waiting on the owner

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
