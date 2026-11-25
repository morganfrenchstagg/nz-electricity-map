// What a bar of a built page's chart shows in its tooltip: its year, then a row
// for each of that year's figures. The build writes it into the bar's data-tip
// (see build/charts.ts) and chartTooltip.ts shows it.
export interface ChartTip {
  title: string
  rows: ChartTipRow[]
}

export interface ChartTipRow {
  name: string
  value: string
  // Beside it, as the chart draws it: the bar, faded for part of a year, or the mark across it
  swatch?: 'bar' | 'part' | 'mark'
}

const MARGIN = 8

// Where a tooltip of `size` goes for the bar in `column` whose top is at `top`:
// centred over the bar, or under its top where there's no room above, and kept
// inside the viewport
export function tipPosition(
  column: { left: number; width: number },
  top: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(column.left + column.width / 2 - size.width / 2, viewport.width - size.width - MARGIN))
  const above = top - size.height - MARGIN
  return { left, top: above >= MARGIN ? above : Math.max(MARGIN, Math.min(top + MARGIN, viewport.height - size.height - MARGIN)) }
}
