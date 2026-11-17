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
    expect(joined.deckCount).toBe(20);

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
    expect(await rpcError('find_match', [ANA, 'Ana', 500, 5, 10, 10, pool.slice(0, 5), null])).toContain('INVALID_INPUT');
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

  it('reports how long the player to act has been idle', async () => {
    const ana = await search(ANA, 'Ana');
    await search(BEN, 'Ben');
    await backdate(ana.code!, 42);
    const view = await rpc('get_room', [ana.code, ANA]);
    expect(view.idle).toBeGreaterThanOrEqual(42);
    expect(view.idle).toBeLessThan(45);
  });

  it('lets the waiting player claim the win only after the limit', async () => {
    const ana = await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const actor = game.drawer;
    const waiter: Seat = actor === 0 ? 1 : 0;

    expect(await rpcError('claim_forfeit', [game.code, token(waiter)])).toContain('TOO_EARLY');
    await backdate(game.code!, 59);
    expect(await rpcError('claim_forfeit', [game.code, token(waiter)])).toContain('TOO_EARLY');
    await backdate(game.code!, 61);
    // The idle player cannot claim against the one who is waiting for them.
    expect(await rpcError('claim_forfeit', [game.code, token(actor)])).toContain('TOO_EARLY');

    const won = await rpc('claim_forfeit', [game.code, token(waiter)]);
    expect(won.status).toBe('finished');
    expect(won.forfeit).toBe(actor);
    expect(ana.code).toBe(game.code);
  });

  it('restarts the clock with every action and never runs during a reveal', async () => {
    const ana = await search(ANA, 'Ana');
    const game = await search(BEN, 'Ben');
    const drawer = game.drawer;
    const rival: Seat = drawer === 0 ? 1 : 0;
    await backdate(game.code!, 61);
    await rpc('play', [game.code, token(drawer), 'draw', null]); // acting resets the clock
    expect(await rpcError('claim_forfeit', [game.code, token(rival)])).toContain('TOO_EARLY');

    await rpc('play', [game.code, token(drawer), 'pass', null]);
    const reveal = await rpc('play', [game.code, token(rival), 'pass', null]);
    expect(reveal.phase).toBe('reveal');
    await backdate(game.code!, 300);
    expect(await rpcError('claim_forfeit', [game.code, token(drawer)])).toContain('TOO_EARLY');
    expect(await rpcError('claim_forfeit', [game.code, token(rival)])).toContain('TOO_EARLY');
    expect(ana.code).toBe(game.code);
  });
});

describe('permissions', () => {
  it('exposes the new functions to the API roles and nothing else', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const fn of [
      'public.find_match(text, text, integer, integer, integer, integer, text[], text)',
      'public.leave_queue(text, text)',
      'public.resign(text, text)',
      'public.claim_forfeit(text, text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(true);
    }
    for (const fn of ['encheres.begin_game(text)', 'encheres.end_by_forfeit(text, smallint)']) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(false);
    }
  });
});
