/** Quick matches: pairing, the waiting queue, resigning and the turn timer. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { poolFor } from '../../src/data/characters';
import type { Seat } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

// Ranked games are judged by the server, so the pool must be real characters.
const pool = poolFor('one-piece').slice(0, 24);
const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

const search = (token: string, name: string, code: string | null = null) =>
  rpc('find_match', [token, name, 500, 5, 10, 10, pool, code]);

const waitingRooms = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from encheres.rooms where matched and status = 'lobby'`)).rows[0].n;

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec('delete from encheres.rooms; delete from encheres.matches; delete from encheres.profiles;');
});

describe('pairing', () => {
  it('makes the first player wait and starts the game when a second arrives', async () => {
    const waiting = await search(ANA, 'Ana');
    expect(waiting.status).toBe('lobby');
    expect(waiting.matched).toBe(true);
    expect(waiting.you).toBe(0);

    const joined = await search(BEN, 'Ben');
    expect(joined.code).toBe(waiting.code);
    expect(joined.status).toBe('playing');
    expect(joined.you).toBe(1);
    expect(joined.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(joined.deckCount).toBe(poolFor('one-piece').length); // the server deals the whole universe

    // The waiting player learns about it on the next poll.
    const started = await search(ANA, 'Ana', waiting.code);
    expect(started.status).toBe('playing');
    expect(started.you).toBe(0);
    expect(await waitingRooms()).toBe(0);
  });

  it('keeps waiting on every poll while nobody else is there', async () => {
    const first = await search(ANA, 'Ana');
    const again = await search(ANA, 'Ana', first.code);
    expect(again.code).toBe(first.code);
    expect(again.status).toBe('lobby');
    expect(await waitingRooms()).toBe(1);
  });

  it('never pairs a player with themselves, and a new search replaces the old one', async () => {
    const first = await search(ANA, 'Ana');
    const second = await search(ANA, 'Ana');
    expect(second.status).toBe('lobby');
    expect(second.code).not.toBe(first.code);
    expect(await waitingRooms()).toBe(1);
  });

  it('ignores a waiting player who stopped polling', async () => {
    const ghost = await search(ANA, 'Ana');
    await db.query(`update encheres.rooms set seen_at = now() - interval '30 seconds' where code = $1`, [ghost.code]);
    const ben = await search(BEN, 'Ben');
    expect(ben.status).toBe('lobby');
    expect(ben.code).not.toBe(ghost.code);
  });

  it('brings together two players who started waiting at the same moment', async () => {
    // Ana's room looks abandoned while Ben searches, so Ben opens his own.
    const ana = await search(ANA, 'Ana');
    await db.query(`update encheres.rooms set seen_at = now() - interval '30 seconds' where code = $1`, [ana.code]);
    const ben = await search(BEN, 'Ben');
    expect(await waitingRooms()).toBe(2);

    // Ana polls first and is the older room, so she keeps waiting; Ben's next poll moves him in.
    expect((await search(ANA, 'Ana', ana.code)).status).toBe('lobby');
    const moved = await search(BEN, 'Ben', ben.code);
    expect(moved.code).toBe(ana.code);
    expect(moved.status).toBe('playing');
    expect(moved.you).toBe(1);
    expect(await waitingRooms()).toBe(0);
  });

  it('pairs in order of arrival and leaves a third player waiting', async () => {
    const ana = await search(ANA, 'Ana');
    expect((await search(BEN, 'Ben')).code).toBe(ana.code);
    const cam = await search(CAM, 'Cam');
    expect(cam.status).toBe('lobby');
    expect(cam.code).not.toBe(ana.code);
  });

  it('validates the name and the settings of a new waiting room', async () => {
    expect(await rpcError('find_match', [ANA, '', 500, 5, 10, 10, pool, null])).toContain('INVALID_INPUT');
    expect(await rpcError('find_match', [ANA, 'Ana', 500, 5, 10, 10, pool, null, 'no-such-mode'])).toContain('INVALID_INPUT');
    expect(await rpcError('find_match', [ANA, 'Ana', 5, 5, 10, 10, pool, null])).toContain('INVALID_INPUT');
    expect(await rpcError('find_match', ['short', 'Ana', 500, 5, 10, 10, pool, null])).toContain('INVALID_INPUT');
  });
});

describe('matched rooms are closed', () => {
  it('cannot be joined by code, started by hand or restarted', async () => {
    const ana = await search(ANA, 'Ana');
    expect(await rpcError('join_room', [ana.code, CAM, 'Cam'])).toContain('ROOM_NOT_FOUND');
    expect(await rpcError('start_game', [ana.code, ANA])).toContain('NOT_ALLOWED');
    await search(BEN, 'Ben');
    expect(await rpcError('get_room', [ana.code, CAM])).toContain('NOT_IN_ROOM');
    await rpc('resign', [ana.code, BEN]);
    expect(await rpcError('start_game', [ana.code, ANA])).toContain('NOT_ALLOWED');
  });

  it('leave private rooms untouched', async () => {
    const room = await rpc('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool]);
    expect(room.matched).toBe(false);
    expect((await search(BEN, 'Ben')).code).not.toBe(room.code);
    expect(await rpcError('resign', [room.code, ANA])).toContain('NOT_ALLOWED');
    expect(await rpcError('claim_forfeit', [room.code, ANA])).toContain('NOT_ALLOWED');
  });
});

describe('leaving', () => {
  it('leave_queue removes a waiting room', async () => {
    const ana = await search(ANA, 'Ana');
    expect(await rpc('leave_queue', [ana.code, ANA])).toBeNull();
    expect(await waitingRooms()).toBe(0);
    expect(await rpc('leave_queue', [ana.code, ANA])).toBeNull(); // already gone
  });

  it('leave_queue returns the game if an opponent just arrived', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    const view = await rpc('leave_queue', [ana.code, ANA]);
    expect(view.status).toBe('playing');
    expect(view.forfeit).toBeNull();
    expect(await rpcError('leave_queue', [ana.code, CAM])).toContain('NOT_IN_ROOM');
  });

  it('resign ends the game in favour of the other player', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    const view = await rpc('resign', [ana.code, BEN]);
    expect(view.status).toBe('finished');
    expect(view.forfeit).toBe(1);
    expect((await rpc('get_room', [ana.code, ANA])).forfeit).toBe(1);
    expect(await rpcError('play', [ana.code, ANA, 'draw', null])).toContain('NOT_PLAYING');
    // Resigning twice changes nothing.
    expect((await rpc('resign', [ana.code, ANA])).forfeit).toBe(1);
  });
});

describe('turn timer', () => {
  const token = (seat: Seat) => (seat === 0 ? ANA : BEN);
  const backdate = (code: string, seconds: number) =>
    db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);

  const strikes = async (code: string) =>
    (
      await db.query<{ strikes: number }>(
        'select strikes from encheres.room_players where room_code = $1 order by seat',
        [code],
      )
    ).rows.map((r) => r.strikes);

  it('reports how long the player to act has been idle, and the limits', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    await backdate(ana.code!, 22);
    const view = await rpc('get_room', [ana.code, ANA]);
    expect(view.idle).toBeGreaterThanOrEqual(22);
    expect(view.idle).toBeLessThan(25);
    expect(view).toMatchObject({ turnSeconds: 30, maxStrikes: 3, awaySeconds: 40, strikes: [0, 0] });
  });

  it('plays for the slow player when time runs out, without anyone claiming', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const actor = game.drawer;
    const waiter: Seat = actor === 0 ? 1 : 0;

    await backdate(game.code!, 29);
    expect((await rpc('get_room', [game.code, token(waiter)])).phase).toBe('draw');
    await backdate(game.code!, 31);
    // Either player's poll applies the clock: the card is drawn for them.
    const drawn = await rpc('get_room', [game.code, token(waiter)]);
    expect(drawn.phase).toBe('bidding');
    expect(drawn.turn).toBe(actor);
    expect(drawn.strikes?.[actor]).toBe(1);
    expect(drawn.status).toBe('playing');

    // Bidding: the slow player passes.
    await backdate(game.code!, 31);
    const passed = await rpc('get_room', [game.code, token(actor)]);
    expect(passed.passed[actor]).toBe(true);
    expect(await strikes(game.code!)).toEqual(actor === 0 ? [2, 0] : [0, 2]);
  });

  it('ends the match on the third time out', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const actor = game.drawer;
    const waiter: Seat = actor === 0 ? 1 : 0;
    await db.query('update encheres.room_players set strikes = 2 where room_code = $1 and seat = $2', [game.code, actor]);
    await backdate(game.code!, 31);
    const view = await rpc('get_room', [game.code, token(waiter)]);
    expect(view.status).toBe('finished');
    expect(view.forfeit).toBe(actor);
    expect(view.result?.winner).toBe(waiter);
  });

  it('still answers old clients that claim the win', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const actor = game.drawer;
    const waiter: Seat = actor === 0 ? 1 : 0;
    expect(await rpcError('claim_forfeit', [game.code, token(waiter)])).toContain('TOO_EARLY');
    await backdate(game.code!, 29);
    expect(await rpcError('claim_forfeit', [game.code, token(waiter)])).toContain('TOO_EARLY');
  });

  it('restarts the clock with every action, and moves on from a result nobody moved on from', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const drawer = game.drawer;
    const rival: Seat = drawer === 0 ? 1 : 0;
    await backdate(game.code!, 25);
    await rpc('play', [game.code, token(drawer), 'draw', null]); // acting resets the clock
    await backdate(game.code!, 25);
    expect((await rpc('get_room', [game.code, token(rival)])).strikes).toEqual([0, 0]);

    await rpc('play', [game.code, token(drawer), 'pass', null]);
    const reveal = await rpc('play', [game.code, token(rival), 'pass', null]);
    expect(reveal.phase).toBe('reveal');
    await backdate(game.code!, 11);
    expect((await rpc('get_room', [game.code, token(rival)])).phase).toBe('reveal');
    await backdate(game.code!, 13);
    const moved = await rpc('get_room', [game.code, token(rival)]);
    expect(moved.phase).toBe('draw');
    expect(moved.round).toBe(2);
    // Moving on is nobody's fault.
    expect(moved.strikes).toEqual([0, 0]);
  });
});

describe('leaving', () => {
  const token = (seat: Seat) => (seat === 0 ? ANA : BEN);
  const seenAgo = (code: string, seat: Seat, seconds: number) =>
    db.query(
      `update encheres.room_players set seen_at = now() - make_interval(secs => $3) where room_code = $1 and seat = $2`,
      [code, seat, seconds],
    );
  const roomSeenAgo = (code: string, seconds: number) =>
    db.query(`update encheres.rooms set seen_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);

  it('gives the win to the player who stayed when the other is gone for 40 seconds', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    await roomSeenAgo(game.code!, 120);
    await seenAgo(game.code!, 1, 39);
    const view = await rpc('get_room', [game.code, ANA]);
    expect(view.status).toBe('playing');
    expect(view.absent?.[1]).toBeGreaterThanOrEqual(39);
    expect(view.absent?.[0]).toBe(0);

    await seenAgo(game.code!, 1, 41);
    const won = await rpc('get_room', [game.code, ANA]);
    expect(won.status).toBe('finished');
    expect(won.forfeit).toBe(1);
    expect(won.result?.winner).toBe(0);
  });

  it('counts a closed page as gone after a few seconds, unless the player comes back', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    await roomSeenAgo(game.code!, 120);
    await rpc('leaving', [game.code, BEN]);
    // A reload comes back in time.
    expect((await rpc('get_room', [game.code, BEN])).status).toBe('playing');

    await rpc('leaving', [game.code, BEN]);
    await db.query(
      `update encheres.room_players set seen_at = seen_at - interval '9 seconds' where room_code = $1 and seat = 1`,
      [game.code],
    );
    const won = await rpc('get_room', [game.code, ANA]);
    expect(won.status).toBe('finished');
    expect(won.forfeit).toBe(1);
  });

  it('ignores leaving notes from strangers and never counts the computer as gone', async () => {
    expect(await rpc('leaving', ['NOPE', CAM])).toBeFalsy();
    const waiting = await search(ANA, 'Ana');
    await db.query(`update encheres.rooms set created_at = now() - interval '20 seconds' where code = $1`, [waiting.code]);
    const game = await search(ANA, 'Ana', waiting.code);
    expect(game.status).toBe('playing');
    await roomSeenAgo(game.code!, 600);
    await seenAgo(game.code!, 1, 600);
    expect((await rpc('get_room', [game.code, ANA])).status).toBe('playing');
    void token;
  });
});

describe('automatic draw', () => {
  const token = (seat: Seat) => (seat === 0 ? ANA : BEN);

  it('draws for a player with a full team, so the other bids at once', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const drawer = game.drawer;
    const rival: Seat = drawer === 0 ? 1 : 0;
    // The rival's team is already full.
    await db.query(
      `update encheres.room_players set team = array_fill('x'::text, array[5]) where room_code = $1 and seat = $2`,
      [game.code, rival],
    );
    await rpc('play', [game.code, token(drawer), 'draw', null]);
    const reveal = await rpc('play', [game.code, token(drawer), 'bid', 10]);
    expect(reveal.phase).toBe('reveal');
    const after = await rpc('play', [game.code, token(rival), 'next', null]);
    // The rival never has to draw: the next card is already up for bidding,
    // and it is the other player's turn to bid straight away.
    expect(after.phase).toBe('bidding');
    expect(after.drawer).toBe(rival);
    expect(after.turn).toBe(drawer);
    expect(after.passed[rival]).toBe(true);
    const mine = await rpc('get_room', [game.code, token(drawer)]);
    expect(mine).toMatchObject({ phase: 'bidding', turn: drawer, you: drawer, card: null });
    const log = (await db.query<{ log: Array<{ a: string; s: number }> }>('select log from encheres.rooms where code = $1', [game.code]))
      .rows[0].log;
    expect(log.slice(-2)).toMatchObject([
      { a: 'next', s: rival },
      { a: 'draw', s: rival },
    ]);
  });
});

describe('a player who cannot buy any more', () => {
  const token = (seat: Seat) => (seat === 0 ? ANA : BEN);
  const finish = (code: string, seat: Seat) =>
    db.query(
      `update encheres.room_players set budget = 5, team = $3 where room_code = $1 and seat = $2`,
      [code, seat, pool.slice(0, 2)],
    );
  const seenAgo = (code: string, seat: Seat, seconds: number) =>
    db.query(
      `update encheres.room_players set seen_at = now() - make_interval(secs => $3) where room_code = $1 and seat = $2`,
      [code, seat, seconds],
    );
  const start = async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    await db.query(`update encheres.rooms set seen_at = now() - interval '2 minutes' where code = $1`, [game.code]);
    return game.code!;
  };

  it('never counts as having left, so their result stands', async () => {
    const code = await start();
    await finish(code, 1);
    await seenAgo(code, 1, 600);
    expect((await rpc('get_room', [code, ANA])).status).toBe('playing');
  });

  it('still wins if the other player, who could still buy, leaves', async () => {
    const code = await start();
    await finish(code, 1);
    await seenAgo(code, 0, 600);
    const view = await rpc('get_room', [code, BEN]);
    expect(view.status).toBe('finished');
    expect(view.forfeit).toBe(0);
  });

  it('can leave without giving up the match', async () => {
    const code = await start();
    await finish(code, 1);
    const view = await rpc('resign', [code, token(1)]);
    expect(view.status).toBe('playing');
    expect(view.forfeit ?? null).toBeNull();
    // Still allowed for a player who could buy.
    expect((await rpc('resign', [code, token(0)])).forfeit).toBe(0);
  });
});

describe('the minute sweep', () => {
  it('moves along and settles games that nobody is looking at', async () => {
    await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    await db.query(`update encheres.rooms set seen_at = now() - interval '2 minutes', updated_at = now() - interval '1 minute' where code = $1`, [game.code]);
    await db.query(`update encheres.room_players set seen_at = now() - interval '10 minutes' where room_code = $1`, [game.code]);
    expect((await db.query<{ n: number }>('select encheres.sweep_games() as n')).rows[0].n).toBe(1);
    const room = (await db.query<{ status: string; forfeit: number | null }>('select status, forfeit from encheres.rooms where code = $1', [game.code])).rows[0];
    expect(room.status).toBe('finished');
    expect(room.forfeit).not.toBeNull();
    expect((await db.query('select 1 from encheres.matches')).rows).toHaveLength(1);
  });
});

describe('passes and time-outs in a row', () => {
  const token = (seat: Seat) => (seat === 0 ? ANA : BEN);
  const backdate = (code: string, seconds: number) =>
    db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);
  const start = async () => {
    await search(ANA, 'Ana');
    return search(BEN, 'Ben');
  };

  it('allows three skipped cards each, while letting the other have a card stays free', async () => {
    const game = await start();
    const code = game.code!;
    let view = game;
    for (let skipped = 1; skipped <= 3; skipped++) {
      view = await rpc('play', [code, token(view.drawer), 'draw', null]);
      view = await rpc('play', [code, token(view.turn), 'pass', null]);
      view = await rpc('play', [code, token(view.turn), 'pass', null]);
      expect(view.players.map((p) => p.passes)).toEqual([skipped, skipped]);
      view = await rpc('play', [code, ANA, 'next', null]);
    }
    view = await rpc('play', [code, token(view.drawer), 'draw', null]);
    expect(await rpcError('play', [code, token(view.turn), 'pass', null])).toContain('NO_PASSES_LEFT');
    view = await rpc('play', [code, token(view.turn), 'bid', 10]);
    view = await rpc('play', [code, token(view.turn), 'pass', null]);
    expect(view.phase).toBe('reveal');
    expect(view.players.map((p) => p.passes)).toEqual([3, 3]);
  });

  it('bids the minimum for a timed-out player who has no pass left', async () => {
    const game = await start();
    const code = game.code!;
    await db.query('update encheres.room_players set passes = 3 where room_code = $1', [code]);
    const actor = game.drawer;
    await rpc('play', [code, token(actor), 'draw', null]);
    await backdate(code, 31);
    const view = await rpc('get_room', [code, token(actor === 0 ? 1 : 0)]);
    expect(view.highBidder).toBe(actor);
    expect(view.highBid).toBe(10);
    expect(view.strikes?.[actor]).toBe(1);
  });

  it('counts only time-outs in a row: a move of the player’s own clears them', async () => {
    const game = await start();
    const code = game.code!;
    const actor = game.drawer;
    await db.query('update encheres.room_players set strikes = 2 where room_code = $1 and seat = $2', [code, actor]);
    await rpc('play', [code, token(actor), 'draw', null]);
    const strikes = (
      await db.query<{ strikes: number }>('select strikes from encheres.room_players where room_code = $1 and seat = $2', [code, actor])
    ).rows[0].strikes;
    expect(strikes).toBe(0);
    // So the next time-out is the first again, not the third.
    await backdate(code, 31);
    const view = await rpc('get_room', [code, token(actor === 0 ? 1 : 0)]);
    expect(view.status).toBe('playing');
    expect(view.strikes?.[actor]).toBe(1);
  });
});

describe('permissions', () => {
  it('exposes the new functions to the API roles and nothing else', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const fn of [
      'public.find_match(text, text, integer, integer, integer, integer, text[], text, text)',
      'public.leave_queue(text, text)',
      'public.resign(text, text)',
      'public.claim_forfeit(text, text)',
      'public.leaving(text, text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(true);
    }
    for (const fn of ['encheres.begin_game(text)', 'encheres.end_by_forfeit(text, smallint)']) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(false);
    }
  });
});
