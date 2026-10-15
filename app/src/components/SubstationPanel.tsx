import { useState, useMemo, useEffect, useCallback } from 'react'
import type Highcharts from 'highcharts'
import type { RecentData, SubstationNode, Unit } from '../types'
import { useDefinitions } from '../hooks/useDefinitions'
import { useCodeSelection, useNodeData } from '../hooks/useNodeData'
import { busLabel, chartReach, isGeneratorCode, substationCodes, timeChartAccessibility, tooltipTime, unitOfCode } from '../utils/chart'
import type { ChartData } from '../utils/chart'
import { nodeChartOptions, pricesByTime, tooltipRow, tooltipTotalRow } from '../utils/nodeChart'
import { fuelColour, voltageColour } from '../utils/colours'
import { energyUnit, MW_UNIT } from '../utils/format'
import { nzLocalMs } from '../utils/time'
import { unitLabel } from '../utils/generators'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import Panel, { PanelToolbar } from './Panel'
import DateControls from './DateControls'
import { NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

const TOTAL = 'Total'
const TOTAL_COLOUR = '#222222'

// The data has a substation's load as negative generation
const toLoad = (value: number) => -value

// A bus code's voltage colour (see busLabel for the code's parts)
function busColour(code: string): string {
  return voltageColour(code.length >= 4 ? parseInt(code.slice(-4, -1), 10) : NaN)
}

// The substation's load at each time, over every code charted, shown or not
function totalLoads({ rows, codes }: ChartData): number[] {
  return rows.map((row) => codes.reduce((sum, code) => sum + toLoad(row[code] as number), 0))
}

// The Total line, its loads divided by unitSize to chart them in the panel's unit
function totalSeries({ rows }: ChartData, loads: number[], visible: boolean, unitSize: number): Highcharts.SeriesLineOptions {
  return {
    type: 'line',
    name: TOTAL,
    visible,
    color: TOTAL_COLOUR,
    lineWidth: 2,
    zIndex: 5,
    data: rows.map((row, i) => [nzLocalMs(row.time), loads[i] / unitSize]),
    marker: { enabled: false },
    animation: false,
  }
}

interface Props extends NodePanelProps {
  node: SubstationNode
}

// A substation's load by bus, and the generators connected there
export default function SubstationPanel({ node, onClear, dateMode, onDateModeChange, recentData, loading, error, onNodeChange, ...panel }: Props) {
  const { substation } = node
  const { generators } = useDefinitions()
  const lastUpdated = useLastUpdated(recentData, dateMode)
  // The title shrinks, and the toolbar collapses to dropdowns, when too narrow
  const [headerRef, compactHeader] = useCompactWhenOverflowing<HTMLDivElement>()
  const [toolbarRef, compactToolbar] = useCompactWhenOverflowing<HTMLDivElement>()

  const unitFor = useCallback((code: string): Unit | null => {
    if (!isGeneratorCode(code)) return null
    for (const gen of generators) {
      const unit = gen.units.find((u) => u.node === code)
      if (unit) return unit
    }
    return null
  }, [generators])

  // Buses first, then generators alphabetically by name
  const getCodes = useCallback((recent: RecentData) => {
    const codes = substationCodes(recent, substation.siteId)
    const genName = (code: string) => { const unit = unitFor(code); return unit ? unitLabel(unit) : code }
    return [
      ...codes.filter((c) => !isGeneratorCode(c)),
      ...codes.filter(isGeneratorCode).sort((a, b) => genName(a).localeCompare(genName(b))),
    ]
  }, [substation, unitFor])

  const { aggregatePeriod, isAggregate, allCodes, chartData, loading: dataLoading, error: dataError } = useNodeData({
    dateMode, recentData, loading, error, queryNodes: [substation.siteId], getCodes,
  })
  const { effectiveCodes, setActiveCodes, toggleCode } = useCodeSelection(allCodes, node)

  const labelFor = useCallback((code: string) => {
    const unit = unitFor(code)
    if (unit) return unitLabel(unit)
    return isGeneratorCode(code) ? unitOfCode(code) : busLabel(code, allCodes)
  }, [unitFor, allCodes])

  const colourFor = useCallback((code: string) => {
    const unit = unitFor(code)
    return unit ? fuelColour(unit.fuel) : busColour(code)
  }, [unitFor])

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar)

  const hasGenerators = allCodes.some(isGeneratorCode)
  const generatorsShown = hasGenerators && [...effectiveCodes].some(isGeneratorCode)

  // A lone code's Total would just repeat it
  const hasTotal = allCodes.length > 1
  // Until the user toggles it, Total shows only when the substation has generators
  const [totalToggled, setTotalToggled] = useState<boolean | null>(null)
  const totalShown = hasTotal && (totalToggled ?? hasGenerators)
  useEffect(() => { setTotalToggled(null) }, [node])

  // Deselects every generator, or selects them all again. If no buses are
  // selected either, hiding falls back to all buses so the chart isn't empty.
  // The Total line includes the generators, so it's switched with them.
  function toggleGenerators() {
    const buses = [...effectiveCodes].filter(c => !isGeneratorCode(c))
    if (!generatorsShown) {
      setActiveCodes(new Set([...buses, ...allCodes.filter(isGeneratorCode)]))
    } else {
      const remaining = buses.length > 0 ? buses : allCodes.filter(c => !isGeneratorCode(c))
      if (remaining.length === 0) return
      setActiveCodes(new Set(remaining))
    }
    setTotalToggled(!generatorsShown)
  }

  // As on the grid overview: Clear deselects every series, Total included, and
  // once nothing is selected it becomes Select all, which turns them all on.
  const nothingSelected = effectiveCodes.size === 0 && !totalShown
  function clearOrSelectAll() {
    setActiveCodes(nothingSelected ? null : new Set())
    setTotalToggled(nothingSelected)
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    const prices = pricesByTime(isAggregate ? null : recentData, chartData.codes)

    // Aggregate totals are MWh, charted in GWh unless the lines stay low
    const totals = hasTotal ? totalLoads(chartData) : []
    const shownCodes = chartData.codes.filter((code) => effectiveCodes.has(code))
    const unit = isAggregate
      ? energyUnit(chartReach(chartData.rows.map((row, i) => [
          ...shownCodes.map((code) => row[code] as number),
          ...(totalShown ? [totals[i]] : []),
        ]), false))
      : MW_UNIT

    return nodeChartOptions({
      chartData,
      aggregatePeriod,
      effectiveCodes,
      type: 'line',
      labelFor,
      colourFor,
      transformValue: (value) => toLoad(value) / unit.size,
      extraSeries: hasTotal ? [totalSeries(chartData, totals, totalShown, unit.size)] : [],
      yAxis: {
        title: { text: `Load (${unit.label})` },
        softMin: 0,
        gridLineDashStyle: 'Dash',
      },
      tooltipFormatter: function () {
        const points = (this.points ?? []).filter((p) => p.series.name !== TOTAL)
        const formatValue = unit.format
        const context = { codes: chartData.codes, prices: prices.get(this.x as number), formatValue, showName: points.length > 1 }
        const row = (p: Highcharts.Point) => tooltipRow(p, context)

        // Buses on top, then generators below a heading
        const isGenerator = (p: Highcharts.Point) => isGeneratorCode(chartData.codes[p.series.index] ?? '')
        const genPoints = points.filter(isGenerator)
        let rows = points.filter((p) => !isGenerator(p)).map(row).join('')
        if (genPoints.length > 0) {
          rows += `<tr><td colspan="3" class="eyebrow" style="padding-top:var(--space-sm)">Generation</td></tr>` + genPoints.map(row).join('')
        }
        if (points.length > 1) {
          rows += tooltipTotalRow(points.reduce((sum, p) => sum + (p.y ?? 0), 0), formatValue)
        }
        return `<b>${tooltipTime(this.x as number, aggregatePeriod)}</b><br/><table>${rows}</table>`
      },
      accessibility: timeChartAccessibility(
        `${substation.description} Substation load`,
        hasGenerators ? 'Load on each bus, with generation as negative load' : 'Load on each bus',
        aggregatePeriod,
        unit,
      ),
    })
  }, [chartData, effectiveCodes, labelFor, colourFor, recentData, hasTotal, totalShown, isAggregate, aggregatePeriod, substation, hasGenerators])

  // Series buttons: the generators toggle and Total lead, then a button per bus and generator
  const showUnitSelector = allCodes.length > 1
  const leadButtons = [
    ...(hasGenerators ? [
      <button
        key="generators"
        onClick={toggleGenerators}
        className={`series-button series-button--neutral${generatorsShown ? ' is-active' : ''}`}
      >
        {generatorsShown ? 'Hide generators' : 'Show generators'}
      </button>,
    ] : []),
    ...(hasTotal ? [
      <SeriesButton key="total" colour={TOTAL_COLOUR} active={totalShown} onClick={() => setTotalToggled(!totalShown)}>
        {TOTAL}
      </SeriesButton>,
    ] : []),
  ]
  if (leadButtons.length > 0 && showUnitSelector) leadButtons.push(<div key="divider" className="divider" />)

  const unitButtons = !showUnitSelector ? [] : allCodes.map((code, i) => {
    const button = (
      <SeriesButton key={code} colour={colourFor(code)} active={effectiveCodes.has(code)} onClick={() => toggleCode(code)}>
        {labelFor(code)}
      </SeriesButton>
    )
    // The buses come first; a divider leads the first generator
    if (!(i > 0 && isGeneratorCode(code) && !isGeneratorCode(allCodes[i - 1]))) return button
    return (
      <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="divider" />
        {button}
      </div>
    )
  })

  const header = (
    <NodeTitle node={node} title={`${substation.description} Substation`} compact={compactHeader} onNodeChange={onNodeChange} onClear={onClear} />
  )

  return (
    <Panel {...panel} header={header} headerRef={headerRef}>
      <PanelToolbar toolbarRef={toolbarRef} compact={compactToolbar}>
        <DateControls
          dateMode={dateMode}
          picker={datePicker}
          compact={compactToolbar}
          lastUpdated={lastUpdated}
          loading={dataLoading}
          error={dataError}
          empty={allCodes.length === 0}
        />
      </PanelToolbar>

      {(leadButtons.length > 0 || unitButtons.length > 0) && (
        <div className="section">
          <SeriesButtonRow
            lead={leadButtons}
            items={unitButtons}
            trail={unitButtons.length > 0 ? [<ClearButton key="clear" cleared={nothingSelected} onClick={clearOrSelectAll} />] : []}
          />
        </div>
      )}

      {/* Chart area */}
      <div style={{ paddingTop: 'var(--space-md)', flex: 1, minHeight: 0, height: '100%' }}>
        <NodeChart
          chartKey={`${substation.siteId}-${String(panel.expanded)}-${aggregatePeriod ?? 'live'}`}
          options={chartOptions}
          loading={dataLoading}
          error={dataError}
          empty={allCodes.length === 0}
        />
      </div>
    </Panel>
  )
}
