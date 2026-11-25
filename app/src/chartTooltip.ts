import { tipPosition } from './utils/chartTip'
import type { ChartTip, ChartTipRow } from './utils/chartTip'

// The tooltips of the charts on the build's pages of their own, such as the
// Analysis section's, which don't load the app (see build/charts.ts): a bar's
// year and figures, from its data-tip, over it while the pointer's on its
// column, or once it's tapped. One tooltip serves every chart on the page.

const tooltip = document.createElement('div')
tooltip.className = 'chart-tooltip'
tooltip.hidden = true
// The table under each chart has every figure, for a screen reader
tooltip.setAttribute('aria-hidden', 'true')
document.body.append(tooltip)

let shownFor: HTMLElement | null = null

function element(className: string, text = ''): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

function row({ name, value, swatch }: ChartTipRow, colour: string): HTMLElement[] {
  const label = element('chart-tooltip__name')
  // A row without one keeps its place, so the names line up
  const mark = element(`chart-tooltip__swatch chart-tooltip__swatch--${swatch ?? 'none'}`)
  if (swatch === 'bar' || swatch === 'part') mark.style.background = colour
  label.append(mark, name)
  return [label, element('chart-tooltip__value', value)]
}

function show(column: HTMLElement) {
  const tip = JSON.parse(column.dataset.tip ?? '') as ChartTip
  const colour = column.closest<HTMLElement>('.prerender__chart')?.style.getPropertyValue('--chart-colour') ?? ''
  const rows = element('chart-tooltip__rows')
  rows.append(...tip.rows.flatMap((r) => row(r, colour)))
  tooltip.replaceChildren(element('chart-tooltip__title', tip.title), rows)
  tooltip.hidden = false
  shownFor = column

  const rect = column.getBoundingClientRect()
  // Over the bar, or the mark across it where that's higher, or the column's foot where the year has neither
  const tops = [...column.children].map((c) => c.getBoundingClientRect().top)
  const top = tops.length ? Math.min(...tops) : rect.bottom
  const { left, top: y } = tipPosition(rect, top, tooltip.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${y}px`
}

function hide() {
  tooltip.hidden = true
  shownFor = null
}

// The pointer moving onto another column, or off them all, or a tap elsewhere
document.addEventListener('pointerover', (event) => {
  const column = event.target instanceof Element ? event.target.closest<HTMLElement>('.prerender__chart [data-tip]') : null
  if (column === shownFor) return
  if (column) show(column)
  else hide()
})
// Off the page altogether
document.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) hide()
})
// It's placed for where the bar was, so it goes when the page scrolls
document.addEventListener('scroll', hide, { capture: true, passive: true })
