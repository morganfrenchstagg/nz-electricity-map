import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // frontend/ is the Cloudflare Pages publish root. The vanilla /old app and
    // _redirects live here too, so emptyOutDir must stay false or the build
    // would wipe them (including in CI).
    outDir: '../frontend',
    emptyOutDir: false,
  },
})
