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
