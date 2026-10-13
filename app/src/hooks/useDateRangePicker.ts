import { useCallback, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { daysBetween, MAX_RANGE_DAYS } from './useDispatchData'
import type { DateMode } from './useDispatchData'
import { yesterdayNZ } from './useAggregates'
import type { Period } from '../components/ToggleGroup'

// The from/to input values for a dateMode: a date or range fills them, a period clears them
function inputDates(m: DateMode): [string, string] {
  return m.kind === 'date' ? [m.date, ''] : m.kind === 'range' ? [m.from, m.to] : ['', '']
}

// The period toggle and from/to date inputs shared by the node panels and
// GridOverviewPanel. `compact` is the toolbar's collapsed layout (see
// useCompactWhenOverflowing), which hides the date inputs until they're in use.
export function useDateRangePicker(dateMode: DateMode, onDateModeChange: (m: DateMode) => void, compact: boolean) {
  // Date picker local state — initialized from dateMode prop (which may come from URL)
  const [fromDate, setFromDate] = useState(() => inputDates(dateMode)[0])
  const [toDate, setToDate] = useState(() => inputDates(dateMode)[1])
  // "Custom dates" chosen in the compact toolbar's dropdown, before a date is picked
  const [customRequested, setCustomRequested] = useState(false)

  // dateMode is shared, and GridOverviewPanel stays mounted while a node panel
  // is open, so follow dateMode when the other panel changes it. This panel's
  // own handlers already leave the inputs matching the dateMode they set. Done
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
  // The compact toolbar only shows the date inputs while they're in use
  const showDateInputs = !compact || customDates
  const fromInputRef = useRef<HTMLInputElement>(null)

  const toMax = useMemo(() => {
    const cap = yesterdayNZ()
    if (!fromDate) return cap
    const d = new Date(fromDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + MAX_RANGE_DAYS - 1)
    const end = d.toISOString().slice(0, 10)
    return end < cap ? end : cap
  }, [fromDate])

  const rangeError = useMemo(() => {
    if (!fromDate || !toDate) return null
    if (toDate < fromDate) return 'End date must be after start date'
    const days = daysBetween(fromDate, toDate)
    if (days > MAX_RANGE_DAYS) return `Range exceeds ${MAX_RANGE_DAYS} days (${days} selected)`
    return null
  }, [fromDate, toDate])

  const handleFromChange = useCallback((val: string) => {
    setFromDate(val)
    if (!val) {
      setToDate('')
      setCustomRequested(false)
      onDateModeChange({ kind: 'recent' })
    } else if (toDate && toDate >= val) {
      const days = daysBetween(val, toDate)
      if (days <= MAX_RANGE_DAYS) onDateModeChange({ kind: 'range', from: val, to: toDate })
    } else {
      setToDate('')
      onDateModeChange({ kind: 'date', date: val })
    }
  }, [toDate, onDateModeChange])

  const handleToChange = useCallback((val: string) => {
    setToDate(val)
    if (!val) {
      if (fromDate) onDateModeChange({ kind: 'date', date: fromDate })
    } else if (fromDate && val >= fromDate) {
      const days = daysBetween(fromDate, val)
      if (days <= MAX_RANGE_DAYS) onDateModeChange({ kind: 'range', from: fromDate, to: val })
    }
  }, [fromDate, onDateModeChange])

  const handlePeriodClick = useCallback((period: Period) => {
    setFromDate('')
    setToDate('')
    setCustomRequested(false)
    onDateModeChange({ kind: period })
  }, [onDateModeChange])

  const handleCustomClick = useCallback(() => {
    // Rendered now rather than on the next render, so the picker opens while
    // the dropdown change still counts as a user gesture
    flushSync(() => setCustomRequested(true))
    try {
      fromInputRef.current?.showPicker()
    } catch {
      fromInputRef.current?.focus()
    }
  }, [])

  return {
    fromDate,
    // For GeneratorPanel, which shows the latest offers' date in the from input
    setFromDate,
    toDate,
    setCustomRequested,
    customDates,
    showDateInputs,
    fromInputRef,
    toMax,
    rangeError,
    handleFromChange,
    handleToChange,
    handlePeriodClick,
    handleCustomClick,
  }
}
