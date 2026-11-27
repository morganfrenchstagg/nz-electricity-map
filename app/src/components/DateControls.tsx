import { isAggregateMode, MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { FIRST_DAY, yesterdayNZ } from '../hooks/useAggregates'
import type { useDateRangePicker } from '../hooks/useDateRangePicker'
import type { Compare } from '../utils/compare'
import { AggregationToggle, PeriodToggle } from './ToggleGroup'
import { DateRangePicker } from './LazyDatePickers'
import CompareMenu from './CompareMenu'

interface Props {
  dateMode: DateMode
  picker: ReturnType<typeof useDateRangePicker>
  // The earlier period the view is compared with (see CompareMenu)
  compare: Compare | null
  onCompareChange: (compare: Compare | null) => void
  // The toolbar's compact layout (see PanelToolbar)
  compact: boolean
  lastUpdated: string | null
  loading: boolean
  error: string | null
  // The earlier period compared with failed to load
  priorError?: boolean
  // Nothing to chart, so the chart area shows the error instead
  empty: boolean
}

// The period toggle with its date range picker's calendar button (and the 90d,
// 1y, 5y and All views' totals toggle), the compare menu and data status in
// every panel's toolbar. GeneratorPanel's Offers view has its own.
export default function DateControls({
  dateMode,
  picker,
  compare,
  onCompareChange,
  compact,
  lastUpdated,
  loading,
  error,
  priorError = false,
  empty,
}: Props) {
  const {
    pickerRange,
    pickerOpen,
    setPickerOpen,
    customDates,
    showDateInputs,
    rangeError,
    handleRangeChange,
    handlePeriodClick,
    handleAggregationClick,
    handleCustomClick,
  } = picker

  const rangePicker = (
    <DateRangePicker
      value={pickerRange}
      onChange={handleRangeChange}
      min={FIRST_DAY}
      max={yesterdayNZ()}
      maxDays={MAX_RANGE_DAYS}
      error={rangeError}
      // The compact dropdown already says Custom dates
      isActive={customDates && !compact}
      isOpen={pickerOpen}
      onOpenChange={setPickerOpen}
    />
  )

  return (
    <>
      <PeriodToggle
        dateMode={dateMode}
        onSelect={handlePeriodClick}
        compact={compact}
        customDates={customDates}
        onCustom={handleCustomClick}
        calendar={rangePicker}
      />
      {compact && showDateInputs && <div className="toggle-group">{rangePicker}</div>}
      {isAggregateMode(dateMode) && !customDates && (
        <AggregationToggle dateMode={dateMode} onSelect={handleAggregationClick} compact={compact} />
      )}
      <CompareMenu dateMode={dateMode} compare={compare} onCompareChange={onCompareChange} compact={compact} />
      {/* Left out of the compact toolbar, where it would take a line of its own */}
      {lastUpdated && !loading && !compact && (
        <>
          <div className="divider" />
          <span className="status-text" style={{ marginLeft: 4 }}>
            {lastUpdated}
          </span>
        </>
      )}
      {loading && <span className="status-text">Loading…</span>}
      {error && !empty && <span className="status-text is-error">Failed to load data</span>}
      {priorError && !error && <span className="status-text is-error">Couldn't load the comparison</span>}
    </>
  )
}
