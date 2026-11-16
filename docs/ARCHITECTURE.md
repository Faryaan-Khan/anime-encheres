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
- `public` contains five `SECURITY DEFINER` functions: `create_room`, `join_room`,
  `get_room`, `start_game` and `play`. They are the entire API.
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
| `supabase/tests/parity.test.ts` | Runs the real migration in PGlite. Checks validation, seat and host permissions, that the rival and the deck are never leaked, that API roles cannot touch tables, and that random games produce identical views in SQL and TypeScript at every step |

| `e2e/online.e2e.mjs` | Two isolated browser sessions play a whole online game through the real UI against the migration. Asserts that the hidden character never appears in the rival's page, that both players see every result, that only the host can start or restart, and that a reload keeps the seat. It runs without a Realtime server, so it also proves the polling fallback is sufficient on its own |

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
