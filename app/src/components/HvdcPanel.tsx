import { useMemo } from 'react'
import type { HvdcNode } from '../types'
import { useDispatchData } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { hvdcChartOptions } from '../utils/hvdcChart'
import Panel from './Panel'
import { NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

// em6's flows only come with dispatch/recent (see HvdcData), so the panel charts
// its last day whatever view the rest of the app is on. It shares the cached
// dispatch/recent with them when they're on it too.
const RECENT: DateMode = { kind: 'recent' }

interface Props extends NodePanelProps {
  node: HvdcNode
}

// The HVDC's transfer between the islands over em6's last day, flowing north
// above zero and south below it
export default function HvdcPanel({ node, onClear, onNodeChange, onClose, panelWidth, onResizeHandleMouseDown, expanded, onExpandedChange, isMobile }: Props) {
  const [headerRef, compactHeader] = useCompactWhenOverflowing<HTMLDivElement>()
  const { recentData, loading, error } = useDispatchData(RECENT)
  const hvdc = recentData?.hvdc
  const chartOptions = useMemo(() => (hvdc ? hvdcChartOptions(hvdc) : null), [hvdc])

  const header = (
    <NodeTitle node={node} title="HVDC Inter-Island Link" compact={compactHeader} onNodeChange={onNodeChange} onClear={onClear}>
      <span>Benmore to Haywards</span>
    </NodeTitle>
  )

  return (
    <Panel header={header} headerRef={headerRef} onClose={onClose} panelWidth={panelWidth} onResizeHandleMouseDown={onResizeHandleMouseDown} expanded={expanded} onExpandedChange={onExpandedChange} isMobile={isMobile}>
      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        <NodeChart
          chartKey={`hvdc-${String(expanded)}`}
          options={chartOptions}
          loading={loading}
          error={error}
          empty={!chartOptions}
        />
      </div>
    </Panel>
  )
}
