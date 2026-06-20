import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Highcharts from 'highcharts'
import './index.css'
import App from './App.tsx'

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif'

Highcharts.setOptions({
  chart: { style: { fontFamily: FONT_STACK } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
