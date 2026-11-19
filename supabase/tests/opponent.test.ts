/** The computer opponent that the database seats and plays when nobody else is looking for a match. */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideByRules, emptyMemory, observe, styleForSkill, type BotMemory } from '../../src/bot/bot';
import { poolFor } from '../../src/data/characters';
import { seeded } from '../../src/game/testing';
import type { GameView } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

const ANA = 'ana-token-0123456789abcdef';
const pool = poolFor('one-piece');

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface Room {
  status: string;
  phase: string;
  round: number;
  drawer: number;
  turn: number;
  version: number;
  high_bid: number;
  high_bidder: number | null;
  min_bid: number;
  increment: number;
  bot_seat: number | null;
  bot_token: string;
  bot_skill: number;
  card: string | null;
  forfeit: number | null;
}

const room = async (code: string) => (await db.query<Room>('select * from encheres.rooms where code = $1', [code])).rows[0];
const search = (who: string, code: string | null = null, cards: string[] = pool) =>
  rpc('find_match', [who, 'Ana', 500, 5, 10, 10, cards, code]);
const age = (code: string, seconds: number) =>
  db.query(`update encheres.rooms set created_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);
const idle = (code: string, seconds: number) =>
  db.query(`update encheres.rooms set updated_at = now() - make_interval(secs => $2) where code = $1`, [code, seconds]);
const setTrophies = async (who: string, trophies: number, mode = 'one-piece') => {
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

/** Ana waits long enough for the computer to sit down. Returns the room code. */
async function againstComputer(cards: string[] = pool): Promise<string> {
  const waiting = await search(ANA, null, cards);
  await age(waiting.code!, 20);
  const game = await search(ANA, waiting.code, cards);
  expect(game.status).toBe('playing');
  return game.code!;
}

/** A legal move for the player, picked at random. */
async function playerMove(code: string, rng: () => number): Promise<void> {
  const r = await room(code);
  if (r.phase === 'draw') {
    await rpc('play', [code, ANA, 'draw', null]);
    return;
  }
  const required = r.high_bidder === null ? r.min_bid : r.high_bid + r.increment;
  const view = await db.query<{ budget: number; passes: number }>(
    'select budget, passes from encheres.room_players where room_code = $1 and seat = 0',
    [code],
  );
  // Out of passes and nobody has bid: bidding is the only legal move.
  const mustBid = r.high_bidder === null && view.rows[0].passes >= 3;
  if (rng() < 0.55 || mustBid) {
    const amount = Math.min(view.rows[0].budget, required + Math.floor(rng() * 4) * r.increment);
    await rpc('play', [code, ANA, 'bid', amount]);
  } else {
    await rpc('play', [code, ANA, 'pass', null]);
  }
}

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.matches; delete from encheres.devices;
    delete from encheres.profiles; delete from encheres.rate_limits;
    delete from encheres.config where key = 'season';
    update encheres.config set value = 'true' where key = 'opponent_enabled';
    update encheres.config set value = '[12, 18]' where key = 'opponent_after_seconds';
    update encheres.config set value = '1' where key = 'opponent_pace';`);
});

describe('sitting down', () => {
  it('happens only after the player has waited', async () => {
    const waiting = await search(ANA);
    expect(waiting.status).toBe('lobby');
    await age(waiting.code!, 11);
    expect((await search(ANA, waiting.code)).status).toBe('lobby');
    await age(waiting.code!, 19);
    const game = await search(ANA, waiting.code);
    expect(game.status).toBe('playing');
    expect(game.code).toBe(waiting.code);
    expect(game.you).toBe(0);
    expect(game.players).toHaveLength(2);
  });

  it('looks like any other opponent', async () => {
    const code = await againstComputer();
    const view = await rpc('get_room', [code, ANA]);
    expect(view.players[1].name).not.toBe('Ana');
    expect(view.players[1].name).toMatch(/^[A-Za-z_0-9]{2,12}$/);
    expect(JSON.stringify(view)).not.toMatch(/bot|computer|skill/i);
    expect(Object.keys(view).sort()).toEqual(Object.keys(await rpc('get_room', [code, ANA])).sort());
  });

  it('can be switched off', async () => {
    await db.exec(`update encheres.config set value = 'false' where key = 'opponent_enabled'`);
    const waiting = await search(ANA);
    await age(waiting.code!, 60);
    expect((await search(ANA, waiting.code)).status).toBe('lobby');
  });

  it('matches its strength to the player', async () => {
    const skillAt = async (trophies: number) => {
      await db.exec('delete from encheres.rooms');
      await rpc('get_profile', [ANA]);
      await setTrophies(ANA, trophies);
      return (await room(await againstComputer())).bot_skill;
    };
    expect(await skillAt(0)).toBeLessThanOrEqual(0.1);
    const middle = await skillAt(600);
    expect(middle).toBeGreaterThanOrEqual(0.4);
    expect(middle).toBeLessThanOrEqual(0.6);
    expect(await skillAt(1500)).toBeGreaterThanOrEqual(0.9);
  });
});

describe('decisions', () => {
  it('uses the same style as the app for every skill', async () => {
    for (let i = 0; i <= 20; i++) {
      const skill = i / 20;
      const sql = (
        await db.query<{
          counts_cards: boolean; noise: number; bluff_chance: number; rival_bluff: number; greed: number; nerve: number;
        }>('select * from encheres.bot_style($1)', [skill])
      ).rows[0];
      const ts = styleForSkill(skill);
      expect([sql.counts_cards, sql.noise, sql.bluff_chance, sql.rival_bluff, sql.greed, sql.nerve]).toEqual([
        ts.countsCards, ts.noise, ts.bluffChance, ts.rivalBluffRate, ts.greed, ts.nerve,
      ]);
    }
  });

  it.each([0, 0.3, 0.5, 0.8, 1])(
    'are the ones the app would make, through whole games (skill %s)',
    async (skill) => {
      const rng = seeded(Math.round(skill * 100) + 7);
      let decisions = 0;
      for (const universe of ['one-piece', 'naruto', 'demon-slayer']) {
        const cards = poolFor(universe);
        await db.exec('delete from encheres.rooms');
        const code = await againstComputer(cards);
        await db.query('update encheres.rooms set bot_skill = $2 where code = $1', [code, skill]);
        // The server deals from its own list: use it in the same order.
        const dealt = (await db.query<{ pool: string[] }>('select pool from encheres.rooms where code = $1', [code])).rows[0].pool;
        expect([...dealt].sort()).toEqual([...cards].sort());
        let memory: BotMemory = emptyMemory();
        const moods = new Map<number, number>();

        for (let step = 0; step < 600; step++) {
          const r = await room(code);
          if (r.status !== 'playing') break;
          if (r.phase === 'reveal') {
            await rpc('play', [code, ANA, 'next', null]);
            continue;
          }
          const actor = r.phase === 'draw' ? r.drawer : r.turn;
          if (actor === 0) {
            await playerMove(code, rng);
            continue;
          }
          // One "mood" per round, shared by both implementations.
          if (!moods.has(r.round)) moods.set(r.round, rng());
          const mood = moods.get(r.round)!;
          const view = (
            await db.query<{ v: GameView }>('select encheres.room_view($1, 1::smallint) as v', [code])
          ).rows[0].v;
          memory = observe(memory, view, dealt);
          const expected = decideByRules(
            view,
            { pool: dealt, level: 'normal', memory, rng: () => mood },
            styleForSkill(skill),
          );
          memory = expected.memory;
          const chosen = (
            await db.query<{ c: { a: string; v: number | null } }>(
              'select encheres.bot_choice($1, $2, $2, $2) as c',
              [code, mood],
            )
          ).rows[0].c;
          expect([chosen.a, chosen.v], `round ${r.round}, ${universe}`).toEqual([
            expected.action.type,
            expected.action.type === 'bid' ? expected.action.amount : null,
          ]);
          await rpc('play', [code, r.bot_token, chosen.a, chosen.v]);
          decisions++;
        }
        expect((await room(code)).status).toBe('finished');
      }
      expect(decisions).toBeGreaterThan(40);
    },
    120000,
  );

  it('do not depend on a card the computer has not seen', async () => {
    const rng = seeded(11);
    let checked = 0;
    for (let game = 0; game < 4 && checked < 3; game++) {
      await db.exec('delete from encheres.rooms');
      const code = await againstComputer();
      await db.query('update encheres.rooms set bot_skill = 1 where code = $1', [code]);
      for (let step = 0; step < 400; step++) {
        const r = await room(code);
        if (r.status !== 'playing') break;
        if (r.phase === 'reveal') {
          await rpc('play', [code, ANA, 'next', null]);
        } else if ((r.phase === 'draw' ? r.drawer : r.turn) === 0) {
          await playerMove(code, rng);
        } else {
          const choice = async () =>
            JSON.stringify((await db.query('select encheres.bot_choice($1, 0.5, 0.5, 0.5) as c', [code])).rows[0]);
          const before = await choice();
          if (r.phase === 'bidding' && r.drawer === 0) {
            // Swap the hidden card for others: the choice must not move.
            for (const other of pool.filter((id) => id !== r.card).slice(0, 6)) {
              await db.query('update encheres.rooms set card = $2 where code = $1', [code, other]);
              expect(await choice()).toBe(before);
            }
            await db.query('update encheres.rooms set card = $2 where code = $1', [code, r.card]);
            checked++;
          }
          const c = JSON.parse(before).c as { a: string; v: number | null };
          await rpc('play', [code, r.bot_token, c.a, c.v]);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  }, 60000);
});

describe('playing', () => {
  it('takes its turn when the player asks for the room, after a pause', async () => {
    const code = await againstComputer();
    // Bring the game to a point where the computer must act.
    for (let step = 0; step < 50; step++) {
      const r = await room(code);
      if (r.phase === 'reveal' || (r.phase === 'draw' ? r.drawer : r.turn) === 1) break;
      await playerMove(code, seeded(3));
    }
    const before = await rpc('get_room', [code, ANA]);
    // Asked again at once: it is still thinking.
    expect((await rpc('get_room', [code, ANA])).version).toBe(before.version);
    await idle(code, 12);
    expect((await rpc('get_room', [code, ANA])).version).toBeGreaterThan(before.version);
  });

  it.each([1, 2, 3])('finishes a whole game and the result counts (game %i)', async (seed) => {
    const rng = seeded(seed);
    await rpc('get_profile', [ANA]);
    await setTrophies(ANA, 500);
    const code = await againstComputer();
    let view = await rpc('get_room', [code, ANA]);
    for (let step = 0; step < 800 && view.status === 'playing'; step++) {
      const mine = view.phase === 'draw' ? view.drawer === 0 : view.phase === 'bidding' && view.turn === 0;
      if (mine) await playerMove(code, rng);
      else await idle(code, 12);
      view = await rpc('get_room', [code, ANA]);
    }
    expect(view.status).toBe('finished');
    expect(view.forfeit).toBeNull();
    for (const p of view.players) expect(p.budget).toBeGreaterThanOrEqual(0);

    const result = view.result!;
    const expected = result.winner === null ? 0 : result.winner === 0 ? 30 : -26;
    expect(result.deltas![0]).toBe(expected);
    expect(result.trophies![0]).toBe(500 + expected);

    const profile = await rpc<{
      games: number;
      modes: Array<{ mode: string; trophies: number }>;
      recent: Array<{ opponent: string; kind: string }>;
    }>('get_profile', [ANA]);
    // One game was on the profile already (see setTrophies).
    expect(profile.games).toBe(2);
    expect(profile.modes).toMatchObject([{ mode: 'one-piece', trophies: 500 + expected }]);
    expect(profile.recent[0]).toMatchObject({ kind: 'ranked', opponent: view.players[1].name });

    // The computer has no profile and never appears in a ranking.
    expect((await db.query('select 1 from encheres.profiles')).rows).toHaveLength(1);
    const match = (
      await db.query<{ profile0: string | null; profile1: string | null; opponent_skill: number; log: unknown[] }>(
        'select profile0, profile1, opponent_skill, log from encheres.matches',
      )
    ).rows[0];
    expect(match.profile0).not.toBeNull();
    expect(match.profile1).toBeNull();
    expect(match.opponent_skill).toBeGreaterThan(0.2);
    expect(match.log.length).toBeGreaterThan(10);
  }, 60000);

  it('wins when the player gives up', async () => {
    await rpc('get_profile', [ANA]);
    await setTrophies(ANA, 500);
    const code = await againstComputer();
    const view = await rpc('resign', [code, ANA]);
    expect(view.result).toMatchObject({ winner: 1, deltas: [-26, 0], trophies: [474, null] });
  });

  it('plays for a player whose time is up, and the third time loses the match', async () => {
    const code = await againstComputer();
    const myMove = async () => {
      for (let step = 0; step < 60; step++) {
        const r = await room(code);
        if (r.status !== 'playing') return;
        if (r.phase !== 'reveal' && (r.phase === 'draw' ? r.drawer : r.turn) === 0) return;
        await idle(code, 12);
        await rpc('get_room', [code, ANA]);
      }
    };
    const strikes = async () =>
      (await db.query<{ strikes: number }>('select strikes from encheres.room_players where room_code = $1 and seat = 0', [code]))
        .rows[0].strikes;

    await myMove();
    await idle(code, 29);
    expect((await rpc('get_room', [code, ANA])).strikes).toEqual([0, 0]);
    for (const strike of [1, 2]) {
      await myMove();
      await idle(code, 31);
      const view = await rpc('get_room', [code, ANA]);
      expect(view.status).toBe('playing');
      expect(view.strikes?.[0]).toBe(strike);
    }
    await myMove();
    await idle(code, 31);
    const view = await rpc('get_room', [code, ANA]);
    expect(await strikes()).toBe(3);
    expect(view.status).toBe('finished');
    expect(view.forfeit).toBe(0);
    expect((await rpc<{ forfeits: number; losses: number }>('get_profile', [ANA]))).toMatchObject({ forfeits: 1, losses: 1 });
  });

  it('wins a game the player walked away from', async () => {
    const code = await againstComputer();
    await idle(code, 80);
    await rpc('get_profile', [ANA]);
    expect((await room(code)).status).toBe('playing');
    await idle(code, 100);
    const profile = await rpc<{ losses: number; forfeits: number }>('get_profile', [ANA]);
    expect(profile).toMatchObject({ losses: 1, forfeits: 1 });
    expect((await room(code)).forfeit).toBe(0);
  });
});

describe('once the player cannot buy any more', () => {
  const finish = (code: string) =>
    db.query(`update encheres.room_players set budget = 5, team = $2 where room_code = $1 and seat = 0`, [
      code,
      pool.slice(0, 2),
    ]);

  it('the computer plays on at its pace while the player watches, as a person would', async () => {
    const code = await againstComputer();
    await finish(code);
    const watching = await rpc('get_room', [code, ANA]);
    expect(watching.status).toBe('playing');
    // It does move on, one step at a time, like a person.
    const before = (await room(code)).version;
    await idle(code, 30);
    await rpc('get_room', [code, ANA]);
    expect((await room(code)).version).toBeGreaterThan(before);
    expect((await room(code)).status).toBe('playing');
  });

  it('once the player has gone, the computer finishes its team at once and the game is settled', async () => {
    await rpc('get_profile', [ANA]);
    const code = await againstComputer();
    await finish(code);
    await db.query(`update encheres.room_players set seen_at = now() - interval '30 seconds' where room_code = $1`, [code]);
    await db.query(`select encheres.bot_step($1)`, [code]);
    const view = await rpc('get_room', [code, ANA]);
    expect(view.status).toBe('finished');
    expect(view.forfeit ?? null).toBeNull();
    expect(view.result).toBeTruthy();
    expect((await rpc<{ games: number; forfeits: number }>('get_profile', [ANA]))).toMatchObject({ games: 1, forfeits: 0 });
  });

  it('waits until the player has seen the result of their last purchase', async () => {
    const code = await againstComputer();
    await finish(code);
    await db.query(`update encheres.rooms set phase = 'reveal', updated_at = now() where code = $1`, [code]);
    expect((await rpc('get_room', [code, ANA])).status).toBe('playing');
  });

  it('settles the game for a player who walked away after finishing', async () => {
    const code = await againstComputer();
    await finish(code);
    await db.query(`update encheres.rooms set phase = 'reveal' where code = $1`, [code]);
    await idle(code, 100);
    await rpc('get_profile', [ANA]);
    const r = await room(code);
    expect(r.status).toBe('finished');
    expect(r.forfeit).toBeNull();
  });

  it('leaving is not giving up', async () => {
    const code = await againstComputer();
    await finish(code);
    const view = await rpc('resign', [code, ANA]);
    expect(view.status).toBe('finished');
    expect(view.forfeit ?? null).toBeNull();
  });
});

describe('trust', () => {
  it('no longer accepts results reported by the browser', async () => {
    expect(await rpcError('report_practice', [ANA, 'win', ['A', 'B'], [[], []]])).toMatch(/does not exist/);
  });

  it('keeps its workings out of reach of the API', async () => {
    const check = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0].ok;
    for (const fn of [
      'encheres.bot_choice(text, double precision, double precision, double precision)',
      'encheres.bot_step(text)',
      'encheres.seat_opponent(text, integer, text)',
      'encheres.sweep_abandoned(text)',
      'encheres.setting(text)',
    ]) {
      expect(await check(`select has_function_privilege('anon', '${fn}', 'execute') as ok`)).toBe(false);
    }
    for (const table of ['config', 'devices']) {
      expect(await check(`select has_table_privilege('anon', 'encheres.${table}', 'select') as ok`)).toBe(false);
      expect(await check(`select relrowsecurity as ok from pg_class where oid = 'encheres.${table}'::regclass`)).toBe(true);
    }
  });
});

describe('the stronger brain in the Edge Function', () => {
  // A stand-in for pg_net that records the requests instead of sending them.
  beforeAll(async () => {
    await db.exec(`
      create schema if not exists net;
      create table if not exists net.sent (url text, body jsonb);
      create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
      returns bigint language sql as $$ insert into net.sent values (url, body); select 1::bigint; $$;`);
  });
  beforeEach(async () => {
    await db.exec(`
      delete from net.sent;
      update encheres.config set value = '"https://example.test/functions/v1/opponent"'
       where key = 'opponent_function_url';`);
  });
  afterAll(async () => {
    await db.exec(`update encheres.config set value = 'null' where key = 'opponent_function_url'`);
  });

  /** A game in which it is the computer's turn to bid, after its pause. */
  async function computerToBid(skill: number): Promise<string> {
    const code = await againstComputer();
    await db.query('update encheres.rooms set bot_skill = $2 where code = $1', [code, skill]);
    for (let step = 0; step < 80; step++) {
      const r = await room(code);
      if (r.phase === 'bidding' && r.turn === 1) {
        await idle(code, 12);
        return code;
      }
      if (r.phase === 'reveal' || (r.phase === 'draw' ? r.drawer : r.turn) === 1) {
        await idle(code, 12);
        await rpc('get_room', [code, ANA]);
      } else {
        await playerMove(code, seeded(step + 1));
      }
    }
    throw new Error('the computer never had to bid');
  }
  const sent = async () => (await db.query<{ url: string; body: { code: string; nonce: string } }>('select * from net.sent')).rows;
  const claim = (code: string, nonce: string) =>
    rpc<{ view: GameView; pool: string[]; token: string; skill: number } | null>('opponent_claim', [code, nonce]);

  it('is asked once for a strong opponent, which then waits for it', async () => {
    const code = await computerToBid(0.9);
    const before = (await room(code)).version;
    await rpc('get_room', [code, ANA]);
    await rpc('get_room', [code, ANA]);
    const requests = await sent();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://example.test/functions/v1/opponent');
    expect(requests[0].body.code).toBe(code);
    expect(requests[0].body.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect((await room(code)).version).toBe(before);
  });

  it("gives the computer's own view, once, for the secret it issued", async () => {
    const code = await computerToBid(0.9);
    await rpc('get_room', [code, ANA]);
    const { nonce } = (await sent())[0].body;
    expect(await claim(code, 'x'.repeat(64))).toBeNull();
    const got = (await claim(code, nonce))!;
    expect(got.view.you).toBe(1);
    expect(got.skill).toBe(0.9);
    expect([...got.pool].sort()).toEqual([...pool].sort());
    const r = await room(code);
    expect(got.token).toBe(r.bot_token);
    // A card the player drew stays hidden from the computer.
    if (r.drawer === 0) expect(got.view.card).toBeNull();
    expect(await claim(code, nonce)).toBeNull();
    // The function then moves like any player.
    const after = await rpc('play', [code, got.token, 'pass', null]);
    expect(after.version).toBe(r.version + 1);
  });

  it('is not trusted to answer: the database moves after six seconds', async () => {
    const code = await computerToBid(0.9);
    await rpc('get_room', [code, ANA]);
    const before = (await room(code)).version;
    await db.query(`update encheres.rooms set bot_requested_at = now() - interval '7 seconds' where code = $1`, [code]);
    await rpc('get_room', [code, ANA]);
    expect((await room(code)).version).toBe(before + 1);
    expect(await sent()).toHaveLength(1);
  });

  it('is not used for weaker opponents', async () => {
    const code = await computerToBid(0.3);
    const before = (await room(code)).version;
    await rpc('get_room', [code, ANA]);
    expect(await sent()).toHaveLength(0);
    expect((await room(code)).version).toBe(before + 1);
  });

  it('is not used when no function is configured', async () => {
    await db.exec(`update encheres.config set value = 'null' where key = 'opponent_function_url'`);
    const code = await computerToBid(0.9);
    const before = (await room(code)).version;
    await rpc('get_room', [code, ANA]);
    expect(await sent()).toHaveLength(0);
    expect((await room(code)).version).toBe(before + 1);
  });
});
