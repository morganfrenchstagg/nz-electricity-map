import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      // Run the tests somewhere that is neither UTC (CI) nor NZ (where the app
      // is developed), so code that reads the machine's own timezone fails
      // here rather than only for visitors elsewhere. The helpers under test
      // must give the same answers whatever timezone the browser is in.
      TZ: 'America/New_York',
    },
  },
})
