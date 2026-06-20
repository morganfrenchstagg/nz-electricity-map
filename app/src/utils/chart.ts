import type { RecentData } from '../types'

export interface ChartRow {
  time: string
  [code: string]: string | number
}

export interface ChartData {
  rows: ChartRow[]
  codes: string[]
}

export function extractChartData(recent: RecentData, requestedCodes: string[]): ChartData {
  const codes = requestedCodes.filter((c) => recent.series.includes(c))
  const indices = codes.map((c) => recent.series.indexOf(c) + 1) // +1: col 0 is timestamp

  const rows: ChartRow[] = recent.data.map((row) => {
    const point: ChartRow = { time: row[0] as string }
    codes.forEach((code, i) => {
      point[code] = row[indices[i]] as number
    })
    return point
  })

  return { rows, codes }
}

export function substationCodes(recent: RecentData, siteId: string): string[] {
  return recent.series.filter((s) => s.startsWith(siteId))
}

