import { useCallback, useMemo, useState } from 'react'
import { daysBetween, MAX_RANGE_DAYS, periodMode } from './useDispatchData'
import type { AggregateMode, DateMode } from './useDispatchData'
import { FIRST_DAY, yesterdayNZ } from './useAggregates'
import type { Period } from '../components/ToggleGroup'

// e.g. "1 January 2009", read in UTC so it isn't the day before west of UTC
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
}

// The from/to dates for a dateMode: a date or range fills them, a period clears them
function inputDates(m: DateMode): [string, string] {
  return m.kind === 'date' ? [m.date, ''] : m.kind === 'range' ? [m.from, m.to] : ['', '']
}

// Why a from date, or from–to range, can't be charted, if it can't, where
// the data starts on `firstDay`. The pickers' bounds stop most of these, but
// dates can still be typed in.
export function dateRangeError(from: string, to: string, firstDay = FIRST_DAY): string | null {
  if (!from) return null
  if (from < firstDay) return `Data starts on ${dayLabel(firstDay)}`
  if ((to || from) > yesterdayNZ()) return 'Dates must be before today'
  if (!to) return null
  if (to < from) return 'End date must be after start date'
  const days = daysBetween(from, to)
  if (days > MAX_RANGE_DAYS) return `Range exceeds ${MAX_RANGE_DAYS} days (${days} selected)`
  return null
}

// The state behind DateControls' period toggle and date range picker, in
// every panel's toolbar. `compact` is the toolbar's collapsed layout (see
// useCompactWhenOverflowing), which hides the picker until it's in use.
// `firstDay` is the earliest day the panel has data for.
export function useDateRangePicker(dateMode: DateMode, onDateModeChange: (m: DateMode) => void, compact: boolean, firstDay = FIRST_DAY) {
  // Date picker local state — initialized from dateMode prop (which may come from URL).
  // A single day leaves toDate empty.
  const [fromDate, setFromDate] = useState(() => inputDates(dateMode)[0])
  const [toDate, setToDate] = useState(() => inputDates(dateMode)[1])
  const [pickerOpen, setPickerOpen] = useState(false)
  // "Custom dates" chosen in the compact toolbar's dropdown, before a date is picked
  const [customRequested, setCustomRequested] = useState(false)

  // dateMode is shared, and GridOverviewPanel stays mounted while a node panel
  // is open, so follow dateMode when the other panel changes it. This panel's
  // own handlers already leave the picker matching the dateMode they set. Done
  // while rendering rather than in an effect, so GeneratorPanel's effect
  // showing the latest offers' date still runs after it.
  const dateModeKey = JSON.stringify(dateMode)
  const [syncedDateModeKey, setSyncedDateModeKey] = useState(dateModeKey)
  if (dateModeKey !== syncedDateModeKey) {
    setSyncedDateModeKey(dateModeKey)
    const [from, to] = inputDates(dateMode)
    setFromDate(from)
    setToDate(to)
    setCustomRequested(false)
  }
  const customDates = dateMode.kind === 'date' || dateMode.kind === 'range' || (compact && customRequested)
  // The compact toolbar only shows the picker's calendar button while it's in use
  const showDateInputs = !compact || customDates

  // The range picker's value, where a single day starts and ends on it
  const pickerRange = useMemo(
    () => fromDate ? { start: fromDate, end: toDate || fromDate } : null,
    [fromDate, toDate],
  )

  const rangeError = useMemo(() => dateRangeError(fromDate, toDate, firstDay), [fromDate, toDate, firstDay])

  // A range from the range picker. When it can't be charted, rangeError says
  // why and the chart is left as it is.
  const handleRangeChange = useCallback((range: { start: string; end: string }) => {
    const from = range.start
    const to = range.end !== range.start ? range.end : ''
    setFromDate(from)
    setToDate(to)
    if (dateRangeError(from, to, firstDay)) return
    onDateModeChange(to ? { kind: 'range', from, to } : { kind: 'date', date: from })
  }, [firstDay, onDateModeChange])

  // A date from GeneratorPanel's Offers date picker, which starts the range
  // when there is one
  const handleFromChange = useCallback((val: string | null) => {
    setFromDate(val ?? '')
    if (!val) return
    const to = toDate && toDate > val ? toDate : ''
    if (!to) setToDate('')
    if (dateRangeError(val, to, firstDay)) return
    onDateModeChange(to ? { kind: 'range', from: val, to } : { kind: 'date', date: val })
  }, [toDate, firstDay, onDateModeChange])

  const handlePeriodClick = useCallback((period: Period) => {
    setFromDate('')
    setToDate('')
    setCustomRequested(false)
    // 1y, 5y and All start on their default totals, or keep the ones picked if
    // clicked again. A new object either way, so Today or 3d clicked again reloads.
    onDateModeChange(dateMode.kind === period ? { ...dateMode } : periodMode(period))
  }, [dateMode, onDateModeChange])

  const handleAggregationClick = useCallback((mode: AggregateMode) => {
    onDateModeChange(mode)
  }, [onDateModeChange])

  const handleCustomClick = useCallback(() => {
    setCustomRequested(true)
    setPickerOpen(true)
  }, [])

  return {
    firstDay,
    fromDate,
    // For GeneratorPanel, which shows the latest offers' date in its date picker
    setFromDate,
    pickerRange,
    pickerOpen,
    setPickerOpen,
    setCustomRequested,
    customDates,
    showDateInputs,
    rangeError,
    handleRangeChange,
    handleFromChange,
    handlePeriodClick,
    handleAggregationClick,
    handleCustomClick,
  }
}
