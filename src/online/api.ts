/**
 * Thin client for the five Postgres functions that make up the online API.
 * The browser never touches a table: see supabase/migrations/0001_init.sql.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameView, Settings } from '../game/types';
import { readStored, writeStored } from '../storage';
import { ONLINE_AVAILABLE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export const SERVER_ERRORS = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'GAME_ALREADY_STARTED',
  'NOT_IN_ROOM',
  'HOST_ONLY',
  'NEED_TWO_PLAYERS',
  'ALREADY_PLAYING',
  'NOT_PLAYING',
  'NOT_YOUR_TURN',
  'WRONG_PHASE',
  'INVALID_BID',
  'TEAM_FULL',
  'INVALID_INPUT',
] as const;

export type OnlineErrorCode = (typeof SERVER_ERRORS)[number] | 'NETWORK' | 'UNKNOWN';

export class OnlineError extends Error {
  constructor(public readonly code: OnlineErrorCode) {
    super(code);
    this.name = 'OnlineError';
  }
}

/** Maps whatever went wrong to one of the codes the UI can explain. */
export function toOnlineError(error: unknown): OnlineError {
  if (error instanceof OnlineError) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const known = SERVER_ERRORS.find((code) => message.includes(code));
  if (known) return new OnlineError(known);
  if (/fetch|network|load failed|timeout/i.test(message)) return new OnlineError('NETWORK');
  return new OnlineError('UNKNOWN');
}

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!ONLINE_AVAILABLE) throw new OnlineError('UNKNOWN');
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/**
 * A random secret kept on this device. It is the player's identity in a room;
 * the server stores only its hash.
 */
export function getPlayerToken(): string {
  let token = readStored('ae.token');
  if (!token || token.length < 32) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    writeStored('ae.token', token);
  }
  return token;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<GameView> {
  let result;
  try {
    result = await getClient().rpc(fn, args);
  } catch (error) {
    throw toOnlineError(error);
  }
  if (result.error) throw toOnlineError(result.error);
  return result.data as GameView;
}

export function createRoom(name: string, settings: Settings, pool: string[]): Promise<GameView> {
  return rpc('create_room', {
    p_token: getPlayerToken(),
    p_name: name,
    p_budget: settings.budget,
    p_team_size: settings.teamSize,
    p_min_bid: settings.minBid,
    p_increment: settings.increment,
    p_pool: pool,
  });
}

export function joinRoom(code: string, name: string): Promise<GameView> {
  return rpc('join_room', { p_code: code, p_token: getPlayerToken(), p_name: name });
}

export function getRoom(code: string): Promise<GameView> {
  return rpc('get_room', { p_code: code, p_token: getPlayerToken() });
}

export function startGame(code: string): Promise<GameView> {
  return rpc('start_game', { p_code: code, p_token: getPlayerToken() });
}

export type PlayAction = 'draw' | 'bid' | 'pass' | 'next';

export function play(code: string, action: PlayAction, amount?: number): Promise<GameView> {
  return rpc('play', {
    p_code: code,
    p_token: getPlayerToken(),
    p_action: action,
    p_amount: amount ?? null,
  });
}
