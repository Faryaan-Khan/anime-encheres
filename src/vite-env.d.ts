/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project URL, e.g. https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (anon) key. Public by design; never the secret/service key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** 'true' once the Google provider is set up in Supabase (see docs/DEPLOYMENT.md). */
  readonly VITE_GOOGLE_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
