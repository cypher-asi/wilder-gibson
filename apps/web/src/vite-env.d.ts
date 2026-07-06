/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Mixpanel project token for Wilder Gibson. Public; unset = analytics no-op. */
  readonly VITE_MIXPANEL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
