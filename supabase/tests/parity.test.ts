/**
 * Runs the real migration inside PGlite (Postgres compiled to WebAssembly)
 * and checks two things:
 *
 *  1. Security and validation of the public functions.
 *  2. Parity: random games are replayed through the SQL functions and the
 *     TypeScript engine at the same time, and every view must be identical.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { bid, canPass, createGame, draw, next, pass, requiredBid, toView } from '../../src/game/engine';
import { seeded } from '../../src/game/testing';
import type { GameState, GameView, Seat } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

/** Fields that only exist online; the engine has no equivalent. */
function withoutOnlineFields(view: GameView): GameView {
  const {
    matched: _matched,
    forfeit: _forfeit,
    idle: _idle,
    result: _result,
    turnSeconds: _turnSeconds,
    strikes: _strikes,
    maxStrikes: _maxStrikes,
    absent: _absent,
    awaySeconds: _awaySeconds,
    ...rest
  } = view as GameView & Record<string, unknown>;
  return rest;
}

const pool = Array.from({ length: 24 }, (_, i) => `c${i + 1}`);
const HOST = 'host-token-0123456789abcdef';
const GUEST = 'guest-token-0123456789abcdef';
const STRANGER = 'stranger-token-0123456789abcdef';

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

async function newRoom(budget = 500, teamSize = 5): Promise<string> {
  const view = await rpc('create_room', [HOST, 'Ana', budget, teamSize, 10, 10, pool]);
  return view.code!;
}

async function startedRoom(budget = 500, teamSize = 5): Promise<string> {
  const code = await newRoom(budget, teamSize);
  await rpc('join_room', [code, GUEST, 'Ben']);
  await rpc('start_game', [code, HOST]);
  return code;
}

const token = (seat: Seat) => (seat === 0 ? HOST : GUEST);

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

describe('rooms', () => {
  it('creates a lobby with a 5-character code and seats the host', async () => {
    const view = await rpc('create_room', [HOST, '  Ana  ', 500, 5, 10, 10, pool]);
    expect(view.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(view.status).toBe('lobby');
    expect(view.you).toBe(0);
    expect(view.players).toEqual([{ seat: 0, name: 'Ana', budget: 500, team: [], passes: 0 }]);
    expect(view.settings).toEqual({
      budget: 500,
      teamSize: 5,
      minBid: 10,
      increment: 10,
      passLimit: 3,
      poolSize: 24,
    });
  });

  it('validates input', async () => {
    const bad: unknown[][] = [
      ['short', 'Ana', 500, 5, 10, 10, pool],
      [HOST, '', 500, 5, 10, 10, pool],
      [HOST, 'x'.repeat(21), 500, 5, 10, 10, pool],
      [HOST, 'Ana', 5, 5, 10, 10, pool],
      [HOST, 'Ana', 500, 0, 10, 10, pool],
      [HOST, 'Ana', 500, 5, 0, 10, pool],
      [HOST, 'Ana', 500, 5, 10, 0, pool],
      [HOST, 'Ana', 500, 5, 10, 10, pool.slice(0, 9)],
      [HOST, 'Ana', 500, 5, 10, 10, [...pool.slice(0, 11), 'c1']],
    ];
    for (const args of bad) {
      expect(await rpcError('create_room', args)).toContain('INVALID_INPUT');
    }
  });

  it('lets a second player join, accepts lower-case codes, and refuses a third', async () => {
    const code = await newRoom();
    expect(await rpcError('start_game', [code, HOST])).toContain('NEED_TWO_PLAYERS');
    const view = await rpc('join_room', [` ${code.toLowerCase()} `, GUEST, 'Ben']);
    expect(view.you).toBe(1);
    expect(view.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(await rpcError('join_room', [code, STRANGER, 'Zed'])).toContain('ROOM_FULL');
    expect(await rpcError('join_room', ['ZZZZZ', GUEST, 'Ben'])).toContain('ROOM_NOT_FOUND');
  });

  it('lets a seated player come back, but nobody new once the game started', async () => {
    const code = await startedRoom();
    const back = await rpc('join_room', [code, GUEST, 'whatever']);
    expect(back.you).toBe(1);
    expect(back.players[1].name).toBe('Ben');
    expect(await rpcError('join_room', [code, STRANGER, 'Zed'])).toContain('GAME_ALREADY_STARTED');
  });

  it('only the host starts, and only once', async () => {
    const code = await newRoom();
    await rpc('join_room', [code, GUEST, 'Ben']);
    expect(await rpcError('start_game', [code, GUEST])).toContain('HOST_ONLY');
    const view = await rpc('start_game', [code, HOST]);
    expect(view.status).toBe('playing');
    expect(view.phase).toBe('draw');
    // The whole pool is dealt.
    expect(view.deckCount).toBe(pool.length);
    expect(await rpcError('start_game', [code, HOST])).toContain('ALREADY_PLAYING');
  });
});

describe('secrecy', () => {
  it('refuses anyone without a seat', async () => {
    const code = await startedRoom();
    expect(await rpcError('get_room', [code, STRANGER])).toContain('NOT_IN_ROOM');
    expect(await rpcError('play', [code, STRANGER, 'draw', null])).toContain('NOT_IN_ROOM');
    expect(await rpcError('start_game', [code, STRANGER])).toContain('NOT_IN_ROOM');
  });

  it('shows the card to the drawer only, and never the deck', async () => {
    const code = await startedRoom();
    const before = await rpc('get_room', [code, HOST]);
    const drawer = before.drawer;
    const rival: Seat = drawer === 0 ? 1 : 0;

    const drawerView = await rpc('play', [code, token(drawer), 'draw', null]);
    const rivalView = await rpc('get_room', [code, token(rival)]);
    expect(drawerView.card).toMatch(/^c\d+$/);
    expect(rivalView.card).toBeNull();

    const deck = (
      await db.query<{ deck: string[] }>('select deck from encheres.rooms where code = $1', [code])
    ).rows[0].deck;
    const rivalJson = JSON.stringify(rivalView);
    const drawerJson = JSON.stringify(drawerView);
    for (const hidden of deck) {
      expect(rivalJson).not.toContain(`"${hidden}"`);
      expect(drawerJson).not.toContain(`"${hidden}"`);
    }
    expect(rivalJson).not.toContain(`"${drawerView.card}"`);

    // Once the card is resolved both players see it.
    await rpc('play', [code, token(drawer), 'pass', null]);
    const revealed = await rpc('play', [code, token(rival), 'pass', null]);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.card).toBe(drawerView.card);
  });

  it('stores only a hash of the player token', async () => {
    const code = await newRoom();
    const rows = await db.query<{ token_hash: string }>(
      'select token_hash from encheres.room_players where room_code = $1',
      [code],
    );
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].token_hash).not.toContain(HOST);
  });

  it('gives the API roles no access to the tables or helpers', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const role of ['anon', 'authenticated']) {
      expect(await check(`select has_schema_privilege('${role}', 'encheres', 'usage') as ok`)).toBe(false);
      expect(await check(`select has_table_privilege('${role}', 'encheres.rooms', 'select') as ok`)).toBe(false);
      expect(
        await check(
          `select has_function_privilege('${role}', 'public.play(text, text, text, integer)', 'execute') as ok`,
        ),
      ).toBe(true);
    }
    expect(
      await check(
        `select relrowsecurity as ok from pg_class where oid = 'encheres.rooms'::regclass`,
      ),
    ).toBe(true);
  });
});

describe('rules enforced by the server', () => {
  it('rejects out-of-turn and invalid actions', async () => {
    const code = await startedRoom();
    const v = await rpc('get_room', [code, HOST]);
    const drawer = v.drawer;
    const rival: Seat = drawer === 0 ? 1 : 0;
    expect(await rpcError('play', [code, token(rival), 'draw', null])).toContain('NOT_YOUR_TURN');
    expect(await rpcError('play', [code, token(drawer), 'bid', 50])).toContain('WRONG_PHASE');
    await rpc('play', [code, token(drawer), 'draw', null]);
    expect(await rpcError('play', [code, token(rival), 'bid', 50])).toContain('NOT_YOUR_TURN');
    expect(await rpcError('play', [code, token(drawer), 'bid', 5])).toContain('INVALID_BID');
    expect(await rpcError('play', [code, token(drawer), 'bid', 501])).toContain('INVALID_BID');
    expect(await rpcError('play', [code, token(drawer), 'bid', null])).toContain('INVALID_BID');
    expect(await rpcError('play', [code, token(drawer), 'dance', null])).toContain('UNKNOWN_ACTION');
    await rpc('play', [code, token(drawer), 'bid', 50]);
    expect(await rpcError('play', [code, token(rival), 'bid', 55])).toContain('INVALID_BID');
    expect(await rpcError('play', [code, token(drawer), 'next', null])).toContain('WRONG_PHASE');
  });

  it('refuses actions before the game starts', async () => {
    const code = await newRoom();
    expect(await rpcError('play', [code, HOST, 'draw', null])).toContain('NOT_PLAYING');
  });
});

describe('parity with the TypeScript engine', () => {
  const cases = [
    { seed: 11, budget: 300, teamSize: 4 },
    { seed: 12, budget: 500, teamSize: 5 },
    { seed: 13, budget: 60, teamSize: 3 },
    { seed: 14, budget: 1000, teamSize: 6 },
    { seed: 15, budget: 100, teamSize: 2 },
    { seed: 16, budget: 500, teamSize: 1 },
  ];

  it.each(cases)('seed $seed (budget $budget, team of $teamSize)', async ({ seed, budget, teamSize }) => {
    const rng = seeded(seed);
    const code = await startedRoom(budget, teamSize);

    // Read the server's secret shuffle so the engine can replay the same game.
    const secret = (
      await db.query<{ deck: string[]; drawer: number }>(
        'select deck, drawer from encheres.rooms where code = $1',
        [code],
      )
    ).rows[0];
    let local: GameState = createGame({
      settings: { budget, teamSize, minBid: 10, increment: 10 },
      names: ['Ana', 'Ben'],
      pool,
      deck: secret.deck,
      firstDrawer: secret.drawer as Seat,
    });

    const sameAsServer = async () => {
      for (const seat of [0, 1] as Seat[]) {
        const server = await rpc('get_room', [code, token(seat)]);
        const expected = toView(local, seat, {
          code,
          version: server.version,
          poolSize: pool.length,
        });
        expect(server.matched).toBe(false);
        expect(server.forfeit).toBeNull();
        expect(withoutOnlineFields(server)).toEqual(expected);
      }
    };

    await sameAsServer();
    let steps = 0;
    while (local.phase !== 'finished') {
      if (++steps > 2000) throw new Error('game did not terminate');
      if (local.phase === 'draw') {
        await rpc('play', [code, token(local.drawer), 'draw', null]);
        local = draw(local, local.drawer);
      } else if (local.phase === 'reveal') {
        const seat: Seat = rng() < 0.5 ? 0 : 1;
        await rpc('play', [code, token(seat), 'next', null]);
        local = next(local);
      } else if (rng() < 0.6 || !canPass(local, local.turn)) {
        const seat = local.turn;
        const min = requiredBid(local);
        const amount = Math.min(local.players[seat].budget, min + Math.floor(rng() * 6) * 10);
        await rpc('play', [code, token(seat), 'bid', amount]);
        local = bid(local, seat, amount);
      } else {
        const seat = local.turn;
        await rpc('play', [code, token(seat), 'pass', null]);
        local = pass(local, seat);
      }
      await sameAsServer();
    }

    const final = await rpc('get_room', [code, HOST]);
    expect(final.status).toBe('finished');

    // A rematch resets budgets and teams and deals a fresh deck.
    const rematch = await rpc('start_game', [code, HOST]);
    expect(rematch.status).toBe('playing');
    expect(rematch.round).toBe(1);
    expect(rematch.history).toEqual([]);
    expect(rematch.players.map((p) => [p.budget, p.team])).toEqual([
      [budget, []],
      [budget, []],
    ]);
  });
});
