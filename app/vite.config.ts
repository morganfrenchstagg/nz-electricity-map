import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import optimizeLocales from '@react-aria/optimize-locales-plugin'
import { stationPages } from './build/pages'

// An entry's absolute path, from this file's folder, whatever folder the build runs in
const entry = (path: string) => decodeURIComponent(new URL(path, import.meta.url).pathname)

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Drop the date pickers' non-English strings
    { ...optimizeLocales.vite({ locales: ['en-US'] }), enforce: 'pre' },
    // A page for each station, and the sitemap, from the API's definitions
    stationPages(loadEnv(mode, '.', 'VITE_').VITE_API_BASE),
  ],
  base: '/',
  build: {
    // frontend/ is the Cloudflare Pages publish root and holds the checked-in
    // _redirects and _headers, so emptyOutDir must stay false or builds (CI
    // included) wipe them.
    outDir: '../frontend',
    emptyOutDir: false,
    rolldownOptions: {
      input: {
        index: entry('./index.html'),
        // The tooltips of the charts on the pages that don't load the app,
        // which the station-pages plugin adds to them (see build/pages.ts)
        chartTooltip: entry('./src/chartTooltip.ts'),
      },
      output: {
        // Large, rarely-changing vendor libraries get their own chunks, so app
        // changes don't invalidate them in the browser cache
        codeSplitting: {
          groups: [{
            name(id) {
              if (id.includes('/node_modules/maplibre-gl/')) return 'maplibre'
              if (/\/node_modules\/highcharts(-react-official)?\//.test(id)) return 'highcharts'
              // Calendars and date fields load later with DatePickers (see
              // LazyDatePickers), apart from the menus and popovers needed at once.
              // Matched by name so the date hooks' re-exports go with them.
              if (/\/node_modules\/(react-aria-components|react-aria|react-stately|@react-aria|@react-stately|@internationalized)\//.test(id)) {
                return /\/(use|Hidden)?(Range)?(Date|Time|Calendar|SpinButton)[^/]*(\/|$)/i.test(id) ? 'react-aria-dates' : 'react-aria'
              }
              if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
              return null
            },
          }],
        },
      },
    },
  },
}))
