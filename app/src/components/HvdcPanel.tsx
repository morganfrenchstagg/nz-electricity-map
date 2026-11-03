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
import { NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

interface Props extends NodePanelProps {
  node: HvdcNode
}

// The HVDC's transfer between the islands over the view's period, flowing north
// above zero and south below it, or on the 90d, 1y, 5y and All views the energy
// it sent each way. The 3d view only has em6's last day of it (see HvdcData).
export default function HvdcPanel({ node, onClear, dateMode, onDateModeChange, recentData, loading, error, onNodeChange, ...panel }: Props) {
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
  const chartOptions = useMemo(() => {
    if (!hvdc) return null
    if (aggregatePeriod) return hvdcEnergyChartOptions(hvdc, aggregatePeriod)
    // The 3d view's HVDC is only em6's last day, so it spans just that, rather
    // than leaving two of its days blank
    const times = dateMode.kind === 'recent' ? [] : recentData?.data.map(row => row[0] as string) ?? []
    return hvdcChartOptions(hvdc, times.length > 0 ? times : undefined)
  }, [hvdc, aggregatePeriod, recentData, dateMode])
  const dataLoading = aggregatePeriod ? aggregates.loading : loading
  const dataError = aggregatePeriod ? aggregates.error : error

  const header = (
    <NodeTitle node={node} title="HVDC Inter-Island Link" compact={compactHeader} onNodeChange={onNodeChange} onClear={headerMenu ? undefined : onClear} subtitle="Benmore to Haywards" />
  )

  return (
    <Panel {...panel} header={header} headerRef={headerRef} actions={headerMenu ? [{ label: 'Clear selection', onClick: onClear }] : undefined}>
      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <DateControls
          dateMode={dateMode}
          picker={datePicker}
          compact={compactToolbar}
          lastUpdated={lastUpdated}
          loading={dataLoading}
          error={dataError}
          empty={!chartOptions}
        />
      </PanelToolbar>

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
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
