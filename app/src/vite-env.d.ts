/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The API to use in place of production, e.g. a local `wrangler dev` (see README)
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
