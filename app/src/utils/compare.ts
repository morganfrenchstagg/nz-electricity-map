import { daysBetween, isAggregateMode, periodOf } from '../hooks/useDispatchData'
import type { AggregateMode, DateMode } from '../hooks/useDispatchData'
import { AGGREGATES_FIRST_DAY, FIRST_DAY, aggregateWindow, yesterdayNZ } from '../hooks/useAggregates'
import type { Shift } from '../hooks/useAggregates'
import type { RecentData } from '../types'
import { todayNZ } from './time'

// A view compared with an earlier period, charted as dotted lines over its
// own. What's picked is kept apart from the view, so it carries over from one
// view to the next where it's offered:
//   prev  the period just before, as long as the view's
//   week  a week earlier
//   year  52 weeks earlier, so the days of the week line up
//   a "YYYY-MM-DD" date, the start of a period as long as the view's
export type Compare = 'prev' | 'week' | 'year' | string

export type CompareOption = 'prev' | 'week' | 'year' | 'custom'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7
const YEAR_DAYS = 52 * WEEK_DAYS
// The 3d view's rolling window, which its previous period is shifted by
const RECENT_DAYS = 3
const NINETY_DAY_DAYS = 13 * WEEK_DAYS
// 60 months by the week, so weekly totals still start on Mondays
const FIVE_YEAR_WEEKS_DAYS = 261 * WEEK_DAYS

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function isCustomCompare(compare: Compare): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(compare)
}

// A link's ?compare=, or null for one that isn't a choice
export function parseCompare(value: string | null): Compare | null {
  if (value === 'prev' || value === 'week' || value === 'year') return value
  return value && isCustomCompare(value) && value >= FIRST_DAY ? value : null
}

// The choices a view offers, in the order its menu lists them. All has no
// earlier period to compare with.
export function compareOptions(mode: DateMode): CompareOption[] {
  switch (mode.kind) {
    case 'last90': return ['prev', 'year']
    case 'lastYear':
    case '5y': return ['prev']
    case 'all': return []
    default: return ['prev', 'week', 'year', 'custom']
  }
}

// The earlier period a view is compared with
export interface PriorPeriod {
  option: CompareOption
  // What's fetched for it: a day or range of dispatch data for the 5-minute
  // views, or the same aggregate view, fetched `shift` earlier
  mode: DateMode
  // How far back it is, which its times are moved forward by to chart them
  // over the view's own
  shift: Shift
  // The first and last days it covers
  from: string
  to: string
  // e.g. "Thu 26 Nov", "21 – 24 Nov" or "Dec 2016 – Nov 2021"
  label: string
}

// What's fetched for the period compared with, as App passes it to the panels
export interface PriorData {
  period: PriorPeriod
  recentData: RecentData | null
  loading: boolean
  error: string | null
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
}

// The first and last days a 5-minute view covers
function viewDates(mode: DateMode): { from: string; to: string } {
  const { from, to } = periodOf(mode)
  return { from: isoDate(from), to: isoDate(to) }
}

function parts(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return { weekday: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() }
}

// A day, e.g. "Thu 26 Nov", or "Fri 28 Nov 2025" outside this year
export function dayLabel(date: string, weekday = true): string {
  const { weekday: wd, day, month, year } = parts(date)
  const thisYear = String(year) === todayNZ().slice(0, 4)
  return `${weekday ? `${wd} ` : ''}${day} ${month}${thisYear ? '' : ` ${year}`}`
}

// A span of days, e.g. "21 – 24 Nov", "28 Oct – 3 Nov" or "30 Dec 2024 – 2 Jan 2025"
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from)
  const a = parts(from)
  const b = parts(to)
  const thisYear = String(b.year) === todayNZ().slice(0, 4)
  const end = `${b.day} ${b.month}${thisYear && a.year === b.year ? '' : ` ${b.year}`}`
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${end}`
  return a.month === b.month ? `${a.day} – ${end}` : `${a.day} ${a.month} – ${end}`
}

// A span of months, e.g. "Dec 2016 – Nov 2021"
function monthSpanLabel(from: string, to: string): string {
  const a = parts(from)
  const b = parts(to)
  return `${a.month} ${a.year} – ${b.month} ${b.year}`
}

// How far back each choice is for an aggregate view
function aggregateShift(mode: AggregateMode, option: CompareOption): Shift | null {
  if (option === 'year' && mode.kind === 'last90') return { days: YEAR_DAYS }
  if (option !== 'prev') return null
  switch (mode.kind) {
    case 'last90': return { days: NINETY_DAY_DAYS }
    case 'lastYear': return { days: YEAR_DAYS }
    case '5y': return mode.aggregation === 'weekly' ? { days: FIVE_YEAR_WEEKS_DAYS } : { months: 60 }
    default: return null
  }
}

function aggregatePeriod(mode: AggregateMode, option: CompareOption): PriorPeriod | null {
  const shift = aggregateShift(mode, option)
  if (!shift) return null
  const { from, to } = aggregateWindow(mode, shift)
  if (from < AGGREGATES_FIRST_DAY) return null
  // Weekly totals are keyed by the Monday each week starts on
  const last = mode.aggregation === 'weekly' ? addDays(to, 6) : to
  const label = mode.aggregation === 'monthly' ? monthSpanLabel(from, to) : spanLabel(from, last)
  return { option, mode, shift, from, to: last, label }
}

// How many days back each choice is for a 5-minute view, or null for a custom
// start that isn't before the view's
function dispatchShiftDays(mode: DateMode, option: CompareOption, start: string | undefined): number | null {
  const { from, to } = viewDates(mode)
  switch (option) {
    case 'prev': return mode.kind === 'recent' ? RECENT_DAYS : daysBetween(from, to)
    case 'week': return WEEK_DAYS
    case 'year': return YEAR_DAYS
    case 'custom': return start && start < from ? daysBetween(start, from) - 1 : null
  }
}

// The days a custom start can be, for a 5-minute view: as long as the view's
// days, ending by yesterday and starting before the view does
export function customStartBounds(mode: DateMode): { min: string; max: string; days: number } {
  const { from, to } = viewDates(mode)
  const days = daysBetween(from, to)
  const latest = addDays(yesterdayNZ(), -(days - 1))
  const beforeView = addDays(from, -1)
  return { min: FIRST_DAY, max: latest < beforeView ? latest : beforeView, days }
}

// The period a choice compares a view with, or null where it isn't offered or
// would reach outside the data
export function optionPeriod(mode: DateMode, option: CompareOption, customStart?: string): PriorPeriod | null {
  if (!compareOptions(mode).includes(option)) return null
  if (isAggregateMode(mode)) return aggregatePeriod(mode, option)
  const days = dispatchShiftDays(mode, option, customStart)
  if (days === null) return null
  const view = viewDates(mode)
  const from = addDays(view.from, -days)
  const to = addDays(view.to, -days)
  if (from < FIRST_DAY || to > yesterdayNZ()) return null
  return {
    option,
    mode: from === to ? { kind: 'date', date: from } : { kind: 'range', from, to },
    shift: { days },
    from,
    to,
    label: spanLabel(from, to),
  }
}

// The period a view is compared with, or null when it isn't. A choice the view
// doesn't offer, or can't reach, falls back to the period before.
export function priorPeriod(mode: DateMode, compare: Compare | null): PriorPeriod | null {
  if (compare === null) return null
  const custom = isCustomCompare(compare)
  return optionPeriod(mode, custom ? 'custom' : compare as CompareOption, custom ? compare : undefined)
    ?? optionPeriod(mode, 'prev')
}

// A choice's name in the menu
export function optionLabel(mode: DateMode, option: CompareOption): string {
  const day = mode.kind === 'today' || mode.kind === 'date'
  switch (option) {
    case 'prev':
      switch (mode.kind) {
        case 'today': return 'Yesterday'
        case 'date': return 'Day before'
        case 'recent': return 'Previous 3 days'
        case 'range': return `Previous ${daysBetween(mode.from, mode.to)} days`
        case 'last90': return 'Previous 13 weeks'
        case 'lastYear': return 'Previous 52 weeks'
        default: return 'Previous 5 years'
      }
    case 'week': return day ? 'Same day last week' : 'A week earlier'
    case 'year': return day ? 'Same day last year' : 'A year earlier'
    case 'custom': return day ? 'Custom date' : 'Custom start date'
  }
}

// What a view charts, for the legend beside the period it's compared with
export function viewLabel(mode: DateMode): string {
  switch (mode.kind) {
    case 'today': return `${dayLabel(todayNZ())}, so far`
    case 'recent': return 'Last 3 days'
    case 'date': return dayLabel(mode.date)
    case 'range': return spanLabel(mode.from, mode.to)
    case 'last90': return 'Last 13 weeks'
    case 'lastYear': return 'Last 52 weeks'
    case '5y': return 'Last 5 years'
    case 'all': return 'All time'
  }
}

// The compare button's label, kept short: the menu has the dates
export function compareButtonLabel(mode: DateMode, period: PriorPeriod | null): string {
  if (!period) return 'Compare'
  switch (period.option) {
    case 'prev': return mode.kind === 'today' ? 'vs yesterday' : mode.kind === 'date' ? 'vs day before' : 'vs previous'
    case 'week': return 'vs a week earlier'
    case 'year': return 'vs a year earlier'
    case 'custom': return `vs ${dayLabel(period.from, false)}`
  }
}

// A time `shift` later, to chart an earlier period's point over the view's own.
// Times are "local time as UTC" (see utils/time), so whole days keep their
// clock times across daylight saving.
export function shiftedMs(ms: number, shift: Shift): number {
  if ('days' in shift) return ms + shift.days * DAY_MS
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift.months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes())
}
