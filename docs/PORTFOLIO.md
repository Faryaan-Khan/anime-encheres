# Portfolio notes

Material for a CV, LinkedIn or an interview. Adjust the wording to your own voice, and
only keep claims you can explain in detail.

## One-line summary

A real-time, two-player hidden-information auction game for the web, with the secret
enforced on the server and the rules verified across two implementations.

## Short description (about 50 words)

Enchères Animés is a browser game based on a French TikTok format: one player sees a
character card, both bid for it, and bluffing decides the price. It supports same-device
and online play in French and English. Online, hidden information is enforced by Postgres
functions rather than by the client.

## CV bullet points

Pick three or four.

- Built a real-time two-player web game (React, TypeScript, Supabase) with same-device and
  online modes and a French/English interface.
- Designed the online mode so hidden information cannot be read from the browser: clients
  have no table access and call five `SECURITY DEFINER` Postgres functions that filter
  state per player.
- Implemented the auction rules as a pure TypeScript state machine and again in PL/pgSQL,
  and wrote a parity test that replays random games through both and compares every state.
- Ran the real SQL migration inside PGlite (WebAssembly Postgres) in the test suite, so
  database logic and permissions are tested in CI without any external service.
- Added matchmaking without new infrastructure: waiting players are lobby rooms, pairing
  runs under a Postgres advisory lock, and simultaneous searchers converge on the next
  poll. Includes a server-checked turn clock, forfeits and a computer fallback.
- Built a computer opponent for a hidden-information game: a rule-based level with a
  Bayesian read of the rival's bids, and a look-ahead level that samples hidden states
  consistent with what it has seen and plays each one out (determinized Monte Carlo). The
  look-ahead level wins 71% of simulated games against the rule-based one.
- Kept the bot honest by construction: it receives the same filtered view as a human, and
  a test verifies its decision does not change when the hidden card does.
- Designed a top-heavy team scoring formula (strength doubles every 2.5 rating points) and
  a card valuation derived from it, then measured both bots against baseline strategies.
- Wrote an end-to-end test in which two headless browser sessions play a full online game
  and assert that the hidden card never reaches the rival's page.
- Implemented account-free player identity with device-generated tokens stored server-side
  only as SHA-256 hashes.
- Kept two devices in sync with a Realtime broadcast ping plus polling fallback and
  version checks to discard stale responses.
- Reduced the initial JavaScript for offline players by about half through route-level
  code splitting of the backend client.
- Set up CI with GitHub Actions (type check, 89 tests, production build) and continuous
  deployment to Netlify.

## Skills demonstrated

| Area | Evidence in the repository |
| --- | --- |
| Front-end engineering | `src/components`, `src/screens`: typed React, accessible controls, responsive CSS without a framework |
| State modelling | `src/game/engine.ts`: immutable state machine with an explicit settle step |
| Game AI | `src/bot/bot.ts`: valuation, inference under hidden information, Monte Carlo look-ahead, opponent modelling; `src/bot/simulate.ts`: benchmarking |
| Database and SQL | `supabase/migrations/0001_init.sql`: schema design, PL/pgSQL, row locking, privileges |
| Security thinking | Threat model in `docs/ARCHITECTURE.md`; tests asserting what a rival and an outsider cannot see |
| Testing | Unit, property-style random playthroughs, database integration, cross-implementation parity and a two-browser end-to-end test |
| Internationalisation | `src/i18n`: typed dictionaries where a missing translation fails the build |
| Delivery | CI workflow, Netlify configuration, deployment guide |

## Questions you should be ready for

**Why not let both clients subscribe to the room row?**
Because the row contains the card. Anything sent to a browser can be read in its developer
tools, so the filtering has to happen before the data leaves the server.

**Why duplicate the rules in SQL instead of using a server in TypeScript?**
A database function is the smallest authoritative backend available on a free tier: no
extra service to host or secure. The cost is two implementations, which the parity test
keeps identical. An Edge Function sharing the TypeScript engine would be the main
alternative.

**What happens if both players act at the same moment?**
`play` locks the room row, so requests are applied one at a time. The second request is
validated against the new state and is rejected with a clear error if it is no longer
legal; the client then refreshes.

**How is a player identified without an account?**
A random token generated on the device. The server stores its hash and derives the seat
from it on every call.

**How do you know the hard bot is actually better?**
Self-play. A simulator runs whole games between any two strategies with seats swapped, and
the test suite asserts that each level beats the one below it. The win rates are in
`docs/ARCHITECTURE.md`. They compare strategies with each other; they are not a claim
about how the bot does against people.

**Why does the bot not cheat, given it runs in the browser?**
Its decision function only receives the view a human in its seat would get, and a test
swaps the hidden card to prove the decision is unchanged. The state itself is in the
browser, so a player could inspect it; that is why online play keeps state on the server.

**What would you do next?**
Spectators with audience voting, the "Undercover" variant, skill-based pairing once there
are enough players, and moving the sync ping into the database so clients cannot send it
themselves.

## Honest limits

Worth saying before an interviewer finds them:

- Two-player rooms only; no spectators yet.
- Quick matches pair by arrival order, not skill, and fall back to the computer when the
  queue is empty; that fallback runs in the browser, not on the server.
- Identity is tied to browser storage; clearing it loses the seat.
- The character list is static and names only.
- No rate limiting beyond what Supabase applies by default.
