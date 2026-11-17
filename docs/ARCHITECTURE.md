# Architecture

## Overview

```text
                         ┌──────────────────────────────┐
                         │  React UI (Board, Final, …)  │
                         │  renders a GameView          │
                         └──────────────┬───────────────┘
                 same device            │             online
        ┌───────────────────────────────┴──────────────────────────────┐
        ▼                                                              ▼
┌───────────────────┐                                   ┌──────────────────────────┐
│ useLocalGame      │                                   │ useOnlineRoom            │
│ engine.ts (pure)  │                                   │ api.ts → Supabase RPC    │
│ saved in browser  │                                   │ Realtime ping + polling  │
└───────────────────┘                                   └────────────┬─────────────┘
                                                                     ▼
                                                       ┌──────────────────────────┐
                                                       │ Postgres (Supabase)      │
                                                       │ public: 5 API functions  │
                                                       │ encheres: tables, hidden │
                                                       └──────────────────────────┘
```

The UI does not know which mode it is in beyond one prop. Both modes produce the same
`GameView` object (`src/game/types.ts`), and the board calls the same four actions:
draw, bid, pass, next.

## The engine

`src/game/engine.ts` is a set of pure functions: each takes a `GameState` and returns a
new one. There is no React, no storage and no randomness that cannot be injected, which
keeps the rules small enough to test exhaustively.

A round is a small state machine:

```text
draw ──draw()──▶ bidding ──bid()/pass()──▶ reveal ──next()──▶ draw   (next round)
                                                         └────▶ finished
```

After every action a `settle` step advances the auction as far as it can go without a
player: it skips anyone who has passed, whose team is full or who cannot afford the next
raise, and resolves the card once one bidder (or nobody) is left. This is why a player
never has to press "pass" when they have no legal move.

`toView(state, viewer)` projects the full state down to what one viewer may see. The
current card is included only for the drawer during bidding, and for everyone once the
round is resolved. The deck is reduced to a count.

## Team verdict

`src/game/verdict.ts` turns two teams into a result. A character's strength is
`2^(power / 2.5)`: every 2.5 points of power doubles it. A team's strength is the sum of
its members' strengths, and "team power" converts that sum back to the 1–100 scale (the
power of the one character who would equal the whole team).

The exponential makes the result top-heavy on purpose. Beerus (95) beats Goku (92) and
Vegeta (91) together, because `2^(95/2.5)` is larger than `2^(92/2.5) + 2^(91/2.5)`; but
Vegeta and Gohan (91 each) together edge out Goku (92). A gap under 0.4 points of team
power is called too close to call. The verdict is computed in the browser from the public
team lists, so online play needs nothing new from the server.

## Computer opponent

`src/bot/bot.ts`. The bot is given the same filtered `GameView` as a human in its seat, so
it cannot know a card its rival drew or the order of the deck. A test swaps the hidden
card and checks that the bot's decision does not change.

**Pricing a card.** Because the verdict is top-heavy, money is worth spending in
proportion to strength. A card is worth the share of the budget that its strength
represents among everything the player can still hope to add: the expected strongest
cards left in the deck, one per open slot, discounted because the rival will win some of
them. A card too weak to deserve one of the remaining slots is worth nothing; the last
card of the game is worth the whole budget.

**Bidding blind.** When the rival drew the card, the bot weighs every card it could be by
how well that card explains the rival's behaviour (an honest rival only bids what the card
is worth to them; some share of the time they are bluffing). It also accounts for the
winner's curse: it only wins when the rival stops raising, which is more likely when the
card is weak.

**Normal** applies these rules with some random error in its judgment, bluffs on about
one unwanted card in seven and assumes a typical rival.

**Ultra hard** looks ahead instead. For each option (bid the minimum raise, or pass) it
builds 40 imagined games consistent with everything it has seen: the hidden card is
sampled from the same probability model, and the deck from the cards not yet revealed. It
plays each imagined game to the end with two rule-based players and takes the option that
wins more often, using identical random futures for both options so that they are compared
fairly. It also learns, from every card the rival drew and bid on, how often this rival
overbids, and feeds that into the model. A decision takes a few tens of milliseconds on a
laptop.

Measured over simulated games (see `src/bot/simulate.ts`; 180 to 3,000 games per pairing,
seats swapped every game):

| Matchup | Win rate |
| --- | --- |
| Normal vs a player bidding at random | 79% |
| Normal vs a naive player who pays by rank and never bluffs | 69% |
| Ultra hard vs normal | 71% |
| Ultra hard vs the naive player | 86% |

These numbers say how the levels compare with each other and with simple strategies. They
do not say how either fares against a person, who can read patterns the simulation does
not contain. Card luck decides a fair share of games at any level.

## Same-device mode

`useLocalGame` holds the full `GameState` in React state and writes it to `localStorage`
after every move, so a closed tab does not lose the game. Because both players look at the
same screen, the card is rendered face down and only shown while the drawer presses and
holds it.

Against the computer the same hook also stores the bot's memory. The screen is rendered
from the human's own view (`toView(state, 0)`), exactly as an online player's screen is,
so the cards the computer draws stay hidden. Since everything runs in the browser, a
determined player could read the state from storage; that is acceptable for solo play and
is the reason online play keeps its state on the server.

## Online mode

### Why not a plain table with row-level security?

The obvious Supabase design is a `rooms` table that clients subscribe to. That cannot keep
a secret: both players need the row, and the row contains the card. Column-level tricks
and filtered views get complicated quickly, and one mistake leaks the card to anyone who
opens the developer tools.

Instead the browser is given no table access at all:

- Tables live in the `encheres` schema. Supabase's API only exposes `public`, so the
  tables cannot be addressed from outside. Row-level security is also enabled with no
  policies, as a second barrier.
- `public` contains `SECURITY DEFINER` functions and nothing else: `create_room`,
  `join_room`, `get_room`, `start_game` and `play`, plus four for quick matches. They are
  the entire API.
- Every function ends by calling `encheres.room_view(code, seat)`, the single place where
  the state is filtered for a seat. It is the SQL twin of `toView`.

### Identity without accounts

Signing up to play a party game would be friction. Each device generates a random 192-bit
token and keeps it in `localStorage`. The server stores only its SHA-256 hash next to the
seat. Every call sends the token; the function looks up the seat from the hash. Knowing a
room code is not enough to read or act in a room: a third device gets `NOT_IN_ROOM`.

### Rules on the server

`play` locks the room row (`SELECT … FOR UPDATE`), validates the action against the
current phase, turn, budget and team size, applies it, runs the same settle loop as the
engine, and bumps a `version` counter. Two simultaneous requests are therefore applied one
after the other, and the second is validated against the result of the first.

The deck is shuffled inside `start_game` with the database's random generator, so no
client ever knows the order.

### Keeping two phones in sync

After a successful action the acting device sends a tiny broadcast on the Supabase
Realtime channel `room:<code>`. The message carries no game data; it only tells the other
device to call `get_room` again and fetch its own filtered view. Both devices also poll
every 2.5 seconds while the tab is visible, so a missed message can never leave a screen
stale for long. Responses carry the room `version`, and the client ignores any response
older than the one it already shows.

### Quick matches

`supabase/migrations/0002_matchmaking.sql` adds matchmaking without a new table. A player
looking for a game is simply the host of a lobby room flagged `matched`. `find_match`
either seats the caller in the longest-waiting such room and starts the game, or opens a
new waiting room for them. The client calls it again every 2.5 seconds with the code it
was given until the room is `playing`; that poll is also the heartbeat, and a room nobody
has polled for 12 seconds is skipped.

- **Races.** Pairing runs under a transaction-level advisory lock, so two callers cannot
  take the same seat. Two players who start at the same instant each open a room; on the
  next poll the one in the newer room moves into the older one.
- **Closed rooms.** A matched room cannot be joined by code, started by hand or
  restarted, and the client never shows its code.
- **Turn clock.** Strangers leave. Room views carry `idle`, the seconds since the last
  change. After 60 seconds without an action, the waiting player may call
  `claim_forfeit`; the server checks the time itself. `resign` gives up at once. The clock
  does not run during a reveal, since either player can move on from it.
- **When nobody is there.** After 12 to 18 seconds the database seats an opponent itself
  and plays its moves (next section). The player's device does nothing different.

### The computer opponent in quick matches

`supabase/migrations/0005_accounts_and_opponent.sql`. Earlier versions ran this opponent in
the browser, which meant its results could only be self-reported. It now lives in the
database, so a game against it is judged like any other and counts for trophies at every
rank.

- **Seating.** `find_match` seats the computer in the caller's waiting room once the wait
  passes a threshold that differs per room. It gets an ordinary name, a random secret
  token, and a skill between 0 and 1 taken from the player's trophies (1200 trophies and
  above is the top), with a little variety.
- **Moving.** The computer has no clock. Every time the player's device asks for the room
  (`get_room`, every 1.5 seconds), `bot_step` checks whether it is the computer's move
  and whether it has "thought" long enough, and if so plays through the same `play`
  function a person uses. To the network it looks exactly like a game against a person.
- **Bidding.** `bot_choice` is a port of the rule-based player in `src/bot/bot.ts`. A
  beginner is timid with cards it has seen and reckless with cards it has not; an expert
  prices soundly, rarely chases a hidden card and counts the cards left. Measured in
  simulation: skill 0 wins 32% against the offline "normal" level, skill 1 wins 58%, and
  skill 1 is level with the offline look-ahead player.
- **Fairness.** When the player drew the card, the functions never read it. A test swaps
  the hidden card and checks the decision does not move.
- **Two languages, one behaviour.** A test plays whole games and requires the SQL and the
  TypeScript player to choose the same action at every step for five skill levels.
- **Leaving.** A player who runs out of time or walks away loses by forfeit: the room
  ends itself after 65 seconds on the player's move, and abandoned rooms are settled the
  next time that player opens their profile or searches again.
- **Disclosure.** Players are not told that an opponent is the computer; that is a
  product decision. `opponent_enabled` in `encheres.config` switches it off.

### Accounts

A profile starts on one device. `encheres.devices` attaches more devices to it, in two
ways: a recovery code (16 characters, stored only as a hash, limited attempts), or a
one-time Google sign-in through Supabase Auth, after which `link_account` ties the profile
to that Google account. In both cases the device token remains the identity for every
other call; no session is kept in the browser.

### Ranking

`supabase/migrations/0003_ranking.sql` adds profiles, trophies, match records,
leaderboards and feedback. `0004_character_powers.sql` is generated by `npm run ratings`
and gives the database its own copy of the power ratings.

- **Profiles.** A profile is created the first time a device looks for a match and is
  keyed by the hash of that device's token, the same identity rooms use. It holds a name,
  an optional country, one of twelve built-in avatars, trophies and counters. There is no
  sign-in, no email and no upload, so there is nothing to moderate and little to leak.
- **The server decides who won.** When a game ends, `settle_match` computes both team
  powers from the database's ratings with the same formula as `src/game/verdict.ts` and
  records the result. The client is never asked who won, so a modified client cannot
  award itself a win. A test compares the SQL and TypeScript formulas on random teams,
  and another fails if the seed file and the roster ever disagree.
- **Trophies.** A win is worth 30 trophies against an equal, more against a stronger
  player and less against a weaker one (10 to 50); a loss costs 26 against an equal (8 to
  44). Trophies never go below zero. Only quick matches are ranked; private rooms are
  recorded but move nothing, since two friends could trade wins. Settling is idempotent:
  a room is marked settled in the same transaction.
- **Pairing by level.** `find_match` seats the caller with the waiting player whose
  trophies are closest, within a window that starts at 150 and grows by 40 for every
  second either has waited, so strong players still find a game on a quiet evening.
- **Match records.** Every action is appended to the room's log (`round, seat, action,
  value`) and copied to `matches` with the teams, powers and trophy changes. This is the
  data a future learning opponent, replays or rating reviews would need.
- **Leaderboards.** The overall score or one mode, for the world, one country or the
  caller's friends. Only the top 50 rows and the caller's own rank leave the database.
- **Leagues and badges** are derived from the profile in `src/ranking.ts`; nothing about
  them is stored. Each kind of badge is earned once and then levels up.
- **Abuse limits.** Functions that create rows count calls per caller in `rate_limits`:
  rooms and searches per network address (stored only as a hash), feedback per device and
  per address. Exceeding a limit raises `RATE_LIMITED`.

### Modes, the overall score and seasons

`supabase/migrations/0006_modes_and_friends.sql`.

- **Modes.** A quick match is played in one mode: a universe, or `mix` for all of them.
  Each mode is its own queue. The server builds the pool from `encheres.characters`
  (which records every card's universe) and ignores any card list sent by the client, so
  a modified client cannot play a ranked game with hand-picked cards.
- **Ratings.** `encheres.ratings` holds one row per player and mode. Trophy changes,
  leagues, pairing and the opponent's skill all use the rating of the mode being played.
- **Overall score.** `profiles.trophies` now holds a derived number: the weighted average
  of the player's ratings over every mode, with `mix` counting double because it asks
  for knowledge of every series. A mode never played counts as zero, so the score rewards
  breadth. `src/ranking.ts` has the same formula for display, and a test compares the
  two.
- **Seasons.** `roll_season` runs at the start of the calls that read or change ratings.
  When the month differs from the one stored in `encheres.config`, every rating above
  the Legend entrance (2200) is set back to it and the affected overall scores are
  recomputed. There is no scheduler: the first call of the month does the work, under a
  lock.
- **Compatibility.** Apps opened before modes existed send a card list and no mode; the
  server works the mode out from the cards. They also ask for a weekly leaderboard,
  which now returns an empty table.

### Friends and invitations

Every profile has a seven-character tag. `add_friend` with someone's tag creates a
request, which the other player accepts (asking back counts as accepting). Friends are a
filter on every leaderboard. The host of a private room that has not started can call
`invite_friend`; the friend's device shows the invitation the next time it asks for
`get_friends`, which the home screen does every 15 seconds and the friends screen every
6. An invitation disappears when the room fills, starts, is deleted, or after 30 minutes.
Outcomes such as "unknown tag" are returned as a status, not raised, so that every
attempt counts toward the daily limit.

### What is stored about a player

A token hash, a display name, a public tag, an optional country code, an avatar number,
trophies per mode and counters, the list of friends, the games played with their action logs, and any feedback sent (with a contact
only if the player typed one). Network addresses are never stored, only a hash used for
rate limiting, deleted after a day. No email, password or device information.

### Never missing a result

Either player may leave the reveal screen, and the other device only finds out on its next
sync. Each device therefore counts the results it has displayed and replays any it has not
shown yet before rendering the current state (`Game` in `src/screens/Room.tsx`). The
replay is purely local; the server is not involved.

### Housekeeping

Creating a room deletes rooms that have not been touched for 24 hours. There is no cron
job or extra infrastructure to maintain.

## Testing

| Suite | What it proves |
| --- | --- |
| `src/game/engine.test.ts` | Every rule and edge case of the auction; random games always terminate and budgets always add up |
| `src/game/verdict.test.ts` | The team power formula and its canon sanity checks |
| `src/bot/bot.test.ts` | Card pricing, fair play (the decision does not depend on the hidden card), memory, legality of every move over whole simulated games, and that each level beats the one below it |
| `src/data/characters.test.ts` | Character ids are unique, every character has a rating and a reason, and every universe has enough cards and a spread of strong, average and weak ones |
| `supabase/tests/parity.test.ts` | Runs the real migrations in PGlite. Checks validation, seat and host permissions, that the rival and the deck are never leaked, that API roles cannot touch tables, and that random games produce identical views in SQL and TypeScript at every step |
| `supabase/tests/matchmaking.test.ts` | Pairing order, simultaneous searches, abandoned waiters, self-matching, closed rooms, resigning, and the turn clock (too early, in time, during a reveal) |
| `supabase/tests/ranking.test.ts` | The server's verdict equals the app's on random teams and whole games, trophy amounts, the floor at zero, forfeits and timeouts, settling once, private rooms unranked, pairing by level, profile validation, the three leaderboards, feedback limits, rate limits, and that API roles can reach only the public functions |
| `src/ranking.test.ts` | League thresholds and badges |
| `supabase/tests/opponent.test.ts` | The computer sits down only after the wait, looks like any player, follows the player's trophies, makes the same decisions as the TypeScript player through whole games, never depends on a card it has not seen, finishes games that count, and wins by forfeit when the player leaves |
| `supabase/tests/modes.test.ts` | The server's card list per mode equals the app's, separate queues, mode worked out for old apps, per-mode trophies and pairing, the overall score formula in both languages, the monthly reset, friend requests in every state, the friends leaderboard, and invitations |
| `supabase/tests/accounts.test.ts` | Recovery codes (format, hashing, replacement, attempt limits), one profile on two devices, and sign-in linking |
| `e2e/online.e2e.mjs` | Trophies appear on the final screen, the profile can be edited, the leaderboards list the players, feedback is stored, the computer joins from the server at any rank, and an account is recovered on a second browser with its code. Quick matches too: two searching browsers are paired, a forfeit and a timeout are announced, and a lone player gets an opponent from the server. Two isolated browser sessions play a whole online game through the real UI against the migration. Asserts that the hidden character never appears in the rival's page, that both players see every result, that only the host can start or restart, and that a reload keeps the seat. It runs without a Realtime server, so it also proves the polling fallback is sufficient on its own |

The parity test is the important one. Having the rules in two languages is a risk; the
test turns that risk into a guarantee by making any divergence fail the build.

The migration was additionally exercised against the live Supabase project through the
REST API with the publishable key: a full game, the permission errors, and confirmation
that the tables and internal helpers are not reachable (HTTP 404 and 406).

## Front-end notes

- **Routing**: a 30-line hash router (`src/router.ts`). Hash routes work on any static
  host with no rewrite rules, and a room link (`#/room/ABCDE`) survives a refresh.
- **Code splitting**: the online screens and the Supabase client are loaded on demand, so
  same-device players download about 68 kB of JavaScript (gzipped) instead of 128 kB.
- **Internationalisation**: a typed dictionary (`src/i18n/strings.ts`). The English table
  is typed as `Record<StringKey, string>`, so a missing translation is a compile error.
- **Fonts**: self-hosted through Fontsource; the app makes no third-party font requests.
- **Storage**: every `localStorage` access is wrapped and falls back to memory, so private
  browsing does not break the app.
- **Accessibility**: real buttons and labelled inputs, visible focus, live region for
  auction updates, reduced-motion support, and a keyboard path for press-and-hold.

## Design decisions and trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| Rules duplicated in SQL | The server must be authoritative, and a database function needs no extra hosting | Two implementations; mitigated by the parity test |
| Token identity instead of accounts | Zero friction for a party game | Clearing browser data loses the seat |
| Broadcast ping plus polling | Simple and self-healing | A few extra requests per minute |
| Client sends the character pool | The server stays independent of the character list | A host could submit a custom pool (harmless: both players get the same deck) |
| Names only, no artwork | Avoids shipping copyrighted images | Cards are typographic unless you add your own pictures |
