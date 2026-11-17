# Deployment

The app is a static site plus one Supabase project. Same-device play needs only the static
site; online play needs both.

## 1. Database (Supabase)

1. Create a Supabase project (the free plan is enough).
2. Open **SQL Editor** and run the four scripts in order:
   [`0001_init.sql`](../supabase/migrations/0001_init.sql),
   [`0002_matchmaking.sql`](../supabase/migrations/0002_matchmaking.sql),
   [`0003_ranking.sql`](../supabase/migrations/0003_ranking.sql), then
   [`0004_character_powers.sql`](../supabase/migrations/0004_character_powers.sql).
   The editor warns about "destructive operations" because the scripts contain `revoke`
   and `delete` statements inside function bodies; nothing is removed. All scripts are
   idempotent, so they can be run again after an update.

After changing a power rating in `src/data/rosters.json`, run `npm run ratings` and run
`0004_character_powers.sql` again, so that the server judges games with the same numbers
as the app. A test fails if the two disagree.

To read what players sent through the feedback form, open **Table Editor**, choose the
`encheres` schema and the `feedback` table.
3. Open **Project Settings → API Keys** and copy the project URL and the **publishable**
   key.

No other setting has to change. The app does not use Supabase Auth, Storage or direct
table access.

## 2. Client configuration

Put the two values in `.env` (committed) or `.env.local` (ignored by git):

```ini
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
```

These values are public by design: they are shipped to every browser, and the database
functions are what enforce access. Never put the secret or `service_role` key in this
project.

If the variables are empty, the build still works and online play shows a clear "not
configured" message.

## 3. Hosting (Netlify)

1. In Netlify choose **Add new project → Import an existing project** and pick the GitHub
   repository.
2. Keep the detected settings. `netlify.toml` already sets the build command
   (`npm run build`), the publish directory (`dist`) and the Node version.
3. Deploy. Every push to `main` then redeploys automatically.

Any static host works the same way (Vercel, Cloudflare Pages, GitHub Pages): build with
`npm run build` and serve `dist/`. Routes use the URL hash, so no rewrite rule is needed.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, type check,
tests (including the database tests, which need no external service) and a production
build. The browser test (`npm run test:e2e`) is meant to be run locally.

## Limits to know about

- Rooms untouched for 24 hours are deleted the next time someone creates a room.
- Supabase pauses free projects after about a week without activity; resume the project
  from the dashboard if online play stops responding.
- The security headers in `netlify.toml` name the Supabase project the site may talk to.
  If you use another project, change the two addresses in `connect-src`.
- A deployed site is reachable by anyone who has the link. Room contents are still
  protected by the room code and the player token.
