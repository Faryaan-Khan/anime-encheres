/** Ranked 1v1v1: matchmaking for three, stand-ins, giving up, trophies by place. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameView } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';
const DIA = 'dia-token-0123456789abcdef';

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

type View = GameView & { format: string; verse: string };

const search = (who: string, name: string, verse = 'naruto', code: string | null = null) =>
  rpc<View>('find_trio', [who, name, verse, code]);
const age = (code: string, seconds: number) =>
  db.query(`update encheres.rooms set created_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);
const idle = (code: string, seconds: number) =>
  db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);
const room = (code: string) =>
  db
    .query<{ bot_seats: number[] | null; left_seats: number[] | null; status: string }>(
      'select bot_seats, left_seats, status from encheres.rooms where code = $1',
      [code],
    )
    .then((r) => r.rows[0]);
const trioTrophies = (who: string) =>
  db
    .query<{ trophies: number }>(
      `select r.trophies from encheres.ratings r join encheres.profiles p on p.id = r.profile
        where p.token_hash = encheres.token_hash($1) and r.mode = 'trio'`,
      [who],
    )
    .then((r) => r.rows[0]?.trophies ?? null);
const setTrophies = (who: string, trophies: number) =>
  db.query(
    `insert into encheres.ratings (profile, mode, trophies, best, games, season_best, season_games)
     select id, 'trio', $2, $2, 1, $2, 1 from encheres.profiles where token_hash = encheres.token_hash($1)
     on conflict (profile, mode) do update set trophies = $2, best = $2`,
    [who, trophies],
  );

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.matches; delete from encheres.ratings;
    delete from encheres.devices; delete from encheres.profiles; delete from encheres.rate_limits;
    update encheres.config set value = 'true' where key = 'opponent_enabled';
    update encheres.config set value = '[12, 18]' where key = 'opponent_after_seconds';
    update encheres.config set value = '0' where key = 'opponent_pace';`);
});

/** Plays a running game to the end: people pass or open at the minimum, the computer plays its seats. */
async function playOut(code: string, people: Record<number, string>): Promise<View> {
  for (let step = 0; step < 2000; step++) {
    const view = await rpc<View>('get_room', [code, Object.values(people)[0]]);
    if (view.status === 'finished') return view;
    const actor = view.phase === 'draw' ? view.drawer : view.phase === 'bidding' ? view.turn : null;
    const who = actor === null ? null : people[actor];
    if (view.phase === 'reveal') {
      await rpc('play', [code, Object.values(people)[0], 'next', null]);
    } else if (who) {
      const action = view.phase === 'draw' ? 'draw' : view.highBidder === null ? 'bid' : 'pass';
      await rpc('play', [code, who, action, action === 'bid' ? view.settings.minBid : null]);
    } else {
      await idle(code, 30); // let the computer move
    }
  }
  throw new Error('game did not finish');
}

describe('1v1v1 matchmaking', () => {
  it('seats three players of the same universe and starts', async () => {
    const ana = await search(ANA, 'Ana');
    expect([ana.status, ana.format, ana.verse]).toEqual(['lobby', 'trio', 'naruto']);
    // Another universe is another queue.
    const other = await search(DIA, 'Dia', 'bleach');
    expect(other.code).not.toBe(ana.code);
    const ben = await search(BEN, 'Ben');
    expect(ben.code).toBe(ana.code);
    expect(ben.status).toBe('lobby');
    const cam = await search(CAM, 'Cam');
    expect(cam.code).toBe(ana.code);
    expect(cam.status).toBe('playing');
    expect(cam.players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cam']);
    expect(cam.settings).toMatchObject({ budget: 500, teamSize: 5 });
    // Those already waiting learn on their next poll.
    expect((await search(ANA, 'Ana', 'naruto', ana.code)).status).toBe('playing');
  });

  it('fills empty seats with stand-ins after the wait, and they play', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    expect((await search(ANA, 'Ana', 'naruto', ana.code)).status).toBe('lobby');
    await age(ana.code!, 60);
    const started = await search(ANA, 'Ana', 'naruto', ana.code);
    expect(started.status).toBe('playing');
    expect(started.players).toHaveLength(3);
    const r = await room(ana.code!);
    expect(r.bot_seats).toHaveLength(1);
    // A stand-in looks like anyone else: no tag, an ordinary name.
    expect(started.players.every((p) => !('tag' in p))).toBe(true);
    const people = Object.fromEntries(
      started.players
        .filter((p) => !r.bot_seats!.includes(p.seat))
        .map((p) => [p.seat, p.name === 'Ana' ? ANA : BEN]),
    );
    const end = await playOut(ana.code!, people);
    expect(end.result?.places).toHaveLength(3);
    expect(end.result?.mode).toBe('trio');
    expect(await trioTrophies(ANA)).not.toBeNull();
    expect(await trioTrophies(BEN)).not.toBeNull();
    const match = (
      await db.query<{ kind: string; mode: string; places: number[] }>(`select kind, mode, places from encheres.matches`)
    ).rows[0];
    expect(match).toMatchObject({ kind: 'ranked', mode: 'trio' });
  });

  it('two stand-ins for a player alone', async () => {
    const ana = await search(ANA, 'Ana', 'mix');
    await age(ana.code!, 60);
    const started = await search(ANA, 'Ana', 'mix', ana.code);
    expect(started.status).toBe('playing');
    expect((await room(ana.code!)).bot_seats).toHaveLength(2);
    const seat = started.you as number;
    const end = await playOut(ana.code!, { [seat]: ANA });
    expect(end.status).toBe('finished');
  });

  it('leaving the queue frees only that place', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    await rpc('leave_queue', [ana.code, BEN]);
    const view = await search(ANA, 'Ana', 'naruto', ana.code);
    expect(view.players.map((p) => p.name)).toEqual(['Ana']);
    await rpc('leave_queue', [ana.code, ANA]);
    expect((await db.query(`select 1 from encheres.rooms`)).rows).toHaveLength(0);
  });

  it('rejects a mode that is not a universe or mixed', async () => {
    expect(await rpcError('find_trio', [ANA, 'Ana', 'trio', null])).toContain('INVALID_INPUT');
    expect(await rpcError('find_trio', [ANA, 'Ana', 'nope', null])).toContain('INVALID_INPUT');
  });
});

describe('1v1v1 results', () => {
  async function threePlaying(): Promise<string> {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    await search(CAM, 'Cam');
    return ana.code!;
  }
  const seatOf = async (code: string, who: string) => (await rpc<View>('get_room', [code, who])).you as number;

  it('give trophies by place: about +30, +2 and -26 between equals', async () => {
    const code = await threePlaying();
    for (const who of [ANA, BEN, CAM]) await setTrophies(who, 300);
    // Ana gets the strongest team, Ben the middle one, Cam the weakest.
    const teams: Record<string, string[]> = {
      [ANA]: ['naruto-uzumaki', 'sasuke-uchiha'],
      [BEN]: ['kakashi-hatake'],
      [CAM]: ['konohamaru-sarutobi'],
    };
    for (const [who, team] of Object.entries(teams)) {
      await db.query(`update encheres.room_players set team = $3 where room_code = $1 and seat = $2`, [
        code,
        await seatOf(code, who),
        team,
      ]);
    }
    await db.query(`update encheres.rooms set status = 'finished', phase = 'finished' where code = $1`, [code]);
    await db.query(`select encheres.settle_trio($1)`, [code]);
    expect([await trioTrophies(ANA), await trioTrophies(BEN), await trioTrophies(CAM)]).toEqual([330, 302, 274]);
    const view = await rpc<View>('get_room', [code, ANA]);
    const places = view.result!.places!;
    expect([places[await seatOf(code, ANA)], places[await seatOf(code, BEN)], places[await seatOf(code, CAM)]]).toEqual([
      1, 2, 3,
    ]);
    // The overall score counts 1v1v1 as one mode of ten.
    const overall = (await rpc<{ trophies: number }>('get_profile', [ANA])).trophies;
    expect(overall).toBe(33);
  });

  it('a player who gives up is placed last; a stand-in plays out their seat and the others finish', async () => {
    const code = await threePlaying();
    const cam = await seatOf(code, CAM);
    await rpc('resign', [code, CAM]);
    const r = await room(code);
    expect(r.status).toBe('playing');
    expect(r.left_seats).toEqual([cam]);
    expect(r.bot_seats).toEqual([cam]);
    const people = { [await seatOf(code, ANA)]: ANA, [await seatOf(code, BEN)]: BEN };
    const end = await playOut(code, people);
    expect(end.result!.places![cam]).toBe(3);
    expect((await trioTrophies(CAM))!).toBe(0);
  });

  it('three time-outs in a row count as giving up', async () => {
    const code = await threePlaying();
    for (let i = 0; i < 3; i++) {
      const view = await rpc<View>('get_room', [code, ANA]);
      const actor = view.phase === 'draw' ? view.drawer : view.turn;
      await idle(code, 40);
      await db.query(`update encheres.room_players set seen_at = now() where room_code = $1`, [code]);
      const after = await rpc<View>('get_room', [code, ANA]);
      if ((await room(code)).left_seats?.length) {
        expect((await room(code)).left_seats).toEqual([actor]);
        return;
      }
      expect(after.strikes?.[actor]).toBeGreaterThan(0);
    }
    // The same player may not have been on the clock three times in a row:
    // force it on the player to move now.
    const view = await rpc<View>('get_room', [code, ANA]);
    const actor = view.phase === 'draw' ? view.drawer : view.turn;
    await db.query(`update encheres.room_players set strikes = 2 where room_code = $1 and seat = $2`, [code, actor]);
    await idle(code, 40);
    await rpc('get_room', [code, ANA]);
    expect((await room(code)).left_seats).toEqual([actor]);
  });

  it('when every player has gone, the game ends at once', async () => {
    const ana = await search(ANA, 'Ana');
    await age(ana.code!, 60);
    await search(ANA, 'Ana', 'naruto', ana.code);
    await rpc('resign', [ana.code, ANA]);
    expect((await room(ana.code!)).status).toBe('finished');
  });

  it('show on the 1v1v1 leaderboard', async () => {
    const code = await threePlaying();
    await rpc('resign', [code, CAM]);
    await playOut(code, { [await seatOf(code, ANA)]: ANA, [await seatOf(code, BEN)]: BEN });
    const board = await rpc<{ rows: Array<{ name: string }> }>('leaderboard', [ANA, 'trio', null]);
    expect(board.rows.map((r) => r.name).sort()).toEqual(['Ana', 'Ben', 'Cam']);
  });
});
