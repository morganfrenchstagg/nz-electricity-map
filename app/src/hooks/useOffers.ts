import { useEffect, useState } from 'react'
import { fetchOffers, peekOffers } from '../api'
import type { OffersData } from '../api'
import { nzMidnightMs } from '../utils/time'

// A trading period's half hour in NZ time, e.g. "2:00 pm–2:30 pm" for period
// 29. Periods count half hours from NZ midnight, so a day the clocks change
// has 46 or 50 of them.
export function tradingPeriodLabel(tp: number, date: string): string {
  // Normalise both "YYYYMMDD" and "YYYY-MM-DD" to the dashed form
  const iso = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date
  const startMs = nzMidnightMs(iso) + (tp - 1) * 30 * 60000
  const endMs = startMs + 30 * 60000
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString('en-NZ', {
    timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return `${fmt(startMs)}–${fmt(endMs)}`
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
