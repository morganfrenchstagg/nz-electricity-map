import { useId } from 'react'
import { AGGREGATES_FIRST_DAY } from '../hooks/useAggregates'
import { useGenerationRecords } from '../hooks/useGenerationRecords'
import type { DatedRecords } from '../hooks/useGenerationRecords'
import { averageMW } from '../utils/generationRecords'
import { formatEnergy, formatMonthYear } from '../utils/format'
import { nzNowMs, todayNZ } from '../utils/time'

interface Props {
  queryNodes: string[]
  movedNodes: Record<string, string>
  // The generating units the chart shows, which the records are for
  codes: string[]
  // The chart shows only some of the units
  someUnits: boolean
  // The chart is still loading, so which units it shows isn't known yet
  chartLoading: boolean
}

interface Tile {
  label: string
  value: string
  // Each on a line of its own
  details?: string[]
}

// As tall as a row of tiles, so the tiles don't move the chart when they replace a message
const ROW_HEIGHT = 52

// "3 Mar 2020"
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}

// A record's day, or its month until that month's daily totals load
function dayOrMonth(day: string | null, month: string): string {
  return day ? formatDay(day) : formatMonthYear(month)
}

function recordTiles(r: DatedRecords): Tile[] {
  const today = todayNZ()
  const recordsBegin = (r.firstDay ?? r.firstMonth) === AGGREGATES_FIRST_DAY
  const average = averageMW(r.bestMonth.month, r.bestMonth.mwh, nzNowMs())
  const tiles: Tile[] = [
    recordsBegin
      ? { label: 'On record since', value: dayOrMonth(r.firstDay, r.firstMonth), details: ['When the records begin'] }
      : { label: 'First generated', value: dayOrMonth(r.firstDay, r.firstMonth) },
    {
      label: 'Best year',
      value: r.bestYear.year,
      details: [formatEnergy(r.bestYear.mwh)
        + (r.bestYear.year === today.slice(0, 4) ? ' so far' : r.bestYear.year === AGGREGATES_FIRST_DAY.slice(0, 4) ? ' from August' : '')],
    },
    {
      label: 'Best month',
      value: formatMonthYear(r.bestMonth.month),
      details: [
        formatEnergy(r.bestMonth.mwh) + (r.bestMonth.month.slice(0, 7) === today.slice(0, 7) ? ' so far' : ''),
        `${average.toLocaleString('en-NZ', { maximumFractionDigits: average >= 10 ? 0 : 1 })} MW average`,
      ],
    },
  ]
  if (r.stopped) tiles.push({ label: 'Last generated', value: dayOrMonth(r.lastDay, r.lastMonth) })
  return tiles
}

// A generator's records over all its history, under its chart at All: when it
// first generated (or its records began), its best year and month, and if it's
// stopped, when it last generated. For the units the chart shows.
export default function GenerationRecords({ queryNodes, movedNodes, codes, someUnits, chartLoading }: Props) {
  const { records, loaded, error } = useGenerationRecords(queryNodes, movedNodes, codes)
  const headingId = useId()
  const message = error ? 'Failed to load records'
    : !loaded || (codes.length === 0 && chartLoading) ? 'Loading…'
      : !records ? (codes.length === 0 ? 'No units shown' : 'No generation on record')
        : null

  return (
    <section aria-labelledby={headingId} className="section" style={{ flexShrink: 0, borderTop: '1px solid var(--color-divider)', borderBottom: 'none' }}>
      <h2 id={headingId} className="eyebrow" style={{ margin: 0 }}>
        Records{someUnits ? ' · Units shown' : ''}
      </h2>
      {message !== null || records === null ? (
        <p className={error ? 'status-text is-error' : 'status-text'} style={{ display: 'flex', alignItems: 'center', minHeight: ROW_HEIGHT, margin: 'var(--space-sm) 0 0' }}>
          {message}
        </p>
      ) : (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: 'var(--space-md) var(--space-xl)', minHeight: ROW_HEIGHT, margin: 'var(--space-sm) 0 0' }}>
          {recordTiles(records).map((tile) => (
            <div key={tile.label} style={{ minWidth: 0 }}>
              <dt style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{tile.label}</dt>
              <dd style={{ margin: 'var(--space-2xs) 0 0', fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text-strong)' }}>{tile.value}</dd>
              {tile.details?.map((detail) => (
                <dd key={detail} style={{ margin: 'var(--space-2xs) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{detail}</dd>
              ))}
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
