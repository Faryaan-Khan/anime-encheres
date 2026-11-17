const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

export const SUPABASE_URL = url;
export const SUPABASE_PUBLISHABLE_KEY = key;

/** Online play is switched off cleanly when the build has no backend configured. */
export const ONLINE_AVAILABLE = url.length > 0 && key.length > 0;

/** Shows "Continue with Google" on the profile. Off until the provider is configured. */
export const GOOGLE_SIGN_IN = ONLINE_AVAILABLE && import.meta.env.VITE_GOOGLE_SIGN_IN === 'true';
