/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable key (sb_publishable_…). Never the service role / secret key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "local" = bundled flows without login (dev only; ignored in production builds). */
  readonly VITE_FLOW_SOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
