import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HighchartsReact } from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { RecentData, SelectedNode } from '../types'
import type { DateMode } from '../hooks/useDispatchData'
import { useDefinitions } from '../hooks/useDefinitions'
import { CHART_CONTAINER_PROPS } from '../utils/chart'
import type { PanelProps } from './Panel'
import { ChevronDown } from './icons'

// Shared by GeneratorPanel and SubstationPanel

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
  // Left out where the panel's header menu has Clear instead (see hasHeaderMenu)
  onClear?: () => void
  subtitle?: string
  // After the subtitle, on its last line, only if they all fit there
  fuels?: { label: string; colour: string }[]
}

// The title opens the node picker. Full width until compact, so a narrow header hides what's
// beside it (GeneratorPanel's capacity readout) rather than squeezing it.
export function NodeTitle({ node, title, compact, onNodeChange, onClear, subtitle, fuels = [] }: NodeTitleProps) {
  const { generators, substations } = useDefinitions()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [lineRef, subtitleRef, fuelsRef, fuelsFit] = useFuelsFit()

  return (
    <div style={compact ? { flex: 1, minWidth: 0 } : { flex: '1 0 auto' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setPickerOpen(true)}
          className="title"
          style={{
            lineHeight: 1.3,
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {title}
          <span style={{ color: 'var(--color-text-faint)' }}>
            <ChevronDown size={12} />
          </span>
        </button>
        {onClear && (
          <button onClick={onClear} className="button-secondary" aria-label="Clear">
            Clear
          </button>
        )}
      </div>
      {/* Wraps to the title row's width instead of widening the block, so a long subtitle can't hide the readout */}
      <div
        ref={lineRef}
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0 6px',
          contain: 'inline-size',
        }}
      >
        {subtitle && (
          <span ref={subtitleRef} style={{ width: 'max-content', maxWidth: '100%' }}>
            {subtitle}
          </span>
        )}
        {fuels.length > 0 && (
          // Still laid out while hidden, so it's measured for when there's room again
          <span
            ref={fuelsRef}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0 6px',
              whiteSpace: 'nowrap',
              ...(!fuelsFit && { position: 'absolute', visibility: 'hidden' }),
            }}
          >
            {fuels.map((f) => (
              <span key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ marginRight: 3 }}>|</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.colour, flexShrink: 0 }} />
                <span>{f.label}</span>
              </span>
            ))}
          </span>
        )}
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

// Whether the fuels fit beside the subtitle without wrapping. Checked after every render,
// as the node can change, and on resize.
function useFuelsFit() {
  const lineRef = useRef<HTMLDivElement>(null)
  const subtitleRef = useRef<HTMLSpanElement>(null)
  const fuelsRef = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState(true)

  const check = useCallback(() => {
    const line = lineRef.current
    const fuels = fuelsRef.current
    if (!line || !fuels) return
    const subtitleWidth = subtitleRef.current
      ? subtitleRef.current.getBoundingClientRect().width + parseFloat(getComputedStyle(line).columnGap)
      : 0
    // Half a pixel's slack for subpixel rounding
    setFit(subtitleWidth + fuels.getBoundingClientRect().width <= line.clientWidth + 0.5)
  }, [])

  useLayoutEffect(check)

  useLayoutEffect(() => {
    const line = lineRef.current
    if (!line) return
    const observer = new ResizeObserver(check)
    observer.observe(line)
    return () => observer.disconnect()
  }, [check])

  return [lineRef, subtitleRef, fuelsRef, fit] as const
}

export function ChartMessage({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 240,
        color: error ? 'var(--color-danger)' : 'var(--color-text-muted)',
      }}
    >
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

export function NodeChart({ chartKey, options, loading, error, empty }: NodeChartProps) {
  return (
    <>
      {loading && empty && <ChartMessage>Loading…</ChartMessage>}
      {error && empty && <ChartMessage error>Failed to load data</ChartMessage>}
      {!loading && !error && empty && <ChartMessage>No data available</ChartMessage>}
      {options && (
        <HighchartsReact
          key={chartKey}
          highcharts={Highcharts}
          options={options}
          containerProps={CHART_CONTAINER_PROPS}
        />
      )}
    </>
  )
}
