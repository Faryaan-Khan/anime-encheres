/**
 * Saving a profile with Google.
 *
 * Signing in is a one-time step, not a session: once Google has confirmed who
 * the player is, the server ties their profile to that Google account (or
 * attaches this device to the profile the account already has), and the
 * device token is the identity again. Nothing about the sign-in is kept in
 * the browser afterwards.
 *
 * Off unless VITE_GOOGLE_SIGN_IN is 'true'; see docs/DEPLOYMENT.md.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPlayerToken, toOnlineError } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import type { Profile } from './profile';

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
  return new URLSearchParams(window.location.search).has('code');
}

/** Leaves for Google's sign-in page. The browser comes back to this site. */
export async function startGoogleSignIn(): Promise<void> {
  const { error } = await authClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw toOnlineError(error);
}

/** Completes a sign-in after the redirect and returns the saved profile. */
export async function finishGoogleSignIn(): Promise<Profile> {
  const code = new URLSearchParams(window.location.search).get('code') ?? '';
  const supabase = authClient();
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw toOnlineError(error);
    const linked = await supabase.rpc('link_account', { p_token: getPlayerToken() });
    if (linked.error) throw toOnlineError(linked.error);
    return linked.data as Profile;
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    // Drop the one-time code from the address so that a reload does not retry it.
    window.history.replaceState(null, '', `${window.location.pathname}#/profile`);
  }
}
