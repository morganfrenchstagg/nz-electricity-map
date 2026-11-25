import { useEffect, useMemo, useState } from 'react'
import type { RecentData } from '../types'
import { fetchAggregates } from '../api'
import type { AggregateResponse } from '../api'
import { foldMovedNodes } from './useAggregates'
import { mergeData } from './useDispatchData'
import { firstDayGenerated, generationRecords, lastDayGenerated, lastMonthStart } from '../utils/generationRecords'
import type { GenerationRecords } from '../utils/generationRecords'
import { todayNZ } from '../utils/time'

function asData(response: AggregateResponse): RecentData {
  return { series: response.series, data: response.data, pricing: [] }
}

// Every month's totals from the first year the nodes generated in, by the
// yearly totals (as the All view's chart fetches them), to this year's so far
async function loadMonthly(nodes: string): Promise<RecentData> {
  const annual = await fetchAggregates('annual', nodes)
  const first = annual.data.find((row) => row.slice(1).some((v) => Number(v) > 0))
  if (!first) return { series: [], data: [], pricing: [] }
  const years: number[] = []
  for (let y = Number(String(first[0]).slice(0, 4)); y <= Number(todayNZ().slice(0, 4)); y++) years.push(y)
  const responses = await Promise.all(years.map((y) => fetchAggregates(`${y}/monthly`, nodes)))
  return mergeData(responses.map(asData))
}

// A month's daily totals, to find a record's day in. Null until they load, and
// if they can't be had, when the record keeps to its month.
function useDailyTotals(nodes: string | null, month: string | null): RecentData | null {
  const path = nodes !== null && month !== null ? `${month.slice(0, 4)}/${month.slice(5, 7)}` : null
  const [result, setResult] = useState<{ key: string; data: RecentData } | null>(null)
  const key = `${nodes}|${path}`

  useEffect(() => {
    if (nodes === null || path === null) return
    let cancelled = false
    fetchAggregates(path, nodes).then(
      (response) => { if (!cancelled) setResult({ key, data: asData(response) }) },
      () => {},
    )
    return () => { cancelled = true }
  }, [nodes, path, key])

  return path !== null && result?.key === key ? result.data : null
}

export interface DatedRecords extends GenerationRecords {
  // The first day it generated on, once that month's daily totals load
  firstDay: string | null
  // It hasn't generated since before last month began, so it's stopped, for now at least
  stopped: boolean
  // The last day it generated on, once it's stopped and that month's daily totals load
  lastDay: string | null
}

/**
 * A generator's records over all its history (see GenerationRecords), for the
 * `codes` shown: its moved units' old nodes folded into their current ones, as
 * the chart does. The records are null until the totals load, and when the codes
 * generated in none of them; `loaded` tells those apart.
 */
export function useGenerationRecords(queryNodes: string[], movedNodes: Record<string, string>, codes: string[]): {
  records: DatedRecords | null
  loaded: boolean
  error: string | null
} {
  const nodes = queryNodes.length > 0 ? queryNodes.join(',') : null
  const [monthly, setMonthly] = useState<{ nodes: string; data: RecentData } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (nodes === null) return
    let cancelled = false
    setError(null)
    loadMonthly(nodes).then(
      (data) => { if (!cancelled) setMonthly({ nodes, data }) },
      (err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error') },
    )
    return () => { cancelled = true }
  }, [nodes])

  const current = monthly !== null && monthly.nodes === nodes ? monthly.data : null
  const months = useMemo(
    () => current && generationRecords(foldMovedNodes(current, movedNodes), codes),
    [current, movedNodes, codes],
  )
  const stoppedIn = months && months.lastMonth < lastMonthStart(todayNZ()) ? months.lastMonth : null
  const firstDaily = useDailyTotals(nodes, months?.firstMonth ?? null)
  const lastDaily = useDailyTotals(nodes, stoppedIn)

  const records = useMemo((): DatedRecords | null => months && {
    ...months,
    firstDay: firstDaily && firstDayGenerated(foldMovedNodes(firstDaily, movedNodes), codes),
    stopped: stoppedIn !== null,
    lastDay: lastDaily && lastDayGenerated(foldMovedNodes(lastDaily, movedNodes), codes),
  }, [months, firstDaily, lastDaily, stoppedIn, movedNodes, codes])

  return { records, loaded: current !== null, error }
}
