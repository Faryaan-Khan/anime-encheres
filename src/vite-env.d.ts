/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project URL, e.g. https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (anon) key. Public by design; never the secret/service key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
