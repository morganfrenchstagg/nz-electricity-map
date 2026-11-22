import { useEffect, useState } from 'react'
import { fetchAggregates, fetchDefinitions } from '../api'
import type { AggregateResponse } from '../api'
import { annualFigures } from '../utils/annualStats'
import type { AnnualFigures } from '../utils/annualStats'
import { todayNZ } from '../utils/time'

// Worked out once for each response, which api.ts holds until its max-age runs out
const figuresOf = new WeakMap<AggregateResponse, AnnualFigures>()
// The last worked out, so a panel opened after it shows them straight away
let held: AnnualFigures | null = null

// Every node's yearly totals, for the panels' yearly summaries. Every node is
// fetched rather than the panel's, as a station's share needs the grid's
// total: one request shared by every panel. Null until they load, or if they
// can't be had. The definitions are the API's own, as the build's are, so the
// grid's total counts out every battery's charging.
export function useAnnualFigures(): AnnualFigures | null {
  const [figures, setFigures] = useState(held)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchDefinitions(), fetchAggregates('annual', '')])
      .then(([{ generators }, aggregates]) => {
        let worked = figuresOf.get(aggregates)
        if (!worked) {
          worked = annualFigures(aggregates, generators, Number(todayNZ().slice(0, 4)))
          figuresOf.set(aggregates, worked)
        }
        held = worked
        if (!cancelled) setFigures(worked)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return figures
}
