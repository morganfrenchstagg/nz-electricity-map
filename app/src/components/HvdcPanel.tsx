import { useMemo } from 'react'
import type { HvdcNode } from '../types'
import { isAggregateMode } from '../hooks/useDispatchData'
import { aggregatePeriodOf, useAggregates } from '../hooks/useAggregates'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { hvdcChartOptions, hvdcEnergyChartOptions } from '../utils/hvdcChart'
import Panel, { hasHeaderMenu, PanelToolbar } from './Panel'
import DateControls from './DateControls'
import { CompareLegend } from './CompareMenu'
import { NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

interface Props extends NodePanelProps {
  node: HvdcNode
}

// The HVDC's transfer between the islands over the view's period, flowing north
// above zero and south below it, or on the 90d, 1y, 5y and All views the energy
// it sent each way. The 3d view only has em6's last day of it (see HvdcData).
export default function HvdcPanel({
  node,
  onClear,
  dateMode,
  onDateModeChange,
  compare,
  onCompareChange,
  prior,
  recentData,
  loading,
  error,
  onNodeChange,
  ...panel
}: Props) {
  const [headerRef, compactHeader] = useCompactWhenOverflowing<HTMLDivElement>()
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()
  const headerMenu = hasHeaderMenu(panel)
  const lastUpdated = useLastUpdated(recentData, dateMode)
  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  // Every node's totals, as GridOverviewPanel fetches, so a view it's been on is
  // already cached. The HVDC's come with them.
  const aggregatePeriod = aggregatePeriodOf(dateMode)
  const aggregates = useAggregates('all', isAggregateMode(dateMode) ? dateMode : null)
  const hvdc = (aggregatePeriod ? aggregates.aggregateData : recentData)?.hvdc

  // The earlier period the view's compared with: App's dispatch data for it,
  // or every node's totals that far back
  const priorMode = prior?.period.mode ?? null
  const priorAggregateMode = priorMode && isAggregateMode(priorMode) ? priorMode : null
  const priorAggregates = useAggregates('all', priorAggregateMode, prior?.period.shift)
  const priorHvdc = !prior ? undefined : (priorAggregateMode ? priorAggregates.aggregateData : prior.recentData)?.hvdc
  const priorLoading = prior !== null && (priorAggregateMode ? priorAggregates.loading : prior.loading)
  const priorError = prior !== null && (priorAggregateMode ? priorAggregates.error : prior.error) !== null

  const chartOptions = useMemo(() => {
    if (!hvdc) return null
    const compared = prior && priorHvdc ? { hvdc: priorHvdc, period: prior.period } : undefined
    if (aggregatePeriod) return hvdcEnergyChartOptions(hvdc, aggregatePeriod, compared)
    // The 3d view's HVDC is only em6's last day, so it spans just that, rather
    // than leaving two of its days blank
    const times = dateMode.kind === 'recent' ? [] : (recentData?.data.map((row) => row[0] as string) ?? [])
    return hvdcChartOptions(hvdc, times.length > 0 ? times : undefined, compared)
  }, [hvdc, aggregatePeriod, recentData, dateMode, prior, priorHvdc])
  const dataLoading = aggregatePeriod ? aggregates.loading : loading
  const dataError = aggregatePeriod ? aggregates.error : error

  const header = (
    <NodeTitle
      node={node}
      title="HVDC Inter-Island Link"
      compact={compactHeader}
      onNodeChange={onNodeChange}
      onClear={headerMenu ? undefined : onClear}
      subtitle="Benmore to Haywards"
    />
  )

  return (
    <Panel
      {...panel}
      header={header}
      headerRef={headerRef}
      actions={headerMenu ? [{ label: 'Clear selection', onClick: onClear }] : undefined}
    >
      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <DateControls
          dateMode={dateMode}
          picker={datePicker}
          compare={compare}
          onCompareChange={onCompareChange}
          compact={compactToolbar}
          lastUpdated={lastUpdated}
          loading={dataLoading || priorLoading}
          error={dataError}
          priorError={priorError}
          empty={!chartOptions}
        />
      </PanelToolbar>

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        {prior && priorHvdc && chartOptions && <CompareLegend dateMode={dateMode} period={prior.period} />}
        <NodeChart
          chartKey={`hvdc-${String(panel.expanded)}-${aggregatePeriod ?? 'live'}`}
          options={chartOptions}
          loading={dataLoading}
          error={dataError}
          empty={!chartOptions}
        />
      </div>
    </Panel>
  )
}
