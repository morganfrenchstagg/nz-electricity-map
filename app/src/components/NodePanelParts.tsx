import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { RecentData, SelectedNode } from '../types'
import type { DateMode } from '../hooks/useDispatchData'
import { useDefinitions } from '../hooks/useDefinitions'
import { CHART_CONTAINER_PROPS } from '../utils/chart'
import type { PanelProps } from './Panel'

// The pieces GeneratorPanel and SubstationPanel share

const NodePickerModal = lazy(() => import('./NodePickerModal'))

// What App passes either panel
export interface NodePanelProps extends PanelProps {
  onClear: () => void
  dateMode: DateMode
  onDateModeChange: (m: DateMode) => void
  recentData: RecentData | null
  loading: boolean
  error: string | null
  onNodeChange: (node: NonNullable<SelectedNode>) => void
}

interface NodeTitleProps {
  node: NonNullable<SelectedNode>
  title: string
  // The header is too narrow for everything in it (see useCompactWhenOverflowing)
  compact: boolean
  onNodeChange: (node: NonNullable<SelectedNode>) => void
  onClear: () => void
  // The line under the title
  children?: ReactNode
}

// The node's name, which opens the node picker, and the line under it. Kept at
// its full width until the header is compact, so a header too narrow for the
// title and what's beside it (GeneratorPanel's capacity readout) hides that
// rather than squeezing the title.
export function NodeTitle({ node, title, compact, onNodeChange, onClear, children }: NodeTitleProps) {
  const { generators, substations } = useDefinitions()
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div style={compact ? { flex: 1, minWidth: 0 } : { flex: '1 0 auto' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setPickerOpen(true)}
          className="title"
          style={{ lineHeight: 1.3, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {title}
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', fontWeight: 400 }}>▾</span>
        </button>
        <button onClick={onClear} className="button-secondary" aria-label='Clear'>
          Clear
        </button>
      </div>
      {/* Wraps to the title row's width rather than widening the title block, so a long subtitle doesn't hide the readout */}
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 6px', contain: 'inline-size' }}>
        {children}
      </div>
      {/* Inside the title block rather than beside it, where the header would measure it */}
      <Suspense fallback={null}>
        {pickerOpen && (
          <NodePickerModal
            generators={generators}
            substations={substations}
            currentNode={node}
            onSelect={onNodeChange}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </Suspense>
    </div>
  )
}

// What the chart area says in place of a chart
export function ChartMessage({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: error ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
      {children}
    </div>
  )
}

interface NodeChartProps {
  // Remounts the chart when it changes
  chartKey: string
  options: Highcharts.Options | null
  loading: boolean
  error: string | null
  // The node has no codes to chart
  empty: boolean
}

// The node's chart, or why there isn't one
export function NodeChart({ chartKey, options, loading, error, empty }: NodeChartProps) {
  return (
    <>
      {loading && empty && <ChartMessage>Loading…</ChartMessage>}
      {error && empty && <ChartMessage error>Failed to load data</ChartMessage>}
      {!loading && !error && empty && <ChartMessage>No data available</ChartMessage>}
      {options && (
        <HighchartsReact key={chartKey} highcharts={Highcharts} options={options} containerProps={CHART_CONTAINER_PROPS} />
      )}
    </>
  )
}
