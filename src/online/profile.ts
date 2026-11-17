/** Player profile, leaderboards and feedback: thin wrappers over the database functions. */
import { getClient, getPlayerToken, toOnlineError } from './api';

export interface RecentMatch {
  at: string;
  kind: 'ranked';
  opponent: string;
  outcome: 'win' | 'loss' | 'tie';
  delta: number;
  forfeit: boolean;
  power: number;
  opponentPower: number;
}

export interface Profile {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 code, chosen by the player. */
  country: string | null;
  avatar: number;
  trophies: number;
  best: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  forfeits: number;
  streak: number;
  bestStreak: number;
  weekGain: number;
  /** World rank; `null` until the first ranked game. */
  rank: number | null;
  players: number;
  /** Saved with a sign-in: it can be recovered on any device. */
  saved: boolean;
  /** A recovery code has been issued for this profile. */
  hasCode: boolean;
  recent: RecentMatch[];
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  country: string | null;
  avatar: number;
  value: number;
  you: boolean | null;
}

export interface Leaderboard {
  rows: LeaderboardRow[];
  total: number;
  me: { rank: number; value: number } | null;
}

export type LeaderboardScope = 'all' | 'week';
export type FeedbackCategory = 'idea' | 'bug' | 'ratings' | 'other';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await getClient().rpc(fn, args);
  } catch (error) {
    throw toOnlineError(error);
  }
  if (result.error) throw toOnlineError(result.error);
  return result.data as T;
}

export function getProfile(): Promise<Profile> {
  return call('get_profile', { p_token: getPlayerToken() });
}

export function updateProfile(name: string, country: string | null, avatar: number): Promise<Profile> {
  return call('update_profile', {
    p_token: getPlayerToken(),
    p_name: name,
    p_country: country,
    p_avatar: avatar,
  });
}

export function getLeaderboard(scope: LeaderboardScope, country: string | null): Promise<Leaderboard> {
  return call('leaderboard', { p_token: getPlayerToken(), p_scope: scope, p_country: country });
}

export function sendFeedback(
  category: FeedbackCategory,
  message: string,
  contact: string,
  lang: string,
): Promise<boolean> {
  return call('send_feedback', {
    p_token: getPlayerToken(),
    p_category: category,
    p_message: message,
    p_contact: contact || null,
    p_lang: lang,
  });
}

/** A new recovery code for this profile. The previous one stops working. */
export function newRecoveryCode(): Promise<string> {
  return call('recovery_code', { p_token: getPlayerToken() });
}

/** Opens the profile that owns this code on this device. Resolves to `null` if the code is wrong. */
export function redeemRecoveryCode(code: string): Promise<Profile | null> {
  return call('redeem_code', { p_token: getPlayerToken(), p_code: code });
}
