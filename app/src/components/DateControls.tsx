import { MAX_RANGE_DAYS } from '../hooks/useDispatchData'
import type { DateMode } from '../hooks/useDispatchData'
import { FIRST_DAY, yesterdayNZ } from '../hooks/useAggregates'
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
}

// The period toggle (and the All view's Yearly | Quarterly toggle), date range
// picker and data status in every panel's toolbar. GeneratorPanel's Offers
// view has its own.
export default function DateControls({ dateMode, picker, compact, lastUpdated, loading, error, empty }: Props) {
  const {
    pickerRange, pickerOpen, setPickerOpen, customDates, showDateInputs, rangeError,
    handleRangeChange, handlePeriodClick, handleAggregationClick, handleCustomClick,
  } = picker

  return (
    <>
      <PeriodToggle dateMode={dateMode} onSelect={handlePeriodClick} compact={compact} customDates={customDates} onCustom={handleCustomClick} />
      {dateMode.kind === 'all' && !customDates && (
        <AggregationToggle aggregation={dateMode.aggregation} onSelect={handleAggregationClick} compact={compact} />
      )}
      {!compact && <div className="divider" />}
      {showDateInputs && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <DateRangePicker
          value={pickerRange}
          onChange={handleRangeChange}
          min={FIRST_DAY}
          max={yesterdayNZ()}
          maxDays={MAX_RANGE_DAYS}
          isOpen={pickerOpen}
          onOpenChange={setPickerOpen}
          isInvalid={rangeError != null}
          ariaLabel="Dates"
        />
        {rangeError && (
          <span className="status-text is-error" style={{ marginLeft: 4 }}>{rangeError}</span>
        )}
      </div>}
      {lastUpdated && !loading && (
        <>{!compact && <div className="divider" />}<span className="status-text" style={{ marginLeft: compact ? 0 : 4 }}>{lastUpdated}</span></>
      )}
      {loading && <span className="status-text">Loading…</span>}
      {error && !empty && <span className="status-text is-error">Failed to load data</span>}
    </>
  )
}
