import { useState, useEffect } from 'react'
import { fetchOutages, peekOutages } from '../api'
import type { OutageData } from '../api'

// Only reaches the network once the last response's max-age runs out (see api.ts)
const REFRESH_MS = 5 * 60 * 1000

export function useOutages(): OutageData | null {
  const [outages, setOutages] = useState<OutageData | null>(() => peekOutages() ?? null)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetchOutages()
        .then((data) => { if (!cancelled) setOutages(data) })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return outages
}
