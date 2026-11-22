/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Overrides the production API, e.g. a local `wrangler dev` (see README)
  readonly VITE_API_BASE?: string
  // Overrides the production distributed solar API, e.g. a local `wrangler dev` (see README)
  readonly VITE_SOLAR_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
