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
  // In chart order. Aggregate views pass includeRetired, as their totals cover units since retired.
  getCodes: (data: RecentData, includeRetired: boolean) => string[]
}

// For GeneratorPanel and SubstationPanel: App's 5-minute dispatch data, or on aggregate views
// the node's own MWh totals, narrowed to the node's codes
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

// All codes until the user picks, and again when the node changes. With under two codes there
// are no buttons, so an earlier pick (on another day, say) is set aside.
export function useCodeSelection(allCodes: string[], node: object) {
  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const effectiveCodes = useMemo(
    () => (activeCodes && allCodes.length > 1 ? activeCodes : new Set(allCodes)),
    [activeCodes, allCodes],
  )

  useEffect(() => { setActiveCodes(null) }, [node])

  // Hiding the last shown code shows them all again, unless `othersShown` (a substation's Total, say)
  function toggleCode(code: string, othersShown = false) {
    const next = new Set(effectiveCodes)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setActiveCodes(next.size === 0 && !othersShown ? null : next)
  }

  function isolateCode(code: string) {
    setActiveCodes(new Set([code]))
  }

  return { effectiveCodes, setActiveCodes, toggleCode, isolateCode }
}
