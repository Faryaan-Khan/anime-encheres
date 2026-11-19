/** Rooms beyond the private two-player room: public rooms. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { poolFor } from '../../src/data/characters';
import type { GameView } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';
const pool = poolFor('naruto');

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface PublicRoom {
  code: string;
  host: string;
  verse: string;
  budget: number;
  teamSize: number;
  players: number;
  seats: number;
  mine: boolean;
}
type RoomView = GameView & { public: boolean; verse: string; players: Array<{ name: string; tag?: string | null }> };

const create = (who: string, name: string, open: boolean, verse: string | null = 'naruto') =>
  rpc<RoomView>('create_room', [who, name, 500, 5, 10, 10, pool, open, verse]);
const list = (who: string) => rpc<PublicRoom[]>('public_rooms', [who]);

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.devices;
    delete from encheres.profiles; delete from encheres.rate_limits;`);
});

describe('public rooms', () => {
  it('are listed with their settings until someone joins', async () => {
    const room = await create(ANA, 'Ana', true);
    expect(room.public).toBe(true);
    expect(room.verse).toBe('naruto');
    await create(BEN, 'Ben', false);

    const seen = await list(CAM);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      code: room.code, host: 'Ana', verse: 'naruto', budget: 500, teamSize: 5, players: 1, seats: 2, mine: false,
    });
    expect((await list(ANA))[0].mine).toBe(true);

    await rpc('join_room', [room.code, CAM, 'Cam']);
    expect(await list(BEN)).toHaveLength(0);
  });

  it('disappear when the host has gone quiet, and once the game starts', async () => {
    const room = await create(ANA, 'Ana', true);
    await db.query(`update encheres.room_players set seen_at = now() - interval '2 minutes'`);
    expect(await list(BEN)).toHaveLength(0);
    // The host's waiting screen polls the room, which brings it back.
    await rpc('get_room', [room.code, ANA]);
    expect(await list(BEN)).toHaveLength(1);

    await rpc('join_room', [room.code, BEN, 'Ben']);
    await rpc('start_game', [room.code, ANA]);
    expect(await list(CAM)).toHaveLength(0);
  });

  it('show players their tags so they can become friends; private rooms do not', async () => {
    await rpc('update_profile', [ANA, 'Ana', null, null]);
    const tag = (await db.query<{ tag: string }>(`select tag from encheres.profiles`)).rows[0].tag;
    const open = await create(ANA, 'Ana', true);
    const joined = await rpc<RoomView>('join_room', [open.code, BEN, 'Ben']);
    expect(joined.players[0].tag).toBe(tag);
    expect(joined.players[1].tag).toBeNull();

    const closed = await create(ANA, 'Ana', false);
    const other = await rpc<RoomView>('join_room', [closed.code, CAM, 'Cam']);
    expect(other.players[0].tag ?? null).toBeNull();
  });

  it('keep working for clients that send the old arguments', async () => {
    const room = await rpc<RoomView>('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool]);
    expect(room.public).toBe(false);
    expect(room.verse).toBe('naruto');
  });

  it('reject a malformed universe label', async () => {
    expect(await rpcError('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool, true, 'Naruto!'])).toContain(
      'INVALID_INPUT',
    );
  });
});

const DIA = 'dia-token-0123456789abcdef';
const EVE = 'eve-token-0123456789abcdef';

type TeamView = RoomView & {
  format: string;
  members?: Array<Array<{ member: number; name: string }>>;
  active?: [number, number] | null;
  youMember?: number;
};

async function teamsRoom(open = false): Promise<string> {
  const room = await rpc<TeamView>('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool, open, 'naruto', 'teams']);
  expect(room.format).toBe('teams');
  return room.code as string;
}

describe('2v2 rooms', () => {
  it('seat four players, two per side, and need all four to start', async () => {
    const code = await teamsRoom(true);
    const ben = await rpc<TeamView>('join_room', [code, BEN, 'Ben']);
    expect([ben.you, ben.youMember]).toEqual([1, 0]);
    expect((await list(EVE))[0]).toMatchObject({ players: 2, seats: 4, format: 'teams' });
    const cam = await rpc<TeamView>('join_room', [code, CAM, 'Cam']);
    expect([cam.you, cam.youMember]).toEqual([0, 1]);
    expect(await rpcError('start_game', [code, ANA])).toContain('ROOM_NOT_READY');
    const dia = await rpc<TeamView>('join_room', [code, DIA, 'Dia']);
    expect([dia.you, dia.youMember]).toEqual([1, 1]);
    expect(dia.players.map((p) => p.name)).toEqual(['Ana & Cam', 'Ben & Dia']);
    expect(dia.members?.map((side) => side.map((m) => m.name))).toEqual([['Ana', 'Cam'], ['Ben', 'Dia']]);
    expect(await rpcError('join_room', [code, EVE, 'Eve'])).toContain('ROOM_FULL');
    expect(await list(EVE)).toHaveLength(0);
    // Only the host starts, not the host's teammate.
    expect(await rpcError('start_game', [code, CAM])).toContain('HOST_ONLY');
    const started = await rpc<TeamView>('start_game', [code, ANA]);
    expect(started.status).toBe('playing');
  });

  it('let players change side and leave a lobby; a side is never left without its first member', async () => {
    const code = await teamsRoom();
    await rpc('join_room', [code, BEN, 'Ben']); // side 1
    await rpc('join_room', [code, CAM, 'Cam']); // side 0, second
    const moved = await rpc<TeamView>('switch_side', [code, CAM]);
    expect([moved.you, moved.youMember]).toEqual([1, 1]);
    expect(moved.players.map((p) => p.name)).toEqual(['Ana', 'Ben & Cam']);
    // Ben, side 1's first member, moves over: Cam takes the front of side 1.
    const ben = await rpc<TeamView>('switch_side', [code, BEN]);
    expect([ben.you, ben.youMember]).toEqual([0, 1]);
    expect(ben.players.map((p) => p.name)).toEqual(['Ana & Ben', 'Cam']);
    await rpc('join_room', [code, DIA, 'Dia']); // side 1, second
    expect(await rpcError('switch_side', [code, DIA])).toContain('ROOM_FULL');
    // Cam leaves: Dia becomes side 1's first member.
    await rpc('leave_room', [code, CAM]);
    const view = await rpc<TeamView>('get_room', [code, DIA]);
    expect([view.you, view.youMember]).toEqual([1, 0]);
    expect(view.players.map((p) => p.name)).toEqual(['Ana & Ben', 'Dia']);
    expect(await rpcError('switch_side', [code, ANA])).toContain('HOST_ONLY');
    // The host leaving keeps the room.
    await rpc('leave_room', [code, ANA]);
    expect((await rpc<TeamView>('get_room', [code, ANA])).players).toHaveLength(2);
  });

  it('face every pairing in shuffled order; only those facing off play; the drawing side both see the card', async () => {
    const code = await teamsRoom();
    for (const [who, name] of [[BEN, 'Ben'], [CAM, 'Cam'], [DIA, 'Dia']]) await rpc('join_room', [code, who, name]);
    await rpc('start_game', [code, ANA]);
    const tokens = [
      [ANA, CAM],
      [BEN, DIA],
    ];
    const lineup = (await db.query<{ lineup: number[][] }>(`select lineup from encheres.rooms`)).rows[0].lineup;
    for (let block = 0; block + 4 <= lineup.length; block += 4) {
      const pairs = lineup.slice(block, block + 4).map((p) => p.join('')).sort();
      expect(pairs).toEqual(['00', '01', '10', '11']);
    }

    for (let round = 1; round <= 6; round++) {
      let view = await rpc<TeamView>('get_room', [code, ANA]);
      expect(view.round).toBe(round);
      const [a0, a1] = view.active as [number, number];
      expect([a0, a1]).toEqual(lineup[(round - 1) % lineup.length]);
      const drawer = view.drawer;
      const playing = tokens[drawer][drawer === 0 ? a0 : a1];
      const resting = tokens[drawer][drawer === 0 ? 1 - a0 : 1 - a1];
      expect(await rpcError('play', [code, resting, 'draw', null])).toContain('NOT_YOUR_TURN');
      view = await rpc<TeamView>('play', [code, playing, 'draw', null]);
      expect(view.card).not.toBeNull();
      // The teammate sitting out sees the card too; the other side does not.
      expect((await rpc<TeamView>('get_room', [code, resting])).card).toBe(view.card);
      const other = 1 - drawer;
      expect((await rpc<TeamView>('get_room', [code, tokens[other][0]])).card).toBeNull();
      expect((await rpc<TeamView>('get_room', [code, tokens[other][1]])).card).toBeNull();
      // The drawer opens; the other side's player facing off concedes; anyone moves on.
      await rpc('play', [code, playing, 'bid', 10]);
      const rival = tokens[other][other === 0 ? a0 : a1];
      expect(await rpcError('play', [code, tokens[other][other === 0 ? 1 - a0 : 1 - a1], 'pass', null])).toContain(
        'NOT_YOUR_TURN',
      );
      view = await rpc<TeamView>('play', [code, rival, 'pass', null]);
      expect(view.phase).toBe('reveal');
      expect(view.history.at(-1)?.winner).toBe(drawer);
      await rpc('play', [code, resting, 'next', null]);
    }
    // One budget and one roster per side.
    const end = await rpc<TeamView>('get_room', [code, DIA]);
    expect(end.players.map((p) => p.team.length).reduce((a, b) => a + b)).toBe(6);
    expect(end.players.every((p) => p.budget === 500 - p.team.length * 10)).toBe(true);
  });
});
