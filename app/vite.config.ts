import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import optimizeLocales from '@react-aria/optimize-locales-plugin'

export default defineConfig({
  plugins: [
    react(),
    // Leave out the date pickers' strings in languages other than English
    { ...optimizeLocales.vite({ locales: ['en-US'] }), enforce: 'pre' },
  ],
  base: '/',
  build: {
    // frontend/ is the Cloudflare Pages publish root. The checked-in
    // _redirects and _headers live here too, so emptyOutDir must stay false or
    // the build would wipe them (including in CI).
    outDir: '../frontend',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // Split the large, rarely-changing vendor libraries into their own
        // chunks so an app change doesn't invalidate them in the browser cache.
        manualChunks(id) {
          if (id.includes('/node_modules/maplibre-gl/')) return 'maplibre'
          if (/\/node_modules\/highcharts(-react-official)?\//.test(id)) return 'highcharts'
          // The date pickers. Their calendars and date fields are a chunk of
          // their own, loaded with DatePickers (see LazyDatePickers), apart from
          // the menus and popovers the panels need from the start. By name, so
          // the date hooks' re-exports go with them, not with the menus.
          if (/\/node_modules\/(react-aria-components|react-aria|react-stately|@react-aria|@react-stately|@internationalized)\//.test(id)) {
            return /\/(use|Hidden)?(Range)?(Date|Time|Calendar|SpinButton)[^/]*(\/|$)/i.test(id) ? 'react-aria-dates' : 'react-aria'
          }
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
