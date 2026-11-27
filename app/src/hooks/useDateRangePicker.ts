import { useCallback, useMemo, useState } from 'react'
import { daysBetween, MAX_RANGE_DAYS, periodMode } from './useDispatchData'
import type { AggregateMode, DateMode } from './useDispatchData'
import { FIRST_DAY, yesterdayNZ } from './useAggregates'
import type { Period } from '../components/ToggleGroup'

// e.g. "1 January 2009", read in UTC so it isn't the day before west of UTC
const FIRST_DAY_LABEL = new Date(`${FIRST_DAY}T00:00:00Z`).toLocaleDateString('en-NZ', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// The from/to dates for a dateMode: a date or range fills them, a period clears them
function inputDates(m: DateMode): [string, string] {
  return m.kind === 'date' ? [m.date, ''] : m.kind === 'range' ? [m.from, m.to] : ['', '']
}

// Why from, or from–to, can't be charted. The pickers' bounds stop most of these, but dates can be typed.
export function dateRangeError(from: string, to: string): string | null {
  if (!from) return null
  if (from < FIRST_DAY) return `Data starts on ${FIRST_DAY_LABEL}`
  if ((to || from) > yesterdayNZ()) return 'Dates must be before today'
  if (!to) return null
  if (to < from) return 'End date must be after start date'
  const days = daysBetween(from, to)
  if (days > MAX_RANGE_DAYS) return `Range exceeds ${MAX_RANGE_DAYS} days (${days} selected)`
  return null
}

// For DateControls in each panel's toolbar. `compact` is the collapsed toolbar
// (see useCompactWhenOverflowing), which hides the picker until it's in use.
export function useDateRangePicker(dateMode: DateMode, onDateModeChange: (m: DateMode) => void, compact: boolean) {
  // dateMode may come from the URL. A single day leaves toDate empty.
  const [fromDate, setFromDate] = useState(() => inputDates(dateMode)[0])
  const [toDate, setToDate] = useState(() => inputDates(dateMode)[1])
  const [pickerOpen, setPickerOpen] = useState(false)
  // "Custom dates" chosen in the compact toolbar's dropdown, before a date is picked
  const [customRequested, setCustomRequested] = useState(false)

  // dateMode is shared and GridOverviewPanel stays mounted under a node panel, so follow the
  // other panel's changes. During render, not in an effect, so GeneratorPanel's effect setting
  // the latest offers' date still runs after it.
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

  // A single day starts and ends on it
  const pickerRange = useMemo(
    () => (fromDate ? { start: fromDate, end: toDate || fromDate } : null),
    [fromDate, toDate],
  )

  const rangeError = useMemo(() => dateRangeError(fromDate, toDate), [fromDate, toDate])

  // If it can't be charted, rangeError says why and the chart stays as it is
  const handleRangeChange = useCallback(
    (range: { start: string; end: string }) => {
      const from = range.start
      const to = range.end !== range.start ? range.end : ''
      setFromDate(from)
      setToDate(to)
      if (dateRangeError(from, to)) return
      onDateModeChange(to ? { kind: 'range', from, to } : { kind: 'date', date: from })
    },
    [onDateModeChange],
  )

  // From GeneratorPanel's Offers date picker; starts the range if there is one
  const handleFromChange = useCallback(
    (val: string | null) => {
      setFromDate(val ?? '')
      if (!val) return
      const to = toDate && toDate > val ? toDate : ''
      if (!to) setToDate('')
      if (dateRangeError(val, to)) return
      onDateModeChange(to ? { kind: 'range', from: val, to } : { kind: 'date', date: val })
    },
    [toDate, onDateModeChange],
  )

  const handlePeriodClick = useCallback(
    (period: Period) => {
      setFromDate('')
      setToDate('')
      setCustomRequested(false)
      // Aggregate views start on their default totals, or keep the picked ones if clicked
      // again. Always a new object, so clicking Today or 3d again reloads.
      onDateModeChange(dateMode.kind === period ? { ...dateMode } : periodMode(period))
    },
    [dateMode, onDateModeChange],
  )

  const handleAggregationClick = useCallback(
    (mode: AggregateMode) => {
      onDateModeChange(mode)
    },
    [onDateModeChange],
  )

  const handleCustomClick = useCallback(() => {
    setCustomRequested(true)
    setPickerOpen(true)
  }, [])

  return {
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
