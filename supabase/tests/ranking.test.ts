/** Ranked play between people: server-side verdict, trophies, profiles, leaderboards, feedback, limits. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter, poolFor } from '../../src/data/characters';
import { seeded } from '../../src/game/testing';
import type { GameView, Seat } from '../../src/game/types';
import { judge, teamPower } from '../../src/game/verdict';
import { createTestDb, readMigration, type TestDb } from './helpers';

const pool = poolFor('one-piece');
const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface Profile {
  name: string;
  country: string | null;
  avatar: number;
  trophies: number;
  best: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  forfeits: number;
  streak: number;
  bestStreak: number;
  peak: number;
  tag: string;
  modes: Array<{ mode: string; trophies: number; best: number; games: number; wins: number }>;
  rank: number | null;
  players: number;
  recent: Array<{ kind: string; opponent: string; outcome: string; delta: number; forfeit: boolean }>;
}

interface Board {
  rows: Array<{ rank: number; name: string; country: string | null; value: number; you: boolean | null }>;
  total: number;
  me: { rank: number; value: number } | null;
}

const token = (seat: Seat) => (seat === 0 ? ANA : BEN);
const search = (who: string, name: string, code: string | null = null) =>
  rpc('find_match', [who, name, 500, 5, 10, 10, pool, code]);
const profile = (who: string) => rpc<Profile>('get_profile', [who]);
const setTrophies = async (who: string, trophies: number, mode = 'one-piece') => {
  await db.query(
    `insert into encheres.ratings (profile, mode, trophies, best, games)
     select id, $3, $2, $2, 1 from encheres.profiles where token_hash = encheres.token_hash($1)
     on conflict (profile, mode) do update set trophies = excluded.trophies, best = excluded.trophies`,
    [who, trophies, mode],
  );
  await db.query(
    `update encheres.profiles set games = greatest(games, 1), trophies = encheres.overall(id)
      where token_hash = encheres.token_hash($1)`,
    [who],
  );
};

/** Ana and Ben are paired; returns the room code. */
async function paired(): Promise<string> {
  const ana = await search(ANA, 'Ana');
  const game = await search(BEN, 'Ben');
  expect(game.code).toBe(ana.code);
  return game.code!;
}

/** Plays a room to the end with random legal moves. */
async function playToEnd(code: string, rng: () => number, tokens = token): Promise<GameView> {
  let view = await rpc('get_room', [code, tokens(0)]);
  for (let step = 0; view.status === 'playing' && step < 2000; step++) {
    if (view.phase === 'draw') {
      view = await rpc('play', [code, tokens(view.drawer), 'draw', null]);
    } else if (view.phase === 'reveal') {
      view = await rpc('play', [code, tokens(0), 'next', null]);
    } else {
      const seat = view.turn;
      const min = view.highBidder === null ? 10 : view.highBid + 10;
      view =
        rng() < 0.6
          ? await rpc('play', [code, tokens(seat), 'bid', Math.min(view.players[seat].budget, min + Math.floor(rng() * 4) * 10)])
          : await rpc('play', [code, tokens(seat), 'pass', null]);
    }
  }
  return view;
}

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.matches; delete from encheres.feedback;
    delete from encheres.profiles; delete from encheres.rate_limits;
    delete from encheres.config where key = 'season';
    update encheres.config set value = 'true' where key = 'opponent_enabled';`);
});

describe('the server knows the ratings', () => {
  it('has exactly the characters and powers the app ships with', async () => {
    const rows = (await db.query<{ id: string; power: number }>('select id, power from encheres.characters')).rows;
    const fromDb = Object.fromEntries(rows.map((r) => [r.id, r.power]));
    const fromApp = Object.fromEntries(CHARACTERS.map((c) => [c.id, c.power]));
    // If this fails, run `npm run ratings` and apply 0004 again.
    expect(fromDb).toEqual(fromApp);
  });

  it('keeps the generated seed file in step with the roster', () => {
    const seed = readMigration('0004_character_powers.sql');
    for (const c of CHARACTERS) expect(seed).toContain(`('${c.id}', ${c.power}, '${c.universe}')`);
  });

  it('computes team power exactly like the app', async () => {
    const rng = seeded(5);
    const all = CHARACTERS.map((c) => c.id);
    for (let i = 0; i < 40; i++) {
      const team = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => all[Math.floor(rng() * all.length)]);
      const res = await db.query<{ p: number }>('select encheres.team_power($1::text[]) as p', [team]);
      expect(res.rows[0].p).toBeCloseTo(teamPower(team.map((id) => getCharacter(id).power)), 6);
    }
    expect((await db.query<{ p: number }>(`select encheres.team_power('{}'::text[]) as p`)).rows[0].p).toBe(0);
    expect((await db.query<{ p: number }>(`select encheres.team_power('{nobody}'::text[]) as p`)).rows[0].p).toBe(0);
  });
});

describe('trophy amounts', () => {
  const amount = async (fn: string, me: number, opponent: number) =>
    (await db.query<{ n: number }>(`select encheres.${fn}($1, $2) as n`, [me, opponent])).rows[0].n;

  it('pays more for beating a stronger player and less for a weaker one', async () => {
    expect(await amount('win_gain', 500, 500)).toBe(30);
    expect(await amount('win_gain', 500, 700)).toBe(40);
    expect(await amount('win_gain', 100, 2000)).toBe(50);
    expect(await amount('win_gain', 2000, 100)).toBe(10);
  });

  it('costs less to lose to a stronger player and more to a weaker one', async () => {
    expect(await amount('loss_cost', 500, 500)).toBe(26);
    expect(await amount('loss_cost', 500, 700)).toBe(16);
    expect(await amount('loss_cost', 100, 2000)).toBe(8);
    expect(await amount('loss_cost', 2000, 100)).toBe(44);
  });
});

describe('ranked games', () => {
  it.each([1, 2, 3])('are judged by the server like the app would (seed %i)', async (seed) => {
    const code = await paired();
    const final = await playToEnd(code, seeded(seed));
    expect(final.status).toBe('finished');
    const result = final.result!;
    const powers = [0, 1].map((seat) => final.players[seat].team.map((id) => getCharacter(id).power));
    const expected = judge(powers[0], powers[1]);
    expect(result.winner).toBe(expected.winner);
    expect(result.power[0]).toBeCloseTo(expected.power[0], 1);
    expect(result.power[1]).toBeCloseTo(expected.power[1], 1);

    // Both start at 0 trophies: the winner gains 30, the loser cannot go below 0.
    const [ana, ben] = [await profile(ANA), await profile(BEN)];
    expect(ana.games).toBe(1);
    expect(ben.games).toBe(1);
    if (expected.winner === null) {
      expect(result.deltas).toEqual([0, 0]);
      expect([ana.ties, ben.ties]).toEqual([1, 1]);
    } else {
      const [winner, loser] = expected.winner === 0 ? [ana, ben] : [ben, ana];
      expect(result.deltas![expected.winner]).toBe(30);
      expect(result.deltas![expected.winner === 0 ? 1 : 0]).toBe(0);
      // Trophies belong to the mode; the profile's own number is the overall score (30 / 9).
      expect(winner).toMatchObject({ trophies: 3, peak: 30, wins: 1, losses: 0, streak: 1, rank: 1 });
      expect(winner.modes).toEqual([{ mode: 'one-piece', trophies: 30, best: 30, games: 1, wins: 1 }]);
      expect(loser).toMatchObject({ trophies: 0, wins: 0, losses: 1, streak: 0, rank: 2 });
      expect(loser.modes).toEqual([{ mode: 'one-piece', trophies: 0, best: 0, games: 1, wins: 0 }]);
      expect(result.trophies![expected.winner]).toBe(30);
    }
  });

  it('are recorded with their action log', async () => {
    const code = await paired();
    await playToEnd(code, seeded(7));
    const match = (
      await db.query<{ kind: string; names: string[]; log: unknown[]; history: unknown[]; teams: string[][] }>(
        'select kind, names, log, history, teams from encheres.matches',
      )
    ).rows;
    expect(match).toHaveLength(1);
    expect(match[0].kind).toBe('ranked');
    expect(match[0].names).toEqual(['Ana', 'Ben']);
    expect(match[0].log.length).toBeGreaterThan(match[0].history.length);
    expect(match[0].log[0]).toMatchObject({ r: 1, a: 'draw' });
  });

  it('move trophies by rank difference and never below zero', async () => {
    const code = await paired();
    await setTrophies(ANA, 700);
    await setTrophies(BEN, 500);
    // Ben (500) gives up against Ana (700): she gains little, he loses little.
    const view = await rpc('resign', [code, BEN]);
    expect(view.result).toMatchObject({ winner: 0, deltas: [20, -16], trophies: [720, 484] });
    const ben = await profile(BEN);
    expect(ben).toMatchObject({ forfeits: 1, losses: 1 });
    expect(ben.modes[0]).toMatchObject({ mode: 'one-piece', trophies: 484, best: 500 });
    expect(ben.recent[0]).toMatchObject({ kind: 'ranked', opponent: 'Ana', outcome: 'loss', delta: -16, forfeit: true });
    expect((await profile(ANA)).recent[0]).toMatchObject({ opponent: 'Ben', outcome: 'win', delta: 20 });
  });

  it('are settled exactly once', async () => {
    const code = await paired();
    await rpc('resign', [code, BEN]);
    await db.query('select encheres.settle_match($1)', [code]);
    await rpc('resign', [code, ANA]);
    expect((await profile(ANA)).games).toBe(1);
    expect((await db.query('select 1 from encheres.matches')).rows).toHaveLength(1);
  });

  it('count a timeout as a forfeit by the idle player', async () => {
    const code = await paired();
    const view = await rpc('get_room', [code, ANA]);
    const idle = view.drawer;
    const waiter: Seat = idle === 0 ? 1 : 0;
    await db.query(`update encheres.rooms set updated_at = now() - interval '61 seconds' where code = $1`, [code]);
    const won = await rpc('claim_forfeit', [code, token(waiter)]);
    expect(won.result!.winner).toBe(waiter);
    expect((await profile(token(idle))).forfeits).toBe(1);
  });

  it('are dealt from the server\'s own cards, whatever the client sends', async () => {
    const view = await rpc('find_match', [ANA, 'Ana', 500, 5, 10, 10, ['made-up-card', 'another'], null, 'one-piece']);
    const stored = (await db.query<{ pool: string[]; mode: string }>('select pool, mode from encheres.rooms')).rows[0];
    expect(stored.mode).toBe('one-piece');
    expect([...stored.pool].sort()).toEqual([...pool].sort());
    expect(view.settings.poolSize).toBe(pool.length);
  });
});

describe('private rooms', () => {
  it('are recorded but never move trophies', async () => {
    const room = await rpc('create_room', [ANA, 'Ana', 500, 3, 10, 10, pool]);
    await rpc('join_room', [room.code, BEN, 'Ben']);
    await rpc('start_game', [room.code, ANA]);
    const final = await playToEnd(room.code!, seeded(4));
    expect(final.result!.deltas).toBeNull();
    expect(final.result!.trophies).toBeNull();
    const rows = (await db.query<{ kind: string }>('select kind from encheres.matches')).rows;
    expect(rows).toEqual([{ kind: 'private' }]);
    expect((await db.query('select 1 from encheres.profiles where games > 0')).rows).toHaveLength(0);
  });
});

describe('pairing by level', () => {
  it('prefers the closest player and widens the gap with waiting time', async () => {
    const ana = await search(ANA, 'Ana');
    await setTrophies(ANA, 1000);
    await rpc('get_profile', [BEN]);
    await rpc('get_profile', [CAM]);
    await setTrophies(CAM, 950);

    // Ben (0 trophies) is too far from Ana (1000) for now.
    const ben = await search(BEN, 'Ben');
    expect(ben.status).toBe('lobby');
    expect(ben.code).not.toBe(ana.code);

    // Cam (950) is close: paired with Ana although Ben has waited too.
    const cam = await search(CAM, 'Cam');
    expect(cam.code).toBe(ana.code);
    expect(cam.status).toBe('playing');
  });

  it('pairs distant players once one of them has waited long enough', async () => {
    // With the computer opponent switched off, so that the wait can run on.
    await db.exec(`update encheres.config set value = 'false' where key = 'opponent_enabled'`);
    const ana = await search(ANA, 'Ana');
    await setTrophies(ANA, 1000);
    expect((await search(BEN, 'Ben')).status).toBe('lobby');
    await db.query(
      `update encheres.rooms set created_at = now() - interval '25 seconds' where code = $1`,
      [ana.code],
    );
    // Ana's next poll keeps her waiting (hers is the older room); Ben's moves him in.
    await search(ANA, 'Ana', ana.code);
    const ben = await search(BEN, 'Ben');
    expect(ben.code).toBe(ana.code);
    expect(ben.status).toBe('playing');
  });
});

describe('profiles', () => {
  it('start empty and unranked', async () => {
    const p = await profile(ANA);
    expect(p).toMatchObject({
      name: 'Player', country: null, avatar: 0, trophies: 0, games: 0, rank: null, players: 0, recent: [], modes: [], peak: 0,
    });
  });

  it('can be edited, with validation', async () => {
    const p = await rpc<Profile>('update_profile', [ANA, '  Ana  ', 'my', 7]);
    expect(p).toMatchObject({ name: 'Ana', country: 'MY', avatar: 7 });
    expect((await rpc<Profile>('update_profile', [ANA, 'Ana', '', 0])).country).toBeNull();
    expect(await rpcError('update_profile', [ANA, 'Ana', 'MYS', 0])).toContain('INVALID_INPUT');
    expect(await rpcError('update_profile', [ANA, 'Ana', 'MY', 12])).toContain('INVALID_INPUT');
    expect(await rpcError('update_profile', [ANA, '', 'MY', 0])).toContain('INVALID_INPUT');
    expect(await rpcError('get_profile', ['short'])).toContain('INVALID_INPUT');
  });

  it('never expose the device token', async () => {
    const p = await profile(ANA);
    expect(JSON.stringify(p)).not.toContain('token');
    const stored = (await db.query<{ token_hash: string }>('select token_hash from encheres.profiles')).rows[0];
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('leaderboards', () => {
  beforeEach(async () => {
    await rpc('update_profile', [ANA, 'Ana', 'MY', 1]);
    await rpc('update_profile', [BEN, 'Ben', 'FR', 2]);
    await rpc('update_profile', [CAM, 'Cam', 'MY', 3]);
    await setTrophies(ANA, 400);
    await setTrophies(BEN, 900);
    await setTrophies(CAM, 650);
  });

  it('rank a mode by its trophies, best first, and mark the caller', async () => {
    const board = await rpc<Board>('leaderboard', [ANA, 'one-piece', null]);
    expect(board.rows.map((r) => [r.rank, r.name, r.value])).toEqual([[1, 'Ben', 900], [2, 'Cam', 650], [3, 'Ana', 400]]);
    expect(board.rows.map((r) => Boolean(r.you))).toEqual([false, false, true]);
    expect(board.total).toBe(3);
    expect(board.me).toEqual({ rank: 3, value: 400 });
    // Nobody has played this other mode.
    expect((await rpc<Board>('leaderboard', [ANA, 'naruto', null])).rows).toEqual([]);
  });

  it('rank the world by overall score, where mixed counts double', async () => {
    // Seven universes and mixed: nine shares. Ana adds 450 in mixed, worth 900.
    await setTrophies(ANA, 450, 'mix');
    const board = await rpc<Board>('leaderboard', [ANA, 'overall', null]);
    expect(board.rows.map((r) => [r.name, r.value])).toEqual([['Ana', 144], ['Ben', 100], ['Cam', 72]]);
    expect((await rpc<Board>('leaderboard', [ANA, 'all', null])).rows).toEqual(board.rows);
    expect((await profile(ANA)).trophies).toBe(144);
  });

  it('can be limited to one country', async () => {
    const board = await rpc<Board>('leaderboard', [ANA, 'one-piece', 'my']);
    expect(board.rows.map((r) => r.name)).toEqual(['Cam', 'Ana']);
    expect(board.me).toEqual({ rank: 2, value: 400 });
    expect((await rpc<Board>('leaderboard', [BEN, 'one-piece', 'MY'])).me).toBeNull();
  });

  it('leave out players who never played, work without a token, and validate', async () => {
    await db.exec(`update encheres.profiles set games = 0 where name = 'Cam'`);
    const board = await rpc<Board>('leaderboard', [null, 'overall', null]);
    expect(board.rows.map((r) => r.name)).toEqual(['Ben', 'Ana']);
    expect(board.me).toBeNull();
    expect(await rpcError('leaderboard', [ANA, 'month', null])).toContain('INVALID_INPUT');
    expect(await rpcError('leaderboard', [ANA, 'overall', 'XYZ'])).toContain('INVALID_INPUT');
    // The weekly table no longer exists; apps that still ask for it get an empty one.
    expect(await rpc<Board>('leaderboard', [ANA, 'week', null])).toEqual({ rows: [], total: 0, me: null });
  });
});

describe('feedback', () => {
  it('is stored with its category', async () => {
    expect(await rpc<boolean>('send_feedback', [ANA, 'idea', '  Add a tournament mode please  ', 'ana@example.com', 'en'])).toBe(true);
    const rows = (await db.query<{ category: string; message: string; contact: string; lang: string }>(
      'select category, message, contact, lang from encheres.feedback',
    )).rows;
    expect(rows).toEqual([{ category: 'idea', message: 'Add a tournament mode please', contact: 'ana@example.com', lang: 'en' }]);
  });

  it('is validated and limited to five messages a day per player', async () => {
    expect(await rpcError('send_feedback', [ANA, 'idea', 'hey', null, null])).toContain('INVALID_INPUT');
    expect(await rpcError('send_feedback', [ANA, 'spam', 'A real message', null, null])).toContain('INVALID_INPUT');
    expect(await rpcError('send_feedback', [ANA, 'bug', 'x'.repeat(1001), null, null])).toContain('INVALID_INPUT');
    for (let i = 0; i < 5; i++) await rpc('send_feedback', [ANA, 'bug', `Message number ${i}`, null, null]);
    expect(await rpcError('send_feedback', [ANA, 'bug', 'One too many', null, null])).toContain('RATE_LIMITED');
    expect(await rpc<boolean>('send_feedback', [BEN, 'bug', 'Someone else can still write', null, null])).toBe(true);
  });
});

describe('abuse limits', () => {
  it('refuse calls beyond the limit within a window', async () => {
    const hit = () => db.query(`select encheres.hit('test-key', 2, interval '1 hour')`);
    await hit();
    await hit();
    await expect(hit()).rejects.toThrow('RATE_LIMITED');
    // An unknown caller (no network address) is not limited.
    for (let i = 0; i < 5; i++) await db.query(`select encheres.hit(null, 1, interval '1 hour')`);
  });

  it('identify callers by a hash of their address, never the address', async () => {
    await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', false)`);
    const key = (await db.query<{ k: string }>('select encheres.client_key() as k')).rows[0].k;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203');
    await db.exec(`select set_config('request.headers', '', false)`);
    expect((await db.query<{ k: string | null }>('select encheres.client_key() as k')).rows[0].k).toBeNull();
  });

  it('limit how many rooms one address can open', async () => {
    await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', false)`);
    for (let i = 0; i < 40; i++) await rpc('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool]);
    expect(await rpcError('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool])).toContain('RATE_LIMITED');
    await db.exec(`select set_config('request.headers', '', false)`);
  });
});

describe('permissions', () => {
  it('expose only the public functions', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const fn of [
      'public.get_profile(text)',
      'public.update_profile(text, text, text, integer)',
      'public.leaderboard(text, text, text, boolean)',
      'public.send_feedback(text, text, text, text, text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(true);
    }
    for (const fn of [
      'encheres.settle_match(text)',
      'encheres.apply_result(uuid, text, text, integer, boolean)',
      'encheres.hit(text, integer, interval)',
      'encheres.profile_for(text, text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(false);
    }
    for (const table of ['profiles', 'matches', 'feedback', 'characters', 'rate_limits']) {
      expect(await check(`select has_table_privilege('anon', 'encheres.${table}', 'select') as ok`)).toBe(false);
      expect(await check(`select relrowsecurity as ok from pg_class where oid = 'encheres.${table}'::regclass`)).toBe(true);
    }
  });
});
