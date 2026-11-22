import { esc } from './html'

// A bar chart of one series, as inline SVG, for the built pages: one bar a year,
// growing from the baseline, each with its value as a tooltip. Its table beside
// it carries every value. Bars are at most 24px wide with a 4px rounded end;
// gridlines are hairlines; text wears the text colours, not the bar's (see
// .prerender__chart in index.css).

export interface Bar {
  label: string
  value: number
  // Only partly covered, e.g. the current year so far: drawn faded
  partial?: boolean
}

const W = 720, H = 220
const PLOT = { top: 12, right: 8, bottom: 26, left: 52 }

function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / power
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power
}

function tickLabel(value: number, compact: boolean, unit: string): string {
  const n = compact && value !== 0 ? `${(value / 1000).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}K` : value.toLocaleString('en-NZ', { maximumFractionDigits: 1 })
  return unit === '%' ? `${n}%` : n
}

// A bar's path: square at the baseline, its top corners rounded
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

export function barChart(bars: Bar[], { colour, unit, label, format }: { colour: string; unit: string; label: string; format: (v: number) => string }): string {
  if (bars.length === 0) return ''
  const max = Math.max(...bars.map((b) => b.value), 0)
  const step = niceStep((max || 1) / 4)
  const top = Math.ceil((max || 1) / step) * step
  const plotW = W - PLOT.left - PLOT.right, plotH = H - PLOT.top - PLOT.bottom
  const band = plotW / bars.length
  const barW = Math.max(1, Math.min(24, band - 2))
  const yOf = (v: number) => PLOT.top + plotH - (v / top) * plotH
  const compact = top >= 10000

  const ticks: string[] = []
  for (let v = 0; v <= top + step / 2; v += step) {
    const y = round(yOf(v))
    ticks.push(`<line x1="${PLOT.left}" x2="${W - PLOT.right}" y1="${y}" y2="${y}"/>`
      + `<text x="${PLOT.left - 6}" y="${y + 4}" text-anchor="end">${esc(tickLabel(v, compact, unit))}</text>`)
  }

  // Every label when they fit, else every fifth year and the last
  const labelled = (i: number) => bars.length <= 12 || i === bars.length - 1 || (Number(bars[i].label) % 5 === 0 && i < bars.length - 3)
  const marks = bars.map((b, i) => {
    const x = PLOT.left + i * band
    const h = Math.max(0, yOf(0) - yOf(Math.max(0, b.value)))
    const tip = `${b.label}: ${format(b.value)}${b.partial ? ' (so far)' : ''}`
    return `<g><title>${esc(tip)}</title><rect x="${round(x)}" y="${PLOT.top}" width="${round(band)}" height="${plotH}" fill="transparent"/>`
      + (h > 0 ? `<path d="${barPath(round(x + (band - barW) / 2), round(yOf(0) - h), round(barW), round(h))}" style="fill:${esc(colour)}"${b.partial ? ' fill-opacity="0.45"' : ''}/>` : '')
      + (labelled(i) ? `<text x="${round(x + band / 2)}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>` : '')
      + '</g>'
  }).join('')

  // It scrolls sideways on a phone rather than shrink its text out of reach
  return `<div class="prerender__chart-scroll"><svg class="prerender__chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${ticks.join('')}${marks}</svg></div>`
}
