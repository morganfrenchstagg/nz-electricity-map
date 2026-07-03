import { useEffect, useState } from 'react'

const BASE = 'https://api.electricitymap.frenchsta.gg/v1/offers'

export interface Offer {
  tranche: number
  megawatts: number
  price: number
}

export interface OffersData {
  date: string
  data: Record<string, Record<string, Offer[]>>
}

const cache = new Map<string, OffersData>()
const inFlight = new Map<string, Promise<OffersData>>()

function fetchOffers(date: string): Promise<OffersData> {
  const existing = inFlight.get(date)
  if (existing) return existing
  // 'latest' is a special sentinel — fetches the latest-available date
  const segment = date === 'latest' ? 'latest' : date
  const p = fetch(`${BASE}/${segment}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<OffersData>
  }).then(data => {
    cache.set(date, data)
    inFlight.delete(date)
    return data
  }).catch(err => {
    inFlight.delete(date)
    throw err
  })
  inFlight.set(date, p)
  return p
}

export function todayNZT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

export function currentTradingPeriod(): number {
  const now = new Date()
  const nztDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const nztMidnight = new Date(`${nztDateStr}T00:00:00`)
  const minutesSinceMidnight = (now.getTime() - nztMidnight.getTime()) / 60000
  return Math.max(1, Math.ceil(minutesSinceMidnight / 30))
}

export function tradingPeriodLabel(tp: number, date: string): string {
  // Normalise both "YYYYMMDD" and "YYYY-MM-DD" to the dashed form
  const iso = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date
  const midnight = new Date(`${iso}T00:00:00`)
  const startMs = midnight.getTime() + (tp - 1) * 30 * 60000
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

    if (cache.has(date)) {
      setOffersData(cache.get(date)!)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
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
