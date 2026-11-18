/** Shared setup for the database tests: the real migrations inside PGlite. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { GameView } from '../../src/game/types';

export const MIGRATIONS = [
  '0001_init.sql',
  '0002_matchmaking.sql',
  '0003_ranking.sql',
  '0004_character_powers.sql',
  '0005_accounts_and_opponent.sql',
  '0006_modes_and_friends.sql',
  '0007_seasons.sql',
  '0008_opponent_brain.sql',
  '0009_google_accounts.sql',
  '0010_fair_play.sql',
  '0011_autopilot.sql',
  '0012_passes_and_scales.sql',
  '0013_old_site_and_auto_bid.sql',
];

export function readMigration(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), 'utf8');
}

export interface TestDb {
  db: PGlite;
  rpc<T = GameView>(fn: string, args: unknown[]): Promise<T>;
  /** Resolves to the error message of a call that must fail. */
  rpcError(fn: string, args: unknown[]): Promise<string>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  // Roles that exist on Supabase and that the migrations grant to.
  await db.exec('create role anon nologin; create role authenticated nologin;');
  const all = MIGRATIONS.map(readMigration).join('\n');
  await db.exec(all);
  await db.exec(all); // every migration must be safe to run twice

  const rpc = async <T = GameView>(fn: string, args: unknown[]): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
    const res = await db.query<{ out: T }>(`select public.${fn}(${placeholders}) as out`, args);
    return res.rows[0].out;
  };
  const rpcError = async (fn: string, args: unknown[]): Promise<string> => {
    try {
      await rpc(fn, args);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`${fn} should have failed`);
  };
  return { db, rpc, rpcError };
}
