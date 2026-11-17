/**
 * Google accounts.
 *
 * Everyone plays as a guest first: a profile tied to this device. Signing in
 * with Google is a one-time step, not a session. Once Google has confirmed
 * who the player is, the server either turns the guest profile into the
 * Google account's profile ("link"), starts a new one ("fresh"), or opens the
 * profile the account already has. From then on the device token is the
 * identity again; nothing about the sign-in is kept in the browser.
 *
 * Off unless VITE_GOOGLE_SIGN_IN is 'true'; see docs/DEPLOYMENT.md.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readStored, removeStored, writeStored } from '../storage';
import { getPlayerToken, resetPlayerToken, toOnlineError } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import type { Profile } from './profile';

/** What to do with the guest profile when signing in. */
export type SignInIntent = 'link' | 'fresh';
/** What the server did: kept the guest, made a new profile, or opened an existing one. */
export type SignInOutcome = 'linked' | 'created' | 'switched' | 'already';

const INTENT_KEY = 'ae.signin.intent';

/** A client with sign-in enabled, separate from the one used to play. */
function authClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: 'pkce',
      // Needed between leaving for Google and coming back; cleared afterwards.
      persistSession: true,
      storageKey: 'ae.signin',
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** True when this page load is Google sending the player back. */
export function returningFromSignIn(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

/** Leaves for Google's sign-in page. The browser comes back to this site. */
export async function startGoogleSignIn(intent: SignInIntent): Promise<void> {
  writeStored(INTENT_KEY, intent);
  const { error } = await authClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw toOnlineError(error);
}

/** Completes a sign-in after the redirect. */
export async function finishGoogleSignIn(): Promise<{ profile: Profile; outcome: SignInOutcome }> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') ?? '';
  const intent = (readStored(INTENT_KEY) as SignInIntent | null) ?? 'link';
  const supabase = authClient();
  try {
    // Cancelled on Google's page, or refused.
    if (!code) throw toOnlineError({ message: 'SIGN_IN_CANCELLED' });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw toOnlineError(error);
    const linked = await supabase.rpc('link_account', { p_token: getPlayerToken(), p_intent: intent });
    if (linked.error) throw toOnlineError(linked.error);
    const { outcome, ...profile } = linked.data as Profile & { outcome: SignInOutcome };
    return { profile: profile as Profile, outcome };
  } finally {
    removeStored(INTENT_KEY);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    // Drop the one-time code from the address so that a reload does not retry it.
    window.history.replaceState(null, '', `${window.location.pathname}#/profile`);
  }
}

/**
 * Leaves the account on this device and starts a new guest. The account
 * itself is untouched: signing in again on any device opens it.
 */
export function signOutHere(): void {
  resetPlayerToken();
  removeStored('ae.match');
}
