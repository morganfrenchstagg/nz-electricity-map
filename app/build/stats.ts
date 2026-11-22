import type { Generator, Unit } from '../src/types'
import { isCharging } from '../src/utils/generators'
import { sumNodes } from '../src/utils/annualStats'
import type { Stats } from '../src/utils/annualStats'
import { unitFuel } from './html'
import type { Definitions } from './html'

// Yearly figures for the built pages. What the app's panels show too is worked
// out in src/utils/annualStats.ts, so the two say the same; what only the
// topic pages need is here.

export * from '../src/utils/annualStats'

// Generation in each year grouped by `key`, from each node's first unit, e.g.
// by fuel. A unit `key` gives null for is left out.
export function generationBy(stats: Stats, defs: Definitions, key: (g: Generator, u: Unit) => string | null): Map<string, number[]> {
  const nodes = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const g of defs.generators) {
    for (const u of g.units) {
      if (isCharging(u) || seen.has(u.node)) continue
      seen.add(u.node)
      const k = key(g, u)
      if (k !== null) nodes.set(k, [...(nodes.get(k) ?? []), u.node])
    }
  }
  return new Map([...nodes].map(([k, n]) => [k, sumNodes(stats, n)]))
}

export function generationByFuel(stats: Stats, defs: Definitions): Map<string, number[]> {
  return generationBy(stats, defs, (_g, u) => unitFuel(u))
}
