/** Player profile, leaderboards and feedback: thin wrappers over the database functions. */
import type { GameView } from '../game/types';
import { getClient, getPlayerToken, toOnlineError } from './api';

export interface RecentMatch {
  at: string;
  kind: 'ranked' | 'practice';
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
  /** Below this many trophies a quick match may be played against a stand-in. */
  practiceBelow: number;
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

export interface PracticeReward {
  delta: number;
  trophies: number;
  counted: boolean;
}

/** Files the result of a quick match in which the computer took the other seat. */
export function reportPractice(outcome: 'win' | 'loss' | 'tie', view: GameView): Promise<PracticeReward> {
  return call('report_practice', {
    p_token: getPlayerToken(),
    p_outcome: outcome,
    p_names: view.players.map((p) => p.name),
    p_teams: view.players.map((p) => p.team),
  });
}
