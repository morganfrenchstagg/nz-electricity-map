import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import { isLiveMode } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { nzLocalMs, nzNowMs } from '../utils/time'
import { pollWhileVisible } from '../utils/poll'

function latestTimestamp(data: RecentData): number | null {
  if (!data.data.length) return null
  const last = data.data[data.data.length - 1]
  const ts = last[0]
  if (typeof ts !== 'string') return null
  const ms = nzLocalMs(ts)
  return isNaN(ms) ? null : ms
}

function formatAgo(ts: number): string {
  const diffMs = nzNowMs() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Last updated just now'
  if (mins === 1) return 'Last updated 1 minute ago'
  return `Last updated ${mins} minutes ago`
}

export function useLastUpdated(recentData: RecentData | null, dateMode: DateMode): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!isLiveMode(dateMode)) {
      setLabel(null)
      return
    }
    if (!recentData) {
      setLabel(null)
      return
    }

    const ts = latestTimestamp(recentData)
    if (!ts) { setLabel(null); return }

    setLabel(formatAgo(ts))

    return pollWhileVisible(() => setLabel(formatAgo(ts)), 30000)
  }, [recentData, dateMode])

  return label
}
