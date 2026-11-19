/** Friend requests from the results screen, to people and (as a pretence) to stand-ins. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { poolFor } from '../../src/data/characters';
import type { GameView } from '../../src/game/types';
import { createTestDb, type TestDb } from './helpers';

const ANA = 'ana-token-0123456789abcdef';
const BEN = 'ben-token-0123456789abcdef';
const CAM = 'cam-token-0123456789abcdef';
const DIA = 'dia-token-0123456789abcdef';
const pool = poolFor('one-piece');

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface Person {
  id: string;
  name: string;
  tag: string;
}
interface Friends {
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  status?: string;
}

const friends = (who: string) => rpc<Friends>('get_friends', [who]);
const finished = (code: string) =>
  db.query(`update encheres.rooms set status = 'finished', phase = 'finished', settled = true where code = $1`, [code]);

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await db.exec(`
    delete from encheres.rooms; delete from encheres.friends; delete from encheres.ghost_requests;
    delete from encheres.devices; delete from encheres.profiles; delete from encheres.rate_limits;
    update encheres.config set value = 'true' where key = 'opponent_enabled';
    update encheres.config set value = '[12, 18]' where key = 'opponent_after_seconds';`);
});

describe('friend requests after a match', () => {
  it('reach the player in that seat, even from a private room', async () => {
    const room = await rpc<GameView>('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool]);
    await rpc('join_room', [room.code, BEN, 'Ben']);
    await rpc('start_game', [room.code, ANA]);
    await finished(room.code!);
    const sent = await rpc<Friends>('add_friend_seat', [room.code, ANA, 1, 0]);
    expect(sent.status).toBe('sent');
    expect(sent.outgoing.map((p) => p.name)).toEqual(['Ben']);
    expect((await friends(BEN)).incoming.map((p) => p.name)).toEqual(['Ana']);
    // Not to oneself, and only from inside the room.
    expect(await rpcError('add_friend_seat', [room.code, ANA, 0, 0])).toContain('INVALID_INPUT');
    expect(await rpcError('add_friend_seat', [room.code, CAM, 0, 0])).toContain('NOT_IN_ROOM');
  });

  it('reach a 2v2 teammate or rival by side and member', async () => {
    const room = await rpc<GameView>('create_room', [ANA, 'Ana', 500, 5, 10, 10, pool, false, null, 'teams']);
    for (const [who, name] of [[BEN, 'Ben'], [CAM, 'Cam'], [DIA, 'Dia']]) await rpc('join_room', [room.code, who, name]);
    await rpc('start_game', [room.code, ANA]);
    await finished(room.code!);
    await rpc('add_friend_seat', [room.code, ANA, 1, 1]);
    expect((await friends(DIA)).incoming.map((p) => p.name)).toEqual(['Ana']);
  });

  it('to a stand-in look sent and stay unanswered; they can be cancelled', async () => {
    const waiting = await rpc<GameView>('find_match', [ANA, 'Ana', 500, 5, 10, 10, pool, null]);
    await db.query(`update encheres.rooms set created_at = now() - interval '30 seconds'`);
    const game = await rpc<GameView>('find_match', [ANA, 'Ana', 500, 5, 10, 10, pool, waiting.code]);
    expect(game.status).toBe('playing');
    const botSeat = 1 - (game.you as number);
    const botName = game.players[botSeat].name;
    await finished(game.code!);
    const sent = await rpc<Friends>('add_friend_seat', [game.code, ANA, botSeat, 0]);
    expect(sent.status).toBe('sent');
    expect(sent.outgoing).toHaveLength(1);
    expect(sent.outgoing[0].name).toBe(botName);
    expect(sent.outgoing[0].tag).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    // Sending again changes nothing; no real request exists.
    expect((await rpc<Friends>('add_friend_seat', [game.code, ANA, botSeat, 0])).outgoing).toHaveLength(1);
    expect((await db.query('select 1 from encheres.friends')).rows).toHaveLength(0);
    const after = await rpc<Friends>('remove_friend', [ANA, sent.outgoing[0].id]);
    expect(after.outgoing).toHaveLength(0);
  });

  it('received can all be declined at once', async () => {
    await rpc('update_profile', [ANA, 'Ana', null, null]);
    const tag = (await friends(ANA)) as unknown as { tag: string };
    for (const who of [BEN, CAM, DIA]) await rpc('add_friend', [who, tag.tag]);
    expect((await friends(ANA)).incoming).toHaveLength(3);
    const after = await rpc<Friends>('decline_all_friends', [ANA]);
    expect(after.incoming).toHaveLength(0);
    expect(after.friends).toHaveLength(0);
  });
});
