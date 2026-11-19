/**
 * Thin client for the five Postgres functions that make up the online API.
 * The browser never touches a table: see supabase/migrations/0001_init.sql.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameView, RoomFormat, Settings } from '../game/types';
import { readStored, removeStored, writeStored } from '../storage';
import { ONLINE_AVAILABLE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export const SERVER_ERRORS = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'GAME_ALREADY_STARTED',
  'NOT_IN_ROOM',
  'HOST_ONLY',
  'NEED_TWO_PLAYERS',
  'ROOM_NOT_READY',
  'ALREADY_PLAYING',
  'NOT_PLAYING',
  'NOT_YOUR_TURN',
  'WRONG_PHASE',
  'INVALID_BID',
  'NO_PASSES_LEFT',
  'NAME_LOCKED',
  'NAME_COOLDOWN',
  'TEAM_FULL',
  'INVALID_INPUT',
  'TOO_EARLY',
  'NOT_ALLOWED',
  'RATE_LIMITED',
  'ALREADY_LINKED',
  'SIGN_IN_CANCELLED',
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

/** Forgets this device's identity; the next call creates a new guest. */
export function resetPlayerToken(): void {
  removeStored('ae.token');
}

async function rpc<T = GameView>(fn: string, args: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await getClient().rpc(fn, args);
  } catch (error) {
    throw toOnlineError(error);
  }
  if (result.error) throw toOnlineError(result.error);
  return result.data as T;
}

export interface RoomOptions {
  /** Listed for everyone online (a public room), or reached only by its code. */
  public?: boolean;
  /** The universe id, or `mix`, shown in the list of public rooms. */
  verse?: string;
  /** One against one (default), or two sides of two. */
  format?: RoomFormat;
}

export function createRoom(
  name: string,
  settings: Settings,
  pool: string[],
  options: RoomOptions = {},
): Promise<GameView> {
  return rpc('create_room', {
    p_token: getPlayerToken(),
    p_name: name,
    p_budget: settings.budget,
    p_team_size: settings.teamSize,
    p_min_bid: settings.minBid,
    p_increment: settings.increment,
    p_pool: pool,
    p_public: options.public ?? false,
    p_verse: options.verse ?? null,
    // Sent only when needed, so a duel room still works against a database
    // that predates formats.
    ...(options.format && options.format !== 'duel' ? { p_format: options.format } : {}),
  });
}

/** A public room waiting for players. */
export interface PublicRoom {
  code: string;
  host: string;
  verse: string;
  budget: number;
  teamSize: number;
  players: number;
  seats: number;
  format?: RoomFormat;
  /** This device created it. */
  mine: boolean;
}

export function getPublicRooms(): Promise<PublicRoom[]> {
  return rpc('public_rooms', { p_token: getPlayerToken() });
}

export function joinRoom(code: string, name: string): Promise<GameView> {
  return rpc('join_room', { p_code: code, p_token: getPlayerToken(), p_name: name });
}

export function getRoom(code: string): Promise<GameView> {
  return rpc('get_room', { p_code: code, p_token: getPlayerToken() });
}

/** Teams lobby: move to the other side. */
export function switchSide(code: string): Promise<GameView> {
  return rpc('switch_side', { p_code: code, p_token: getPlayerToken() });
}

/** Gives up a place in a lobby (the host's room stays open). */
export function leaveRoom(code: string): Promise<void> {
  return rpc('leave_room', { p_code: code, p_token: getPlayerToken() });
}

export function startGame(code: string): Promise<GameView> {
  return rpc('start_game', { p_code: code, p_token: getPlayerToken() });
}

/**
 * Looks for an opponent. Call again every few seconds with the code of the
 * room it returned until that room is `playing`.
 */
export function findMatch(
  name: string,
  settings: Settings,
  mode: string,
  waitingCode: string | null,
): Promise<GameView> {
  return rpc('find_match', {
    p_token: getPlayerToken(),
    p_name: name,
    p_budget: settings.budget,
    p_team_size: settings.teamSize,
    p_min_bid: settings.minBid,
    p_increment: settings.increment,
    // The server deals from its own list of the mode's cards.
    p_pool: null,
    p_code: waitingCode,
    p_mode: mode,
  });
}

/** Stops waiting. Resolves to the game if an opponent arrived just before. */
/** Quick match for three in a universe (or `mix`); polled with the waiting room's code. */
export function findTrio(name: string, verse: string, waitingCode: string | null): Promise<GameView> {
  return rpc('find_trio', { p_token: getPlayerToken(), p_name: name, p_verse: verse, p_code: waitingCode });
}

export function leaveQueue(code: string): Promise<GameView | null> {
  return rpc<GameView | null>('leave_queue', { p_code: code, p_token: getPlayerToken() });
}

/**
 * Tells the server this page is closing, so that a player who really left
 * loses within seconds instead of after the full absence limit. Sent as a
 * beacon, which survives the page going away; a form body keeps it a simple
 * request, with no CORS preflight that a closing page could not wait for.
 */
export function sendLeaving(code: string): void {
  if (!ONLINE_AVAILABLE) return;
  const url = `${SUPABASE_URL}/rest/v1/rpc/leaving?apikey=${encodeURIComponent(SUPABASE_PUBLISHABLE_KEY)}`;
  const body = new URLSearchParams({ p_code: code, p_token: getPlayerToken() });
  try {
    if (navigator.sendBeacon?.(url, body)) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => undefined);
}

/** Gives up a matched game. */
export function resign(code: string): Promise<GameView> {
  return rpc('resign', { p_code: code, p_token: getPlayerToken() });
}

/** Claims the win when the opponent has run out of time. */
export function claimForfeit(code: string): Promise<GameView> {
  return rpc('claim_forfeit', { p_code: code, p_token: getPlayerToken() });
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
