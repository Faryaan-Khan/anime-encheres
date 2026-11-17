/** One profile on several devices: recovery codes and sign-in. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { poolFor } from '../../src/data/characters';
import { createTestDb, type TestDb } from './helpers';

const PHONE = 'phone-token-0123456789abcdef';
const LAPTOP = 'laptop-token-0123456789abcdef';
const OTHER = 'other-token-0123456789abcdef';
const pool = poolFor('one-piece');
const CODE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;

let db: PGlite;
let rpc: TestDb['rpc'];
let rpcError: TestDb['rpcError'];

interface Profile {
  id: string;
  name: string;
  avatar: number;
  games: number;
  saved: boolean;
  hasCode: boolean;
}

const profile = (who: string) => rpc<Profile>('get_profile', [who]);
const newCode = (who: string) => rpc<string>('recovery_code', [who]);
const redeem = (who: string, code: string) => rpc<Profile | null>('redeem_code', [who, code]);
const signedInAs = (uid: string | null) =>
  db.query(`select set_config('request.jwt.claims', $1, false)`, [
    uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '',
  ]);
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  ({ db, rpc, rpcError } = await createTestDb());
});

beforeEach(async () => {
  await signedInAs(null);
  await db.exec(`
    delete from encheres.rooms; delete from encheres.matches; delete from encheres.devices;
    delete from encheres.profiles; delete from encheres.rate_limits;`);
});

describe('recovery codes', () => {
  it('are long, readable and stored only as a hash', async () => {
    await rpc('update_profile', [PHONE, 'Ana', 'MY', 3]);
    expect((await profile(PHONE)).hasCode).toBe(false);
    const code = await newCode(PHONE);
    expect(code).toMatch(CODE);
    expect((await profile(PHONE)).hasCode).toBe(true);
    const stored = (await db.query<{ recovery_hash: string }>('select recovery_hash from encheres.profiles')).rows[0];
    expect(stored.recovery_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.recovery_hash).not.toContain(code.replace(/-/g, '').toLowerCase());
    expect(await newCode(PHONE)).not.toBe(code);
  });

  it('open the profile on another device', async () => {
    const phone = await rpc<Profile>('update_profile', [PHONE, 'Ana', 'MY', 3]);
    await rpc('update_profile', [LAPTOP, 'Laptop', null, 0]);
    const code = await newCode(PHONE);

    const opened = await redeem(LAPTOP, code);
    expect(opened).toMatchObject({ id: phone.id, name: 'Ana', avatar: 3 });
    expect((await profile(LAPTOP)).id).toBe(phone.id);

    // Both devices now edit and read the same profile.
    await rpc('update_profile', [LAPTOP, 'Ana K', 'FR', 5]);
    expect(await profile(PHONE)).toMatchObject({ name: 'Ana K', avatar: 5 });
    expect((await db.query('select 1 from encheres.devices')).rows).toHaveLength(1);
  });

  it('are forgiving about how they are typed', async () => {
    const phone = await profile(PHONE);
    const code = await newCode(PHONE);
    expect((await redeem(LAPTOP, ` ${code.toLowerCase().replace(/-/g, ' ')} `))?.id).toBe(phone.id);
  });

  it('are cancelled by a newer one', async () => {
    await profile(PHONE);
    const first = await newCode(PHONE);
    const second = await newCode(PHONE);
    expect(await redeem(LAPTOP, first)).toBeNull();
    expect(await redeem(LAPTOP, second)).not.toBeNull();
  });

  it('cannot be guessed at speed', async () => {
    await profile(PHONE);
    await newCode(PHONE);
    expect(await redeem(LAPTOP, 'nope')).toBeNull();
    for (let i = 0; i < 7; i++) expect(await redeem(LAPTOP, 'AAAA-BBBB-CCCC-DDDD')).toBeNull();
    // Wrong answers are counted even though they are not errors.
    expect(await rpcError('redeem_code', [LAPTOP, 'AAAA-BBBB-CCCC-DDDD'])).toContain('RATE_LIMITED');
    expect((await db.query('select 1 from encheres.devices')).rows).toHaveLength(0);
  });

  it('are limited to ten new codes a day', async () => {
    for (let i = 0; i < 10; i++) await newCode(PHONE);
    expect(await rpcError('recovery_code', [PHONE])).toContain('RATE_LIMITED');
  });
});

describe('a profile on two devices', () => {
  it('collects the games of both', async () => {
    const phone = await rpc<Profile>('update_profile', [PHONE, 'Ana', null, 0]);
    await redeem(LAPTOP, await newCode(PHONE));

    // The laptop plays a ranked game against someone else and gives up.
    const waiting = await rpc('find_match', [OTHER, 'Cam', 500, 5, 10, 10, pool, null]);
    const game = await rpc('find_match', [LAPTOP, 'Ana', 500, 5, 10, 10, pool, null]);
    expect(game.code).toBe(waiting.code);
    await rpc('resign', [game.code, LAPTOP]);

    expect(await profile(PHONE)).toMatchObject({ id: phone.id, games: 1 });
    const board = await rpc<{ rows: Array<{ name: string; you: boolean | null }> }>('leaderboard', [PHONE, 'all', null]);
    expect(board.rows.find((r) => r.you)?.name).toBe('Ana');
  });

  it('is never paired with itself', async () => {
    await profile(PHONE);
    await redeem(LAPTOP, await newCode(PHONE));
    const phone = await rpc('find_match', [PHONE, 'Ana', 500, 5, 10, 10, pool, null]);
    const laptop = await rpc('find_match', [LAPTOP, 'Ana', 500, 5, 10, 10, pool, null]);
    expect(laptop.status).toBe('lobby');
    expect(laptop.code).not.toBe(phone.code);
  });
});

describe('signing in', () => {
  it('is required to link an account', async () => {
    expect(await rpcError('link_account', [PHONE])).toContain('NOT_ALLOWED');
  });

  it('saves the profile of the device that signs in first', async () => {
    const before = await rpc<Profile>('update_profile', [PHONE, 'Ana', null, 2]);
    expect(before.saved).toBe(false);
    await signedInAs(ALICE);
    const linked = await rpc<Profile>('link_account', [PHONE]);
    expect(linked).toMatchObject({ id: before.id, saved: true });
    // Signing in again changes nothing.
    expect((await rpc<Profile>('link_account', [PHONE])).id).toBe(before.id);
  });

  it('recovers the profile on a new device', async () => {
    const phone = await rpc<Profile>('update_profile', [PHONE, 'Ana', null, 2]);
    await signedInAs(ALICE);
    await rpc('link_account', [PHONE]);

    await rpc('update_profile', [LAPTOP, 'New device', null, 0]);
    const recovered = await rpc<Profile>('link_account', [LAPTOP]);
    expect(recovered).toMatchObject({ id: phone.id, name: 'Ana', saved: true });
    await signedInAs(null);
    expect((await profile(LAPTOP)).id).toBe(phone.id);
  });

  it('keeps accounts apart', async () => {
    await profile(PHONE);
    await signedInAs(ALICE);
    await rpc('link_account', [PHONE]);
    // Someone else signs in on the same device: the profile is not theirs to take.
    await signedInAs(BOB);
    expect(await rpcError('link_account', [PHONE])).toContain('ALREADY_LINKED');
    // On their own device they get their own profile.
    const bob = await rpc<Profile>('link_account', [OTHER]);
    expect(bob.id).not.toBe((await profile(PHONE)).id);
  });

  type Linked = Profile & { outcome: string; tag: string };
  const link = (who: string, intent?: string) =>
    rpc<Linked>('link_account', intent === undefined ? [who] : [who, intent]);
  const exists = async (id: string) =>
    (await db.query('select 1 from encheres.profiles where id = $1', [id])).rows.length === 1;
  const withGames = (who: string) =>
    db.query(`update encheres.profiles set games = 3 where token_hash = encheres.token_hash($1)`, [who]);

  it('turns a guest into the Google account, keeping everything', async () => {
    const guest = await rpc<Profile>('update_profile', [PHONE, 'Ana', 'MY', 2]);
    await withGames(PHONE);
    await signedInAs(ALICE);
    const linked = await link(PHONE, 'link');
    expect(linked).toMatchObject({ id: guest.id, name: 'Ana', games: 3, saved: true, outcome: 'linked' });
    expect((await link(PHONE, 'link')).outcome).toBe('already');
  });

  it('starts a new profile when the guest chooses to, deleting the guest', async () => {
    const guest = await rpc<Profile>('update_profile', [PHONE, 'Ana', 'MY', 2]);
    await withGames(PHONE);
    await signedInAs(ALICE);
    const fresh = await link(PHONE, 'fresh');
    expect(fresh).toMatchObject({ name: 'Player', games: 0, saved: true, outcome: 'created' });
    expect(fresh.id).not.toBe(guest.id);
    expect(fresh.tag).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    expect(await exists(guest.id)).toBe(false);
    await signedInAs(null);
    expect((await profile(PHONE)).id).toBe(fresh.id);
    // The account is found again on another device.
    await signedInAs(ALICE);
    expect(await link(LAPTOP, 'fresh')).toMatchObject({ id: fresh.id, outcome: 'switched' });
  });

  it('opens the existing account and leaves a guest with progress behind', async () => {
    const account = await rpc<Profile>('update_profile', [PHONE, 'Ana', null, 2]);
    await signedInAs(ALICE);
    await link(PHONE, 'link');
    await signedInAs(null);
    const guest = await rpc<Profile>('update_profile', [LAPTOP, 'Guest', null, 0]);
    await withGames(LAPTOP);
    await signedInAs(ALICE);
    expect(await link(LAPTOP, 'link')).toMatchObject({ id: account.id, outcome: 'switched' });
    expect(await exists(guest.id)).toBe(true);
    await signedInAs(null);
    expect((await profile(LAPTOP)).id).toBe(account.id);
  });

  it('cleans up an empty guest when switching', async () => {
    await profile(PHONE);
    await signedInAs(ALICE);
    await link(PHONE, 'link');
    await signedInAs(null);
    const empty = await profile(LAPTOP);
    await signedInAs(ALICE);
    expect((await link(LAPTOP, 'link')).outcome).toBe('switched');
    expect(await exists(empty.id)).toBe(false);
  });

  it('rejects an unknown choice', async () => {
    await signedInAs(ALICE);
    expect(await rpcError('link_account', [PHONE, 'merge'])).toContain('INVALID_INPUT');
  });

  it('ignores a malformed sign-in', async () => {
    await db.query(`select set_config('request.jwt.claims', 'not json', false)`);
    expect(await rpcError('link_account', [PHONE])).toContain('NOT_ALLOWED');
    await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`);
    expect(await rpcError('link_account', [PHONE])).toContain('NOT_ALLOWED');
  });
});
