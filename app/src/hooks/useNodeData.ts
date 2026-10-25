import { useEffect, useMemo, useState } from 'react'
import type { RecentData } from '../types'
import { isAggregateMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { aggregatePeriodOf, foldMovedNodes, useAggregates } from './useAggregates'
import { extractChartData } from '../utils/chart'

const NO_MOVED_NODES: Record<string, string> = {}

interface Options {
  dateMode: DateMode
  // App's dispatch data, shared by every panel
  recentData: RecentData | null
  loading: boolean
  error: string | null
  // Node codes (or prefixes) to request from the aggregates API, retired units' included
  queryNodes: string[]
  // Old nodes of units that moved, mapped to their current node (see foldMovedNodes)
  movedNodes?: Record<string, string>
  // The node's codes in the data, in chart order. The aggregate views pass
  // includeRetired, as their totals cover units since retired.
  getCodes: (data: RecentData, includeRetired: boolean) => string[]
}

// What GeneratorPanel and SubstationPanel chart: App's 5-minute dispatch data,
// or for the 90d, 1y, 5y and All views the node's own MWh totals, narrowed to the
// node's codes.
export function useNodeData({ dateMode, recentData, loading, error, queryNodes, movedNodes = NO_MOVED_NODES, getCodes }: Options) {
  const aggregatePeriod = aggregatePeriodOf(dateMode)
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates(queryNodes, isAggregateMode(dateMode) ? dateMode : null)
  const aggregateData = useMemo(
    () => aggregates.aggregateData && foldMovedNodes(aggregates.aggregateData, movedNodes),
    [aggregates.aggregateData, movedNodes],
  )
  const data = isAggregate ? aggregateData : recentData

  const allCodes = useMemo(
    () => (data ? getCodes(data, isAggregate) : []),
    [data, getCodes, isAggregate],
  )

  const chartData = useMemo(() => {
    if (!data || allCodes.length === 0) return null
    return extractChartData(data, allCodes)
  }, [data, allCodes])

  return {
    aggregatePeriod,
    isAggregate,
    allCodes,
    chartData,
    loading: isAggregate ? aggregates.loading : loading,
    error: isAggregate ? aggregates.error : error,
  }
}

// Which of a node's codes are charted: all of them until the user picks, and
// again whenever the node changes. With fewer than two codes there are no
// buttons to pick with, so a pick made before, e.g. on another day, is set aside.
export function useCodeSelection(allCodes: string[], node: object) {
  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const effectiveCodes = useMemo(
    () => (activeCodes && allCodes.length > 1 ? activeCodes : new Set(allCodes)),
    [activeCodes, allCodes],
  )

  useEffect(() => { setActiveCodes(null) }, [node])

  // Shows or hides a code. Hiding the only series showing shows every code
  // again; `othersShown` says another series still is, e.g. a substation's Total.
  function toggleCode(code: string, othersShown = false) {
    const next = new Set(effectiveCodes)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setActiveCodes(next.size === 0 && !othersShown ? null : next)
  }

  // Shows a code alone, hiding every other
  function isolateCode(code: string) {
    setActiveCodes(new Set([code]))
  }

  return { effectiveCodes, setActiveCodes, toggleCode, isolateCode }
}
