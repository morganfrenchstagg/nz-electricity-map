import { useEffect, useMemo, useState } from 'react'
import type { RecentData } from '../types'
import { isAggregateMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { aggregatePeriodOf, foldMovedNodes, useAggregates } from './useAggregates'
import type { Shift } from './useAggregates'
import { extractChartData } from '../utils/chart'
import type { PriorData } from '../utils/compare'

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
  // For an earlier period the view's compared with: how far back its totals
  // are (see useAggregates), and false while there's none, to fetch nothing
  shift?: Shift
  enabled?: boolean
}

// For GeneratorPanel and SubstationPanel: App's 5-minute dispatch data, or on aggregate views
// the node's own MWh totals, narrowed to the node's codes. Also called for a compared period.
export function useNodeData({
  dateMode,
  recentData,
  loading,
  error,
  queryNodes,
  movedNodes = NO_MOVED_NODES,
  getCodes,
  shift,
  enabled = true,
}: Options) {
  const aggregatePeriod = aggregatePeriodOf(dateMode)
  const isAggregate = aggregatePeriod !== null
  const aggregates = useAggregates(enabled ? queryNodes : null, isAggregateMode(dateMode) ? dateMode : null, shift)
  const aggregateData = useMemo(
    () => aggregates.aggregateData && foldMovedNodes(aggregates.aggregateData, movedNodes),
    [aggregates.aggregateData, movedNodes],
  )
  const data = !enabled ? null : isAggregate ? aggregateData : recentData

  const allCodes = useMemo(() => (data ? getCodes(data, isAggregate) : []), [data, getCodes, isAggregate])

  const chartData = useMemo(() => {
    if (!data || allCodes.length === 0) return null
    return extractChartData(data, allCodes)
  }, [data, allCodes])

  return {
    aggregatePeriod,
    isAggregate,
    allCodes,
    chartData,
    loading: enabled && (isAggregate ? aggregates.loading : loading),
    error: !enabled ? null : isAggregate ? aggregates.error : error,
  }
}

// The node's data for the earlier period compared with (see utils/compare): App's
// dispatch data for it, or the node's totals that far back. Nothing when not comparing.
export function usePriorNodeData(
  prior: PriorData | null,
  dateMode: DateMode,
  nodes: Pick<Options, 'queryNodes' | 'movedNodes' | 'getCodes'>,
) {
  const mode = prior?.period.mode ?? dateMode
  return useNodeData({
    ...nodes,
    dateMode: mode,
    recentData: prior?.recentData ?? null,
    loading: prior?.loading ?? false,
    error: prior?.error ?? null,
    shift: prior && isAggregateMode(mode) ? prior.period.shift : undefined,
    enabled: prior !== null,
  })
}

// All codes until the user picks, and again when the node changes. With under two codes there
// are no buttons, so an earlier pick (on another day, say) is set aside.
export function useCodeSelection(allCodes: string[], node: object) {
  const [activeCodes, setActiveCodes] = useState<Set<string> | null>(null)
  const effectiveCodes = useMemo(
    () => (activeCodes && allCodes.length > 1 ? activeCodes : new Set(allCodes)),
    [activeCodes, allCodes],
  )

  useEffect(() => {
    setActiveCodes(null)
  }, [node])

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
