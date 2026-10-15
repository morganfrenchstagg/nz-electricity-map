import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Highcharts from 'highcharts'
// Keyboard navigation and screen reader descriptions for every chart. Must be
// imported after highcharts, which it registers itself with.
import 'highcharts/modules/accessibility'
import './index.css'
import App from './App.tsx'

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif'

// Text sizes from the type scale in index.css, for every chart
const AXIS_TEXT = {
  labels: { style: { fontSize: 'var(--font-size-2xs)' } },
  title: { style: { fontSize: 'var(--font-size-xs)' } },
}

Highcharts.setOptions({
  chart: { style: { fontFamily: FONT_STACK } },
  xAxis: AXIS_TEXT,
  yAxis: AXIS_TEXT,
  legend: { itemStyle: { fontSize: 'var(--font-size-xs)' } },
  tooltip: { style: { fontSize: 'var(--font-size-sm)' } },
  accessibility: {
    // A landmark for the chart, rather than for each of its series as well
    landmarkVerbosity: 'one',
    // Each point of a day of 5-minute data (288 of them, or 300 the day the
    // clocks go back, and withGaps' nulls) can be read out, rather than none
    // once the day passes 200
    series: { pointDescriptionEnabledThreshold: 350 },
    // The nulls withGaps breaks a line with are a millisecond after the point
    // before them, not readings of their own
    point: { describeNull: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
