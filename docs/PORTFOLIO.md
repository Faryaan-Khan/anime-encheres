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
- Wrote an end-to-end test in which two headless browser sessions play a full online game
  and assert that the hidden card never reaches the rival's page.
- Implemented account-free player identity with device-generated tokens stored server-side
  only as SHA-256 hashes.
- Kept two devices in sync with a Realtime broadcast ping plus polling fallback and
  version checks to discard stale responses.
- Reduced the initial JavaScript for offline players by about half through route-level
  code splitting of the backend client.
- Set up CI with GitHub Actions (type check, 51 tests, production build) and continuous
  deployment to Netlify.

## Skills demonstrated

| Area | Evidence in the repository |
| --- | --- |
| Front-end engineering | `src/components`, `src/screens`: typed React, accessible controls, responsive CSS without a framework |
| State modelling | `src/game/engine.ts`: immutable state machine with an explicit settle step |
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

**What would you do next?**
Spectators with audience voting, the "Undercover" variant, a bid timer, and moving the
sync ping into the database so clients cannot send it themselves.

## Honest limits

Worth saying before an interviewer finds them:

- Two-player rooms only; no spectators yet.
- Identity is tied to browser storage; clearing it loses the seat.
- The character list is static and names only.
- No rate limiting beyond what Supabase applies by default.
