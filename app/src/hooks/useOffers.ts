import { useEffect, useState } from 'react'
import { fetchDispatch, fetchOffers, peekDispatch, peekOffers } from '../api'
import type { OffersData } from '../api'
import type { RecentData } from '../types'
import { nzLocalMs, nzMidnightMs, nzWallClockMs } from '../utils/time'

const PERIOD_MS = 30 * 60000

// The offers API's "YYYYMMDD" dates as "YYYY-MM-DD"; dashed dates are left as they are
export function offersIsoDate(date: string): string {
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date
}

// A trading period's half hour in NZ time, e.g. "2:00 pm–2:30 pm" for period
// 29. Periods count half hours from NZ midnight, so a day the clocks change
// has 46 or 50 of them.
export function tradingPeriodLabel(tp: number, date: string): string {
  const startMs = nzMidnightMs(offersIsoDate(date)) + (tp - 1) * PERIOD_MS
  const endMs = startMs + PERIOD_MS
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString('en-NZ', {
    timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return `${fmt(startMs)}–${fmt(endMs)}`
}

export interface PeriodDispatch {
  mw: number
  // Null when none of the units' nodes were priced
  price: number | null
}

// Where a trading period's offers were dispatched: the MW `codes` generated,
// and the price at their nodes, each averaged over the period's 5-minute
// intervals (a period's final price is the average of its dispatch prices).
// Nodes' prices are weighted by what each generated. Null when the dispatch
// has none of the period's intervals.
export function tradingPeriodDispatch(dispatch: RecentData, codes: string[], date: string, tp: number): PeriodDispatch | null {
  // Dispatch timestamps are NZ wall-clock time. The day the clocks go back,
  // the repeated hour's two periods share their wall-clock intervals.
  const from = nzWallClockMs(nzMidnightMs(offersIsoDate(date)) + (tp - 1) * PERIOD_MS)
  const inPeriod = (row: (string | number | null)[]) => {
    const ms = nzLocalMs(row[0] as string)
    return ms >= from && ms < from + PERIOD_MS
  }
  const rows = dispatch.data.filter(inPeriod)
  if (rows.length === 0) return null
  const pricing = (dispatch.pricing ?? []).filter(inPeriod)

  let mw = 0
  let pricedMW = 0
  let weightedPrice = 0
  const prices: number[] = []
  for (const code of codes) {
    const i = dispatch.series.indexOf(code) + 1 // +1: col 0 is timestamp
    // A code missing from the dispatch generated nothing. Offers are to
    // generate, so a unit drawing power counts as generating nothing too.
    const codeMW = i === 0 ? 0 : Math.max(0, rows.reduce((sum, row) => sum + (row[i] as number), 0) / rows.length)
    mw += codeMW
    // A unit's price is its bus's (ATI2201 of ATI2201 ATI0), there when the unit isn't
    const priceIndex = i || dispatch.series.indexOf(code.split(' ')[0]) + 1
    if (priceIndex === 0) continue
    const codePrices = pricing.map(row => row[priceIndex]).filter((p): p is number => p != null)
    if (codePrices.length === 0) continue
    const codePrice = codePrices.reduce((sum, p) => sum + p, 0) / codePrices.length
    prices.push(codePrice)
    pricedMW += codeMW
    weightedPrice += codePrice * codeMW
  }
  // Units that generated nothing still have their nodes' prices, averaged evenly
  const price = prices.length === 0 ? null
    : pricedMW > 0 ? weightedPrice / pricedMW
      : prices.reduce((sum, p) => sum + p, 0) / prices.length
  return { mw, price }
}

export function useOffers(date: string | null): { offersData: OffersData | null; loading: boolean; error: string | null } {
  const [offersData, setOffersData] = useState<OffersData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!date) { setOffersData(null); setLoading(false); setError(null); return }
    let cancelled = false

    const cached = peekOffers(date)
    if (cached) setOffersData(cached)
    setLoading(!cached)
    setError(null)
    fetchOffers(date).then(data => {
      if (!cancelled) { setOffersData(data); setLoading(false) }
    }).catch(err => {
      if (!cancelled) { setError(String(err)); setLoading(false) }
    })

    return () => { cancelled = true }
  }, [date])

  return { offersData, loading, error }
}

// The dispatch the day of the offers shown, to mark where they were
// dispatched. Without it the offers are shown unmarked.
export function useOffersDispatch(offersDate: string | null): RecentData | null {
  const day = offersDate && offersIsoDate(offersDate)
  const [dispatch, setDispatch] = useState<RecentData | null>(null)

  useEffect(() => {
    if (!day) { setDispatch(null); return }
    let cancelled = false
    setDispatch(peekDispatch(day) ?? null)
    fetchDispatch(day).then(data => {
      if (!cancelled) setDispatch(data)
    }).catch(() => {
      if (!cancelled) setDispatch(null)
    })
    return () => { cancelled = true }
  }, [day])

  return dispatch
}
