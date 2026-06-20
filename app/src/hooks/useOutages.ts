import { useState, useEffect } from 'react'

const OUTAGES_URL = 'https://api.electricitymap.frenchsta.gg/v1/outages'
const REFRESH_MS = 5 * 60 * 1000

export interface OutageRecord {
  outageBlock: string
  timeStart: string
  timeEnd: string
  mwattLost: number
}

export type OutageData = Record<string, OutageRecord[]>

let cachedOutages: OutageData | null = null

export function useOutages(): OutageData | null {
  const [outages, setOutages] = useState<OutageData | null>(cachedOutages)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetch(OUTAGES_URL)
        .then((r) => r.json() as Promise<OutageData>)
        .then((data) => {
          if (!cancelled) { cachedOutages = data; setOutages(data) }
        })
        .catch(() => {})
    }
    if (!cachedOutages) load()
    const interval = setInterval(() => { cachedOutages = null; load() }, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return outages
}
