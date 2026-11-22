import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Highcharts from 'highcharts'
// Keyboard navigation and screen reader support for every chart. Must be
// imported after highcharts, which it registers with.
import 'highcharts/modules/accessibility'
import './index.css'
import App from './App.tsx'
import { initTheme } from './theme'

initTheme()

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif'

// From the type scale in index.css
const AXIS_TEXT = {
  labels: { style: { fontSize: 'var(--font-size-2xs)' } },
  title: { style: { fontSize: 'var(--font-size-xs)' } },
}

Highcharts.setOptions({
  // Highcharts follows the theme via the class initTheme puts on <html>. Its text,
  // lines and tooltips are blended from these, to match the panels' surface.
  palette: {
    light: { backgroundColor: '#ffffff' },
    dark: { backgroundColor: '#1c1c1e' },
  },
  chart: { style: { fontFamily: FONT_STACK } },
  xAxis: AXIS_TEXT,
  yAxis: AXIS_TEXT,
  legend: { itemStyle: { fontSize: 'var(--font-size-xs)' } },
  tooltip: { style: { fontSize: 'var(--font-size-sm)' } },
  accessibility: {
    // One landmark per chart, not one per series too
    landmarkVerbosity: 'one',
    // Above the default 200, so a day of 5-minute points (288, or 300 when clocks
    // go back, plus withGaps' nulls) stays readable
    series: { pointDescriptionEnabledThreshold: 350 },
    // withGaps' nulls are line breaks, not readings
    point: { describeNull: false },
  },
})

// Below that threshold the accessibility module gives each markerless point a
// hidden marker for keyboard navigation. Updated in place past it (Today to 3d),
// the chart keeps them, as Series.update forgets they were forced, and each one
// hovered stays drawn. Highcharts only clears them in styled mode (#24164).
Highcharts.addEvent(Highcharts.Series, 'afterRender', function (this: Highcharts.Series) {
  // Markers still forced show as enabled in the series' options
  if ((this.options as Highcharts.SeriesLineOptions).marker?.enabled !== false) return
  const { markerGroup } = this as Highcharts.Series & { markerGroup?: Highcharts.SVGElement }
  for (const point of this.points ?? []) {
    // A column's graphic is the column itself, in the series' group
    const graphic = point.graphic as (Highcharts.SVGElement & { parentGroup?: Highcharts.SVGElement }) | undefined
    if (graphic && graphic.parentGroup === markerGroup && !point.options.marker) {
      graphic.destroy()
      point.graphic = undefined
    }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
