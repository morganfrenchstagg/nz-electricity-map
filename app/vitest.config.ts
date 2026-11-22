import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
    env: {
      // Neither UTC (CI) nor NZ (development), so code that depends on the
      // machine's timezone fails here, not just for visitors elsewhere. The
      // helpers must give the same answers in any timezone.
      TZ: 'America/New_York',
    },
  },
})
