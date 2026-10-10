import type { Generator } from '../types'

// A generator is retired once all of its units are
export function isRetired(g: Generator): boolean {
  return !g.units.some((u) => u.active !== false)
}
