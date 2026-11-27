import type Highcharts from 'highcharts'
import type { AggregatePeriod } from '../hooks/useAggregates'
import { tooltipTime, withGaps } from './chart'
import { shiftedMs } from './compare'
import type { PriorPeriod } from './compare'

// How an earlier period compared with a view (see utils/compare) is charted:
// dotted lines over the view's own, moved forward onto its times. They aren't
// hovered themselves; each panel's tooltip looks up their values at its time.

const DAY_MS = 24 * 60 * 60 * 1000
// The furthest a view's time can be from an earlier point and still be read
// as at it: a half-hour trading period, which the oldest dispatch data is by
const DISPATCH_TOLERANCE_MS = 30 * 60 * 1000

// An earlier period's times, moved onto a view's
export interface AlignedPrior {
  // Each earlier row's time on the view's axis, and whether it's charted:
  // within the view's span, which runs on to the end of its last day on the
  // 5-minute views, so Today's earlier day is charted to midnight
  xs: number[]
  charted: boolean[]
  // The earlier row at or just before a time on the view's axis, if it's charted
  indexAt: (x: number) => number | undefined
  // Each charted row's value, at its time on the view's axis
  points: (values: (number | null)[]) => [number, number | null][]
}

// `priorMs`, an earlier period's rows' times in order, moved forward over the
// view's, `viewMs`. `aggregate` for the 90d, 1y and 5y views' totals, whose
// periods line up exactly.
export function alignPrior(priorMs: number[], period: PriorPeriod, viewMs: number[], aggregate: boolean): AlignedPrior {
  const xs = priorMs.map((ms) => shiftedMs(ms, period.shift))
  const first = viewMs[0] ?? -Infinity
  const last = viewMs[viewMs.length - 1] ?? Infinity
  const end = aggregate ? last : (Math.floor(last / DAY_MS) + 1) * DAY_MS - 1
  const charted = xs.map((x) => x >= first && x <= end)
  const tolerance = aggregate ? 0 : DISPATCH_TOLERANCE_MS

  const indexAt = (x: number) => {
    let lo = 0
    let hi = xs.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found >= 0 && x - xs[found] <= tolerance && charted[found] ? found : undefined
  }

  const points = (values: (number | null)[]) =>
    xs.flatMap((x, i): [number, number | null][] => (charted[i] ? [[x, values[i] ?? null]] : []))

  return { xs, charted, indexAt, points }
}

interface PriorLineOptions {
  name: string
  colour: string
  data: [number, number | null][]
  // The aggregate views' totals, marked at each period as their columns are
  aggregate: boolean
  lineWidth?: number
}

// An earlier period's dotted line. A line from zero, whatever the chart's
// series stack as, and drawn over them.
export function priorLine({ name, colour, data, aggregate, lineWidth = 1.5 }: PriorLineOptions): Highcharts.SeriesLineOptions {
  return {
    type: 'line',
    id: `prior-${name}`,
    name,
    // Unstacked outright: a chart updated in place can hand this line a
    // stacked series' place, and Highcharts keeps the options left out
    stacking: undefined,
    stack: undefined,
    color: colour,
    dashStyle: 'ShortDot',
    lineWidth,
    data: aggregate ? data : withGaps(data),
    marker: { enabled: aggregate, radius: 2.5, symbol: 'circle' },
    enableMouseTracking: false,
    showInLegend: false,
    zIndex: 6,
    animation: false,
  }
}

// A dotted total over a stack, on a band of the chart's background so it
// stands out from the areas or columns under it: the band, then the line
export function priorTotalLines(options: PriorLineOptions): Highcharts.SeriesLineOptions[] {
  return [
    {
      ...priorLine({ ...options, lineWidth: 5 }),
      id: `prior-${options.name} background`,
      name: `${options.name} background`,
      color: 'var(--color-surface)',
      dashStyle: 'Solid',
      marker: { enabled: false },
      zIndex: 5,
      accessibility: { enabled: false },
    },
    priorLine({ ...options, lineWidth: 2 }),
  ]
}

// The change from an earlier value to the view's, e.g. "+12 MW (+5%)"
export function changeText(now: number, before: number, format: (value: number) => string): string {
  const diff = now - before
  const sign = diff < 0 ? '−' : '+'
  const pct = before !== 0 ? ` (${sign}${Math.abs(Math.round((diff / before) * 100))}%)` : ''
  return `${sign}${format(Math.abs(diff))}${pct}`
}

export interface PriorTooltipEntry {
  name: string
  colour: string
  // The earlier value, and the view's at the same time, in the chart's unit
  before: number | null
  now: number | null
}

// The earlier period's part of a tooltip: its time, then each entry's earlier
// value and how the view's has changed from it
export function priorTooltip(priorMs: number | undefined, entries: PriorTooltipEntry[], format: (value: number) => string, period: AggregatePeriod | null): string {
  const rows = entries.filter((e) => e.before !== null)
  if (priorMs === undefined || rows.length === 0) return ''
  const row = ({ name, colour, before, now }: PriorTooltipEntry) =>
    `<tr><td><span style="color:${colour}">┅</span> ${name}</td><td><b>${format(before!)}</b></td>`
    + `<td style="color:var(--color-text-muted);padding-left:var(--space-md)">${now !== null ? changeText(now, before!, format) : ''}</td></tr>`
  return `<table style="margin-top:var(--space-sm)"><tr><td colspan="3" class="eyebrow">${tooltipTime(priorMs, period)}</td></tr>${rows.map(row).join('')}</table>`
}

// The end of a chart's description for screen readers, when it's compared
export function priorDescription(period: PriorPeriod | null): string {
  return period ? `, with ${period.label} as dotted lines to compare` : ''
}
