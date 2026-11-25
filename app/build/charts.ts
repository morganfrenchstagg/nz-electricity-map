import type { ChartTip } from '../src/utils/chartTip'
import { esc } from './html'

// A bar chart of one series for the built pages: one bar a year, growing from
// the baseline, and a second series, if any, marked as a line across each bar.
// It's HTML rather than SVG, so its text stays its size however wide the page
// is, and its bars just narrow on a phone. Each column carries its year's
// figures in data-tip, for the tooltip that src/chartTooltip.ts shows over it
// on a page of its own (see renderPage). Its table beside it carries every
// value. See .prerender__chart in index.css.

export interface Bar {
  label: string
  value: number
  // Only partly covered, e.g. the current year so far: drawn faded
  partial?: boolean
  // What its tooltip calls it, if not its label, e.g. "2026 so far"
  title?: string
  // A second series' value, marked as a line across the bar
  mark?: number
  // Its year's other figures, for its tooltip, after the bar's and the mark's
  more?: [string, string][]
}

export interface ChartOptions {
  colour: string
  unit: string
  // The chart as a screen reader announces it
  label: string
  format: (v: number) => string
  // What the bars, and the marks across them, are called in their tooltips
  name: string
  markName?: string
}

function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / power
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power
}

function tickLabel(value: number, compact: boolean, unit: string): string {
  const n = compact && value !== 0 ? `${(value / 1000).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}K` : value.toLocaleString('en-NZ', { maximumFractionDigits: 1 })
  return unit === '%' ? `${n}%` : n
}

export function barChart(bars: Bar[], { colour, unit, label, format, name, markName }: ChartOptions): string {
  if (bars.length === 0) return ''
  const max = Math.max(...bars.map((b) => Math.max(b.value, b.mark ?? 0)), 0)
  const step = niceStep((max || 1) / 4)
  const top = Math.ceil((max || 1) / step) * step
  const compact = top >= 10000
  // A value's height, as a percentage of the plot's
  const height = (v: number) => Math.round((Math.max(0, v) / top) * 1000) / 10

  const ticks: string[] = []
  for (let v = 0; v <= top + step / 2; v += step) {
    ticks.push(`<div class="prerender__chart-tick" style="bottom:${height(v)}%"><span>${esc(tickLabel(v, compact, unit))}</span></div>`)
  }

  const columns = bars.map((b) => {
    const tip: ChartTip = {
      title: b.title ?? b.label,
      rows: [
        { name, value: format(b.value), swatch: b.partial ? 'part' : 'bar' },
        ...(b.mark === undefined ? [] : [{ name: markName ?? '', value: format(b.mark), swatch: 'mark' as const }]),
        ...(b.more ?? []).map(([n, v]) => ({ name: n, value: v })),
      ],
    }
    return `<div class="prerender__chart-column" data-tip="${esc(JSON.stringify(tip))}">`
      + (b.value > 0 ? `<div class="prerender__chart-bar${b.partial ? ' prerender__chart-bar--part' : ''}" style="height:${height(b.value)}%"></div>` : '')
      + (b.mark !== undefined && b.mark > 0 ? `<div class="prerender__chart-mark" style="bottom:${height(b.mark)}%"></div>` : '')
      + '</div>'
  }).join('')

  // Every year's label when they fit, else every fifth year's and the last's
  const labelled = (i: number) => bars.length <= 12 || i === bars.length - 1 || (Number(bars[i].label) % 5 === 0 && i < bars.length - 3)
  const years = bars.map((b, i) => `<span>${labelled(i) ? esc(b.label) : ''}</span>`).join('')

  // A percentage's ticks say so themselves
  return `<div class="prerender__chart" role="img" aria-label="${esc(label)}" style="--chart-colour:${esc(colour)}">`
    + (unit === '%' ? '' : `<span class="prerender__chart-unit">${esc(unit)}</span>`)
    + `<div class="prerender__chart-ticks">${ticks.join('')}</div>`
    + `<div class="prerender__chart-columns">${columns}</div>`
    + `<div class="prerender__chart-years">${years}</div>`
    + '</div>'
}
