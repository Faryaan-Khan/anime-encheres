/**
 * Edge Function "opponent": the stronger brain of the computer opponent.
 *
 * The database decides when the computer should move (bot_step in
 * 0008_opponent_brain.sql). For strong opponents it does not move itself:
 * it sends this function the room code and a one-time secret. The function
 * exchanges the secret for the computer's view of the room (opponent_claim),
 * thinks with the look-ahead player from src/bot/bot.ts, and plays the move
 * through the same `play` function a person uses. If this function is slow
 * or down, the database plays a rule-based move after a few seconds, so a
 * game is never stuck.
 *
 * The function holds no secret of its own: the one-time secret comes from
 * the database and is never seen by players. Deploy with JWT verification
 * off (the database calls it without a user token). See docs/DEPLOYMENT.md.
 */
import { decide, emptyMemory, styleForSkill } from '../../../src/bot/bot';
import type { GameView } from '../../../src/game/types';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// Public by design, like the key in the app's .env.
const PUBLISHABLE_KEY = 'sb_publishable_BylJajwYJJQMSKk7g819fQ_myemcBnq';
const URL_BASE = Deno.env.get('SUPABASE_URL') ?? 'https://iwlmrwwuslebvaqjahnt.supabase.co';

interface Claim {
  view: GameView;
  pool: string[];
  token: string;
  skill: number;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** More imagined games for stronger opponents: 12 at the threshold, 40 at the top. */
export function rolloutsFor(skill: number): number {
  return Math.round(12 + 28 * Math.min(1, Math.max(0, (skill - 0.6) / 0.4)));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  let code = '';
  let nonce = '';
  try {
    ({ code, nonce } = (await req.json()) as { code: string; nonce: string });
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (typeof code !== 'string' || typeof nonce !== 'string' || nonce.length < 32) {
    return new Response('bad request', { status: 400 });
  }

  try {
    const claim = await rpc<Claim | null>('opponent_claim', { p_code: code, p_nonce: nonce });
    if (!claim) return new Response('nothing to do', { status: 200 });
    const expert = styleForSkill(1);
    const { action } = decide(claim.view, {
      pool: claim.pool,
      level: 'hard',
      memory: emptyMemory(),
      rollouts: rolloutsFor(claim.skill),
      playoutStyle: expert,
      instinctStyle: expert,
    });
    await rpc('play', {
      p_code: code,
      p_token: claim.token,
      p_action: action.type,
      p_amount: action.type === 'bid' ? action.amount : null,
    });
    return new Response('ok', { status: 200 });
  } catch (error) {
    // The database falls back to a rule-based move on its own.
    console.error(String(error));
    return new Response('failed', { status: 500 });
  }
});
