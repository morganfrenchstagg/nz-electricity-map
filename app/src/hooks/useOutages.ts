import { useState, useEffect } from 'react'
import { fetchOutages, peekOutages } from '../api'
import type { OutageData } from '../api'
import { pollWhileVisible } from '../utils/poll'

// Only reaches the network once the last response's max-age runs out (see api.ts)
const REFRESH_MS = 5 * 60 * 1000

// `live` is false while a past day or aggregate is open, when outages load once
// and aren't refreshed until Today or 3d is picked again (see isLiveMode).
export function useOutages(live: boolean): OutageData | null {
  const [outages, setOutages] = useState<OutageData | null>(() => peekOutages() ?? null)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetchOutages()
        .then((data) => { if (!cancelled) setOutages(data) })
        .catch(() => {})
    }
    load()
    const stopPolling = live ? pollWhileVisible(load, REFRESH_MS) : undefined
    return () => { cancelled = true; stopPolling?.() }
  }, [live])

  return outages
}
