import { useState, useMemo, useEffect, useCallback } from 'react'
import type Highcharts from 'highcharts'
import type { RecentData, SubstationNode, Unit } from '../types'
import { useDefinitions } from '../hooks/useDefinitions'
import { useCodeSelection, useNodeData } from '../hooks/useNodeData'
import { useDistributedSolar, useDistributedSolarEnergy } from '../hooks/useDistributedSolar'
import { SUBSTATION_SOLAR } from '../featureFlags'
import { busLabel, chartReach, dataInterval, isGeneratorCode, substationCodes, timeChartAccessibility, tooltipTime, unitOfCode } from '../utils/chart'
import type { ChartData } from '../utils/chart'
import { nodeChartOptions, pricesByTime, tooltipRow, tooltipTotalRow } from '../utils/nodeChart'
import { DISTRIBUTED_SOLAR_FUEL_CODE, fuelCodeColour, fuelCodeLabel, fuelColour, voltageColour } from '../utils/colours'
import { distributedSolarAt, distributedSolarEnergy, shortOfDaysNote } from '../utils/distributedSolar'
import { energyUnit, MW_UNIT } from '../utils/format'
import { nzLocalMs } from '../utils/time'
import { unitLabel } from '../utils/generators'
import SeriesButtonRow, { ClearButton, SeriesButton } from './SeriesButtonRow'
import { useLastUpdated } from '../hooks/useLastUpdated'
import { useCompactWhenOverflowing } from '../hooks/useCompactWhenOverflowing'
import { useDateRangePicker } from '../hooks/useDateRangePicker'
import { SUBSTATION_FIRST_DAY, yesterdayNZ } from '../hooks/useAggregates'
import Panel, { PanelToolbar } from './Panel'
import DateControls from './DateControls'
import { NodeChart, NodeTitle } from './NodePanelParts'
import type { NodePanelProps } from './NodePanelParts'

const TOTAL = 'Total'
const TOTAL_COLOUR = '#222222'
const SOLAR = fuelCodeLabel(DISTRIBUTED_SOLAR_FUEL_CODE)
const SOLAR_COLOUR = fuelCodeColour(DISTRIBUTED_SOLAR_FUEL_CODE)
const DEMAND_WITH_SOLAR = 'Demand + distributed solar (est.)'
// The series that aren't codes, which the tooltip lists apart from them
const EXTRA_SERIES = [TOTAL, SOLAR, DEMAND_WITH_SOLAR]

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

// The substation's demand at each time: its buses' load, without the
// generators that Total nets off it
function demandLoads({ rows, codes }: ChartData): number[] {
  return totalLoads({ rows, codes: codes.filter((code) => !isGeneratorCode(code)) })
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

// The distributed solar estimated at the substation, charted above 0 (unlike
// its generators, which are negative load), and a dashed line adding it back
// onto the demand (see demandLoads): the demand there would be without it. Both are left off where
// there's no estimate.
function distributedSolarSeries({ rows }: ChartData, solar: (number | null)[], demand: number[], shown: { solar: boolean; demand: boolean }, unitSize: number): Highcharts.SeriesLineOptions[] {
  const points = (value: (estimate: number, i: number) => number) =>
    rows.map((row, i): [number, number | null] => {
      const estimate = solar[i]
      return [nzLocalMs(row.time), estimate === null ? null : value(estimate, i) / unitSize]
    })
  return [
    {
      type: 'line',
      name: SOLAR,
      visible: shown.solar,
      color: SOLAR_COLOUR,
      data: points((estimate) => estimate),
      marker: { enabled: false },
      animation: false,
    },
    {
      type: 'line',
      name: DEMAND_WITH_SOLAR,
      visible: shown.demand,
      color: TOTAL_COLOUR,
      dashStyle: 'Dash',
      lineWidth: 2,
      zIndex: 5,
      data: points((estimate, i) => demand[i] + estimate),
      marker: { enabled: false },
      animation: false,
    },
  ]
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

  const datePicker = useDateRangePicker(dateMode, onDateModeChange, compactToolbar, SUBSTATION_FIRST_DAY)

  const hasGenerators = allCodes.some(isGeneratorCode)
  const generatorsShown = hasGenerators && [...effectiveCodes].some(isGeneratorCode)

  // The distributed solar estimated at the substation: its MW at each of the
  // chart's times, or on the aggregate views its MWh in each period (and the
  // periods, which can be short of days), null where there's no estimate. Null
  // when it has none in the view, or the flag is off. The panel is only
  // rendered while it's showing, so that's all it waits on
  const solarDays = useDistributedSolar(dateMode, SUBSTATION_SOLAR)
  const solarEnergy = useDistributedSolarEnergy(dateMode, SUBSTATION_SOLAR)
  const solarEstimate = useMemo(() => {
    const atSubstation = (gxp: string) => gxp === substation.siteId
    if (!chartData) return null
    if (isAggregate) {
      if (!solarEnergy.some((file) => file.series.some(atSubstation))) return null
      const energy = distributedSolarEnergy(solarEnergy, atSubstation, yesterdayNZ())
      const periods = chartData.rows.map((row) => energy.get(row.time.slice(0, 10)))
      const values = periods.map((period) => period?.mwh ?? null)
      return values.some((v) => v !== null) ? { values, periods } : null
    }
    if (!solarDays.some((day) => day.gxps.some((g) => atSubstation(g.gxp)))) return null
    const values = distributedSolarAt(solarDays, chartData.rows.map((row) => nzLocalMs(row.time)), atSubstation)
    return values.some((v) => v !== null) ? { values, periods: [] } : null
  }, [chartData, isAggregate, solarDays, solarEnergy, substation])
  const solar = solarEstimate?.values ?? null
  const hasSolar = solar !== null

  // A lone code's Total would just repeat it
  const hasTotal = allCodes.length > 1
  // Until the user toggles it, Total shows only when the substation has
  // generators, or distributed solar: with no generators, Total is the demand
  // the dashed line adds the estimate to
  const [totalToggled, setTotalToggled] = useState<boolean | null>(null)
  const totalShown = hasTotal && (totalToggled ?? (hasGenerators || hasSolar))
  const [solarToggled, setSolarToggled] = useState<boolean | null>(null)
  const solarShown = hasSolar && (solarToggled ?? true)
  const [solarDemandToggled, setSolarDemandToggled] = useState<boolean | null>(null)
  const solarDemandShown = hasSolar && (solarDemandToggled ?? true)
  useEffect(() => {
    setTotalToggled(null)
    setSolarToggled(null)
    setSolarDemandToggled(null)
  }, [node])
  const extrasShown = [totalShown, solarShown, solarDemandShown].filter(Boolean).length

  // Turns Total, distributed solar and the dashed demand line all on or all off
  function setExtrasToggled(shown: boolean) {
    setTotalToggled(shown)
    setSolarToggled(shown)
    setSolarDemandToggled(shown)
  }

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
  const nothingSelected = effectiveCodes.size === 0 && extrasShown === 0
  function clearOrSelectAll() {
    setActiveCodes(nothingSelected ? null : new Set())
    setExtrasToggled(nothingSelected)
  }

  // Clicking the only series showing selects them all again, as Select all does
  const onlyOneShown = effectiveCodes.size + extrasShown === 1
  function selectAll() {
    setActiveCodes(null)
    setExtrasToggled(true)
  }
  function toggleExtra(shown: boolean, setToggled: (shown: boolean) => void) {
    if (shown && onlyOneShown) selectAll()
    else setToggled(!shown)
  }
  function toggleUnit(code: string) {
    if (effectiveCodes.has(code) && onlyOneShown) selectAll()
    else toggleCode(code, extrasShown > 0)
  }

  // Shift-click shows one series alone: a code, or one of EXTRA_SERIES with no codes
  function isolate(series: string) {
    setActiveCodes(new Set(EXTRA_SERIES.includes(series) ? [] : [series]))
    setTotalToggled(series === TOTAL)
    setSolarToggled(series === SOLAR)
    setSolarDemandToggled(series === DEMAND_WITH_SOLAR)
  }

  const chartOptions = useMemo((): Highcharts.Options | null => {
    if (!chartData) return null

    const prices = pricesByTime(isAggregate ? null : recentData, chartData.codes)

    // Aggregate totals are MWh, charted in GWh unless the lines stay low
    const totals = hasTotal ? totalLoads(chartData) : []
    const demand = demandLoads(chartData)
    const shownCodes = chartData.codes.filter((code) => effectiveCodes.has(code))
    const unit = isAggregate
      ? energyUnit(chartReach(chartData.rows.map((row, i) => [
          ...shownCodes.map((code) => row[code] as number),
          ...(totalShown ? [totals[i]] : []),
          ...(solarShown ? [solar[i] ?? 0] : []),
          ...(solarDemandShown ? [demand[i] + (solar[i] ?? 0)] : []),
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
      extraSeries: [
        ...(hasTotal ? [totalSeries(chartData, totals, totalShown, unit.size)] : []),
        ...(solar ? distributedSolarSeries(chartData, solar, demand, { solar: solarShown, demand: solarDemandShown }, unit.size) : []),
      ],
      yAxis: {
        title: { text: `Load (${unit.label})` },
        softMin: 0,
        gridLineDashStyle: 'Dash',
      },
      tooltipFormatter: function () {
        const points = (this.points ?? []).filter((p) => !EXTRA_SERIES.includes(p.series.name))
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
        // The estimate isn't part of the substation's load, so it's listed after the total
        const solarPoints = (this.points ?? []).filter((p) => p.series.name === SOLAR || p.series.name === DEMAND_WITH_SOLAR)
        if (solarPoints.length > 0) {
          rows += `<tr><td colspan="3" class="eyebrow" style="padding-top:var(--space-sm)">Estimate</td></tr>` + solarPoints.map((p) => tooltipRow(p, { ...context, showName: true })).join('')
          const note = shortOfDaysNote(solarEstimate?.periods[solarPoints[0].index])
          if (note) rows += `<tr><td colspan="3" style="color:var(--color-text-muted)">${note}</td></tr>`
        }
        return `<b>${tooltipTime(this.x as number, aggregatePeriod)}</b><br/><table>${rows}</table>`
      },
      accessibility: timeChartAccessibility(
        `${substation.description} Substation load`,
        (hasGenerators ? 'Load on each bus, with generation as negative load' : 'Load on each bus')
          + (solar ? ', and distributed solar estimated from the weather, both on its own and added back onto the buses\' load' : ''),
        aggregatePeriod,
        unit,
        dataInterval(chartData.rows.map((row) => row.time)),
      ),
    })
  }, [chartData, effectiveCodes, labelFor, colourFor, recentData, hasTotal, totalShown, solar, solarEstimate, solarShown, solarDemandShown, isAggregate, aggregatePeriod, substation, hasGenerators])

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
      <SeriesButton key="total" colour={TOTAL_COLOUR} active={totalShown} onClick={() => toggleExtra(totalShown, setTotalToggled)} onIsolate={() => isolate(TOTAL)}>
        {TOTAL}
      </SeriesButton>,
    ] : []),
  ]
  if (leadButtons.length > 0 && (showUnitSelector || hasSolar)) leadButtons.push(<div key="divider" className="divider" />)

  // Lead the buttons that can go behind "+N more", as they're long
  const solarButtons = !hasSolar ? [] : [
    <SeriesButton key="solar-demand" colour={TOTAL_COLOUR} active={solarDemandShown} onClick={() => toggleExtra(solarDemandShown, setSolarDemandToggled)} onIsolate={() => isolate(DEMAND_WITH_SOLAR)}>
      {DEMAND_WITH_SOLAR}
    </SeriesButton>,
    <SeriesButton key="solar" colour={SOLAR_COLOUR} active={solarShown} onClick={() => toggleExtra(solarShown, setSolarToggled)} onIsolate={() => isolate(SOLAR)}>
      {SOLAR}
    </SeriesButton>,
  ]

  const unitButtons = !showUnitSelector ? [] : allCodes.map((code, i) => {
    const button = (
      <SeriesButton key={code} colour={colourFor(code)} active={effectiveCodes.has(code)} onClick={() => toggleUnit(code)} onIsolate={() => isolate(code)}>
        {labelFor(code)}
      </SeriesButton>
    )
    // The buses come first; a divider leads the first generator, and the first
    // bus after the distributed solar buttons
    const afterSolar = i === 0 && solarButtons.length > 0
    if (!afterSolar && !(i > 0 && isGeneratorCode(code) && !isGeneratorCode(allCodes[i - 1]))) return button
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
          // Substation data only starts in September 2020 (see
          // SUBSTATION_FIRST_DAY), so All would be empty for most of its years.
          // Opening a substation on All moves it to 5y instead (see
          // useUrlState's selectNode). If substation data is backfilled to
          // 2009, add All back here and drop that move.
          hideAll
        />
      </PanelToolbar>

      {(leadButtons.length > 0 || solarButtons.length > 0 || unitButtons.length > 0) && (
        <div className="section">
          <SeriesButtonRow
            lead={leadButtons}
            items={[...solarButtons, ...unitButtons]}
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
