import { useEffect, useState } from 'react'
import type { RecentData } from '../types'
import type { DateMode } from './useDispatchData'

function latestTimestamp(data: RecentData): Date | null {
  if (!data.data.length) return null
  const last = data.data[data.data.length - 1]
  const ts = last[0]
  if (typeof ts !== 'string') return null
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d
}

function formatAgo(ts: Date): string {
  const diffMs = Date.now() - ts.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Last updated just now'
  if (mins === 1) return 'Last updated 1 minute ago'
  return `Last updated ${mins} minutes ago`
}

export function useLastUpdated(recentData: RecentData | null, dateMode: DateMode): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (dateMode.kind !== 'recent' && dateMode.kind !== 'today') {
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

    const id = setInterval(() => setLabel(formatAgo(ts)), 30000)
    return () => clearInterval(id)
  }, [recentData, dateMode])

  return label
}
