/** Player profile, leaderboards and feedback: thin wrappers over the database functions. */
import { getClient, getPlayerToken, toOnlineError } from './api';

export interface RecentMatch {
  at: string;
  kind: 'ranked';
  /** A universe id, or `mix`. */
  mode: string | null;
  opponent: string;
  outcome: 'win' | 'loss' | 'tie';
  delta: number;
  forfeit: boolean;
  power: number;
  opponentPower: number;
}

/** A player's trophies in one mode. */
export interface ModeRating {
  mode: string;
  trophies: number;
  best: number;
  games: number;
  wins: number;
  seasonBest: number;
  seasonGames: number;
  /** Best final rank in this mode over past seasons. */
  bestRank: number | null;
}

/** A finished season: the overall result and each mode played. */
export interface SeasonResult {
  season: string;
  trophies: number;
  best: number;
  rank: number;
  players: number;
  modes: Array<{ mode: string; trophies: number; best: number; rank: number }>;
}

export interface Profile {
  id: string;
  /** Short public name other players type to add this one as a friend. */
  tag: string;
  name: string;
  /** ISO 3166-1 alpha-2 code, chosen by the player. */
  country: string | null;
  /** A character id, '' for none (old profiles may hold a retired symbol number). */
  avatar: string | number;
  /** The overall score: a weighted average over every mode (see ranking.ts). */
  trophies: number;
  best: number;
  /** Trophies in each mode played at least once. */
  modes: ModeRating[];
  /** Highest trophies ever reached in any single mode. */
  peak: number;
  /**
   * Name rules: 'free' (below 500 trophies), 'cooldown' (changed less than 30
   * days ago; free again at `nameFreeAt`) or 'locked' (reached the Legend
   * league, on `legendAt`).
   */
  nameRule?: 'free' | 'cooldown' | 'locked';
  nameFreeAt?: string | null;
  legendAt?: string | null;
  /** The current season, 'YYYY-MM' (UTC). Each month every mode drops to its bracket floor (see seasonFloor). */
  season: string | null;
  seasonBest: number;
  /** Best final rank in any past season, overall or in a mode. */
  bestRank: number | null;
  history: SeasonResult[];
  games: number;
  wins: number;
  losses: number;
  ties: number;
  forfeits: number;
  streak: number;
  bestStreak: number;
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
  /** A character id, '' for none (old profiles may hold a retired symbol number). */
  avatar: string | number;
  value: number;
  you: boolean | null;
}

export interface Leaderboard {
  rows: LeaderboardRow[];
  total: number;
  me: { rank: number; value: number } | null;
  /** When the player is below the top rows: them, and the players either side. */
  around?: LeaderboardRow[];
}

/** `overall`, or a mode: a universe id or `mix`. */
export type LeaderboardScope = string;
export type FeedbackCategory = 'idea' | 'bug' | 'ratings' | 'rights' | 'other';

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

export function updateProfile(name: string, country: string | null, avatar: string): Promise<Profile> {
  return call('update_profile', {
    p_token: getPlayerToken(),
    p_name: name,
    p_country: country,
    p_avatar: avatar,
  });
}

export function getLeaderboard(
  scope: LeaderboardScope,
  country: string | null,
  friendsOnly: boolean,
): Promise<Leaderboard> {
  return call('leaderboard', {
    p_token: getPlayerToken(),
    p_scope: scope,
    p_country: country,
    p_friends: friendsOnly,
  });
}

export interface Person {
  id: string;
  name: string;
  /** A character id, '' for none (old profiles may hold a retired symbol number). */
  avatar: string | number;
  country: string | null;
  trophies: number;
  tag: string;
}

export interface Friends {
  tag: string;
  friends: Person[];
  /** Requests received, waiting for an answer. */
  incoming: Person[];
  /** Requests sent, not answered yet. */
  outgoing: Person[];
  /** Private rooms a friend is waiting in for this player. */
  invites: Array<{ code: string; from: string; avatar: string | number }>;
}

export type AddFriendStatus = 'sent' | 'accepted' | 'already' | 'unknown' | 'self' | 'full';

export function getFriends(): Promise<Friends> {
  return call('get_friends', { p_token: getPlayerToken() });
}

export function addFriend(tag: string): Promise<Friends & { status: AddFriendStatus }> {
  return call('add_friend', { p_token: getPlayerToken(), p_tag: tag });
}

export function answerFriend(id: string, accept: boolean): Promise<Friends> {
  return call('answer_friend', { p_token: getPlayerToken(), p_friend: id, p_accept: accept });
}

export function removeFriend(id: string): Promise<Friends> {
  return call('remove_friend', { p_token: getPlayerToken(), p_friend: id });
}

export function inviteFriend(code: string, id: string): Promise<boolean> {
  return call('invite_friend', { p_token: getPlayerToken(), p_code: code, p_friend: id });
}

export function dismissInvite(code: string): Promise<Friends> {
  return call('dismiss_invite', { p_token: getPlayerToken(), p_code: code });
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
