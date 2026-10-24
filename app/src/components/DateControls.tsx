import { isAggregateMode, MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { yesterdayNZ } from '../hooks/useAggregates'
import type { useDateRangePicker } from '../hooks/useDateRangePicker'
import { AggregationToggle, PeriodToggle } from './ToggleGroup'
import { DateRangePicker } from './DatePickers'

interface Props {
  dateMode: DateMode
  picker: ReturnType<typeof useDateRangePicker>
  // The toolbar's compact layout (see PanelToolbar)
  compact: boolean
  lastUpdated: string | null
  loading: boolean
  error: string | null
  // Nothing to chart, so the chart area shows the error instead
  empty: boolean
  // No All view (see PeriodToggle)
  hideAll?: boolean
}

// The period toggle with its date range picker's calendar button (and the 90d,
// 1y, 5y and All views' totals toggle) and data status in every panel's toolbar.
// GeneratorPanel's Offers view has its own.
export default function DateControls({ dateMode, picker, compact, lastUpdated, loading, error, empty, hideAll }: Props) {
  const {
    firstDay, pickerRange, pickerOpen, setPickerOpen, customDates, showDateInputs, rangeError,
    handleRangeChange, handlePeriodClick, handleAggregationClick, handleCustomClick,
  } = picker

  const rangePicker = (
    <DateRangePicker
      value={pickerRange}
      onChange={handleRangeChange}
      min={firstDay}
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
        hideAll={hideAll}
      />
      {compact && showDateInputs && <div className="toggle-group">{rangePicker}</div>}
      {isAggregateMode(dateMode) && !customDates && (
        <AggregationToggle dateMode={dateMode} onSelect={handleAggregationClick} compact={compact} />
      )}
      {lastUpdated && !loading && (
        <>{!compact && <div className="divider" />}<span className="status-text" style={{ marginLeft: compact ? 0 : 4 }}>{lastUpdated}</span></>
      )}
      {loading && <span className="status-text">Loading…</span>}
      {error && !empty && <span className="status-text is-error">Failed to load data</span>}
    </>
  )
}
