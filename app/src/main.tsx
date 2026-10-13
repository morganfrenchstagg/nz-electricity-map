import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Highcharts from 'highcharts'
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
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
