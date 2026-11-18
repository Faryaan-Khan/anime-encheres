/** Ranked modes (one universe or all mixed), monthly seasons, friends and invitations. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS, MIX_ID, UNIVERSES, poolFor, scaleOf } from '../../src/data/characters';
import { OVERALL_SHARES, overallScore } from '../../src/ranking';
import { createTestDb, type TestDb } from './helpers';

const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';
const DAN = 'dan-token-0123456789abcdef';

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface Person { id: string; name: string; trophies: number; tag: string }
interface Friends {
  tag: string;
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  invites: Array<{ code: string; from: string }>;
  status?: string;
}
interface Profile {
  id: string;
  tag: string;
  trophies: number;
  peak: number;
  modes: Array<{ mode: string; trophies: number; best: number }>;
}
interface Board {
  rows: Array<{ name: string; value: number; you: boolean | null }>;
  total: number;
  me: { rank: number; value: number } | null;
}

const search = (who: string, name: string, mode: string, code: string | null = null) =>
  rpc('find_match', [who, name, 500, 5, 10, 10, null, code, mode]);
const profile = (who: string) => rpc<Profile>('get_profile', [who]);
const friends = (who: string) => rpc<Friends>('get_friends', [who]);
const named = async (who: string, name: string) => rpc<Profile>('update_profile', [who, name, null, 0]);
const setTrophies = async (who: string, trophies: number, mode: string) => {
  await db.query(
    `insert into encheres.ratings (profile, mode, trophies, best, games, season_best, season_games)
     select id, $3, $2, $2, 1, $2, 1 from encheres.profiles where token_hash = encheres.token_hash($1)
     on conflict (profile, mode) do update
       set trophies = excluded.trophies, best = excluded.trophies,
           season_best = excluded.trophies, season_games = greatest(encheres.ratings.season_games, 1)`,
    [who, trophies, mode],
  );
  await db.query(
    `update encheres.profiles set games = greatest(games, 1), season_games = greatest(season_games, 1),
            trophies = encheres.overall(id)
      where token_hash = encheres.token_hash($1)`,
    [who],
  );
};
/** Two players become friends. */
async function befriend(a: string, b: string): Promise<void> {
  expect((await rpc<Friends>('add_friend', [a, (await profile(b)).tag])).status).toBe('sent');
  expect((await rpc<Friends>('add_friend', [b, (await profile(a)).tag])).status).toBe('accepted');
}

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.matches; delete from encheres.devices;
    delete from encheres.profiles; delete from encheres.rate_limits; delete from encheres.feedback;
    delete from encheres.config where key = 'season';
    update encheres.config set value = 'false' where key = 'opponent_enabled';`);
});

describe('modes', () => {
  it('are the universes of the app plus mixed, and the server knows their cards', async () => {
    const rows = (await db.query<{ id: string; universe: string }>('select id, universe from encheres.characters')).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.universe]))).toEqual(
      Object.fromEntries(CHARACTERS.map((c) => [c.id, c.universe])),
    );
    for (const mode of [MIX_ID, ...UNIVERSES.map((u) => u.id)]) {
      const dealt = (await db.query<{ pool: string[] }>('select encheres.mode_pool($1) as pool', [mode])).rows[0].pool;
      expect([...dealt].sort()).toEqual([...poolFor(mode)].sort());
    }
  });

  it('each have their own queue', async () => {
    const ana = await search(ANA, 'Ana', 'naruto');
    const ben = await search(BEN, 'Ben', 'one-piece');
    expect(ben.status).toBe('lobby');
    expect(ben.code).not.toBe(ana.code);
    const cam = await search(CAM, 'Cam', 'naruto');
    expect(cam.code).toBe(ana.code);
    expect(cam.status).toBe('playing');
    expect(cam.settings.poolSize).toBe(poolFor('naruto').length);
  });

  it('include every card in mixed', async () => {
    const view = await search(ANA, 'Ana', 'mix');
    expect(view.settings.poolSize).toBe(CHARACTERS.length);
    await search(BEN, 'Ben', 'mix');
    const deck = (await db.query<{ deck: string[] }>('select deck from encheres.rooms')).rows[0].deck;
    expect(deck).toHaveLength(CHARACTERS.length);
    expect((await db.query<{ scale: string }>('select scale from encheres.rooms')).rows[0].scale).toBe('all');
  });

  it('show a single universe on its own scale', async () => {
    await search(ANA, 'Ana', 'naruto');
    const view = await search(BEN, 'Ben', 'naruto');
    expect(view.scale).toBe('naruto');
    expect(view.deckCount).toBe(poolFor('naruto').length);
    // Same rule as the app.
    expect(scaleOf(poolFor('naruto'))).toBe('naruto');
  });

  it('are worked out from the cards for apps that do not name one', async () => {
    await rpc('find_match', [ANA, 'Ana', 500, 5, 10, 10, poolFor('bleach'), null]);
    await rpc('find_match', [BEN, 'Ben', 500, 5, 10, 10, poolFor(MIX_ID), null]);
    const modes = (await db.query<{ mode: string }>('select mode from encheres.rooms order by mode')).rows;
    expect(modes.map((m) => m.mode)).toEqual(['bleach', 'mix']);
  });

  it('keep a waiting player in the mode of their room', async () => {
    const ana = await search(ANA, 'Ana', 'naruto');
    // The poll names another mode by mistake: the room decides.
    expect((await search(ANA, 'Ana', 'bleach', ana.code)).code).toBe(ana.code);
    expect((await search(BEN, 'Ben', 'bleach')).status).toBe('lobby');
  });

  it('keep their own trophies', async () => {
    const naruto = await search(ANA, 'Ana', 'naruto');
    await search(BEN, 'Ben', 'naruto');
    const result = (await rpc('resign', [naruto.code, BEN])).result!;
    expect(result).toMatchObject({ mode: 'naruto', winner: 0, deltas: [30, 0], trophies: [30, 0] });

    const mixed = await search(ANA, 'Ana', 'mix');
    await search(BEN, 'Ben', 'mix');
    await rpc('resign', [mixed.code, BEN]);

    const ana = await profile(ANA);
    expect(ana.modes).toMatchObject([
      { mode: 'mix', trophies: 30 },
      { mode: 'naruto', trophies: 30 },
    ]);
    // 30 in one universe and 30 in mixed, which counts double: 90 over 9 shares.
    expect(ana.trophies).toBe(10);
    expect(ana.peak).toBe(30);
    const recent = (await rpc<{ recent: Array<{ mode: string }> }>('get_profile', [ANA])).recent;
    expect(recent.map((m) => m.mode)).toEqual(['mix', 'naruto']);
  });

  it('pair by the trophies of that mode only', async () => {
    await named(ANA, 'Ana');
    await named(BEN, 'Ben');
    await setTrophies(ANA, 2000, 'one-piece');
    // Far apart in One Piece, level in Naruto.
    const waiting = await search(ANA, 'Ana', 'one-piece');
    expect((await search(BEN, 'Ben', 'one-piece')).code).not.toBe(waiting.code);
    await db.exec('delete from encheres.rooms');
    const naruto = await search(ANA, 'Ana', 'naruto');
    expect((await search(BEN, 'Ben', 'naruto')).code).toBe(naruto.code);
  });
});

describe('the overall score', () => {
  it('is the same in the app and on the server', async () => {
    await named(ANA, 'Ana');
    const trophies: Record<string, number> = { mix: 1234, naruto: 777, bleach: 50, 'one-piece': 2301 };
    for (const [mode, value] of Object.entries(trophies)) await setTrophies(ANA, value, mode);
    const total = (await db.query<{ n: number }>('select encheres.total_weight() as n')).rows[0].n;
    expect(total).toBe(OVERALL_SHARES);
    expect((await profile(ANA)).trophies).toBe(overallScore(trophies));
  });
});

describe('seasons', () => {
  const setSeason = (month: string) =>
    db.query(
      `insert into encheres.config (key, value) values ('season', to_jsonb($1::text))
       on conflict (key) do update set value = excluded.value`,
      [month],
    );
  interface Season {
    season: string;
    trophies: number;
    best: number;
    rank: number;
    players: number;
    modes: Array<{ mode: string; trophies: number; best: number; rank: number }>;
  }
  interface Records {
    season: string;
    trophies: number;
    seasonBest: number;
    bestRank: number | null;
    peak: number;
    rank: number | null;
    modes: Array<{ mode: string; trophies: number; best: number; seasonBest: number; bestRank: number | null }>;
    history: Season[];
  }
  const records = (who: string) => rpc<Records>('get_profile', [who]);

  it('start everyone from zero each month and keep the results of the month before', async () => {
    await named(ANA, 'Ana');
    await named(BEN, 'Ben');
    await setTrophies(ANA, 2950, 'naruto');
    await setTrophies(ANA, 400, 'mix');
    await setTrophies(BEN, 1200, 'naruto');
    await setSeason('2020-01');

    const ana = await records(ANA);
    expect(ana.season).toBe(new Date().toISOString().slice(0, 7));
    expect(ana.trophies).toBe(0);
    expect(ana.rank).toBeNull();
    expect(ana.modes).toMatchObject([
      { mode: 'mix', trophies: 0, best: 400, seasonBest: 0, bestRank: 1 },
      { mode: 'naruto', trophies: 0, best: 2950, seasonBest: 0, bestRank: 1 },
    ]);
    expect(ana.peak).toBe(2950);
    expect(ana.bestRank).toBe(1);
    expect(ana.history).toHaveLength(1);
    expect(ana.history[0]).toMatchObject({
      season: '2020-01',
      trophies: overallScore({ naruto: 2950, mix: 400 }),
      rank: 1,
      players: 2,
    });
    expect(ana.history[0].modes).toMatchObject([
      { mode: 'naruto', trophies: 2950, rank: 1 },
      { mode: 'mix', trophies: 400, rank: 1 },
    ]);
    const ben = await records(BEN);
    expect(ben.history[0]).toMatchObject({ rank: 2, players: 2 });
    expect(ben.history[0].modes).toMatchObject([{ mode: 'naruto', rank: 2 }]);

    // The new season's tables are empty until someone plays.
    expect((await rpc<Board>('leaderboard', [ANA, 'naruto', null])).rows).toEqual([]);
    expect((await rpc<Board>('leaderboard', [ANA, 'overall', null])).rows).toEqual([]);
  });

  it('count a game played in the new season', async () => {
    await named(ANA, 'Ana');
    await named(BEN, 'Ben');
    await setTrophies(ANA, 900, 'naruto');
    await setSeason('2020-01');
    const waiting = await search(ANA, 'Ana', 'naruto');
    await search(BEN, 'Ben', 'naruto');
    await rpc('resign', [waiting.code, BEN]);
    const ana = await records(ANA);
    expect(ana.modes).toMatchObject([{ mode: 'naruto', trophies: 30, seasonBest: 30, best: 900 }]);
    expect(ana.rank).toBe(1);
    expect((await rpc<Board>('leaderboard', [ANA, 'naruto', null])).rows.map((r) => r.name)).toEqual(['Ana', 'Ben']);
  });

  it('do nothing again within the same month', async () => {
    await named(ANA, 'Ana');
    await profile(ANA); // starts the current season
    await setTrophies(ANA, 2600, 'naruto');
    await rpc('leaderboard', [ANA, 'naruto', null]);
    expect((await profile(ANA)).modes).toMatchObject([{ mode: 'naruto', trophies: 2600 }]);
    expect((await records(ANA)).history).toEqual([]);
  });

  it('accept rights requests through the feedback form', async () => {
    expect(await rpc<boolean>('send_feedback', [ANA, 'rights', 'Please remove the picture of my character.', 'legal@example.com', 'en'])).toBe(true);
    expect((await db.query<{ category: string }>('select category from encheres.feedback')).rows).toEqual([{ category: 'rights' }]);
  });
});

describe('friends', () => {
  it('are added with a tag and need the other player to agree', async () => {
    const ana = await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    expect(ana.tag).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    expect(ana.tag).not.toBe(ben.tag);

    const sent = await rpc<Friends>('add_friend', [ANA, ` #${ben.tag.toLowerCase()} `]);
    expect(sent.status).toBe('sent');
    expect(sent.outgoing.map((p) => p.name)).toEqual(['Ben']);
    expect(sent.friends).toEqual([]);
    expect((await friends(BEN)).incoming.map((p) => p.name)).toEqual(['Ana']);

    const accepted = await rpc<Friends>('answer_friend', [BEN, ana.id, true]);
    expect(accepted.friends.map((p) => p.name)).toEqual(['Ana']);
    expect(accepted.incoming).toEqual([]);
    expect((await friends(ANA)).friends.map((p) => p.name)).toEqual(['Ben']);
  });

  it('report what happened to a request', async () => {
    const ana = await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    const add = async (who: string, tag: string) => (await rpc<Friends>('add_friend', [who, tag])).status;
    expect(await add(ANA, 'ZZZZZZZ')).toBe('unknown');
    expect(await add(ANA, ana.tag)).toBe('self');
    expect(await add(ANA, ben.tag)).toBe('sent');
    expect(await add(ANA, ben.tag)).toBe('sent');
    // Asking back is the same as accepting.
    expect(await add(BEN, ana.tag)).toBe('accepted');
    expect(await add(ANA, ben.tag)).toBe('already');
    expect((await db.query('select 1 from encheres.friends')).rows).toHaveLength(1);
  });

  it('can be declined, withdrawn and removed', async () => {
    const ana = await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    await rpc('add_friend', [ANA, ben.tag]);
    expect((await rpc<Friends>('answer_friend', [BEN, ana.id, false])).incoming).toEqual([]);
    expect((await friends(ANA)).outgoing).toEqual([]);

    await rpc('add_friend', [ANA, ben.tag]);
    expect((await rpc<Friends>('remove_friend', [ANA, ben.id])).outgoing).toEqual([]);

    await befriend(ANA, BEN);
    expect((await rpc<Friends>('remove_friend', [BEN, ana.id])).friends).toEqual([]);
    expect((await friends(ANA)).friends).toEqual([]);
  });

  it('cannot be accepted by anyone but the player who was asked', async () => {
    const ana = await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    await named(CAM, 'Cam');
    await rpc('add_friend', [ANA, ben.tag]);
    await rpc('answer_friend', [CAM, ana.id, true]);
    await rpc('answer_friend', [ANA, ben.id, true]);
    expect((await friends(ANA)).friends).toEqual([]);
  });

  it('are limited in number of requests a day', async () => {
    const ben = await named(BEN, 'Ben');
    for (let i = 0; i < 40; i++) await rpc('add_friend', [ANA, 'ZZZZZZZ']);
    expect(await rpcError('add_friend', [ANA, ben.tag])).toContain('RATE_LIMITED');
  });

  it('have their own leaderboard', async () => {
    await named(ANA, 'Ana');
    await named(BEN, 'Ben');
    await named(CAM, 'Cam');
    await named(DAN, 'Dan');
    await setTrophies(ANA, 300, 'naruto');
    await setTrophies(BEN, 900, 'naruto');
    await setTrophies(CAM, 600, 'naruto');
    await setTrophies(DAN, 1200, 'naruto');
    await befriend(ANA, BEN);
    await befriend(CAM, ANA);
    await rpc('add_friend', [ANA, (await profile(DAN)).tag]); // not accepted

    const board = await rpc<Board>('leaderboard', [ANA, 'naruto', null, true]);
    expect(board.rows.map((r) => r.name)).toEqual(['Ben', 'Cam', 'Ana']);
    expect(board.me).toEqual({ rank: 3, value: 300 });
    expect((await rpc<Board>('leaderboard', [ANA, 'overall', null, true])).total).toBe(3);
    expect((await rpc<Board>('leaderboard', [ANA, 'naruto', null, false])).total).toBe(4);
    // Without a profile there are no friends to show.
    expect((await rpc<Board>('leaderboard', [null, 'naruto', null, true])).rows).toEqual([]);
  });
});

describe('invitations', () => {
  const room = (who: string, name: string) => rpc('create_room', [who, name, 500, 5, 10, 10, poolFor('naruto')]);

  it('reach a friend and lead to the room', async () => {
    await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    await befriend(ANA, BEN);
    const lobby = await room(ANA, 'Ana');
    expect(await rpc<boolean>('invite_friend', [ANA, lobby.code, ben.id])).toBe(true);
    expect((await friends(BEN)).invites).toMatchObject([{ code: lobby.code, from: 'Ana' }]);

    // Joining fills the room: the invitation is gone.
    await rpc('join_room', [lobby.code, BEN, 'Ben']);
    expect((await friends(BEN)).invites).toEqual([]);
  });

  it('can be declined', async () => {
    await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    await befriend(ANA, BEN);
    const lobby = await room(ANA, 'Ana');
    await rpc('invite_friend', [ANA, lobby.code, ben.id]);
    expect((await rpc<Friends>('dismiss_invite', [BEN, lobby.code])).invites).toEqual([]);
  });

  it('are only for friends, from a player in a private room that has not started', async () => {
    const ana = await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    const cam = await named(CAM, 'Cam');
    await befriend(ANA, BEN);
    const lobby = await room(ANA, 'Ana');
    expect(await rpcError('invite_friend', [ANA, lobby.code, cam.id])).toContain('NOT_ALLOWED');
    expect(await rpcError('invite_friend', [BEN, lobby.code, ana.id])).toContain('NOT_IN_ROOM');
    expect(await rpcError('invite_friend', [ANA, 'ZZZZZ', ben.id])).toContain('ROOM_NOT_FOUND');
    const queue = await search(ANA, 'Ana', 'naruto');
    expect(await rpcError('invite_friend', [ANA, queue.code, ben.id])).toContain('NOT_ALLOWED');
  });

  it('expire with the room', async () => {
    await named(ANA, 'Ana');
    const ben = await named(BEN, 'Ben');
    await befriend(ANA, BEN);
    const lobby = await room(ANA, 'Ana');
    await rpc('invite_friend', [ANA, lobby.code, ben.id]);
    await db.query(`update encheres.invites set created_at = now() - interval '31 minutes'`);
    expect((await friends(BEN)).invites).toEqual([]);
    await db.query('delete from encheres.rooms where code = $1', [lobby.code]);
    expect((await db.query('select 1 from encheres.invites')).rows).toHaveLength(0);
  });
});

describe('permissions', () => {
  it('expose the friends functions and keep the tables closed', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const fn of [
      'public.get_friends(text)',
      'public.add_friend(text, text)',
      'public.answer_friend(text, uuid, boolean)',
      'public.remove_friend(text, uuid)',
      'public.invite_friend(text, text, uuid)',
      'public.dismiss_invite(text, text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(true);
    }
    for (const fn of ['encheres.roll_season()', 'encheres.friends_json(uuid)', 'encheres.overall(uuid)']) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(false);
    }
    for (const table of ['ratings', 'friends', 'invites']) {
      expect(await check(`select has_table_privilege('anon', 'encheres.${table}', 'select') as ok`)).toBe(false);
      expect(await check(`select relrowsecurity as ok from pg_class where oid = 'encheres.${table}'::regclass`)).toBe(true);
    }
  });
});
