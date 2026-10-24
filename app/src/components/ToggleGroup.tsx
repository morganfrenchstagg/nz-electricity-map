import type { ReactNode } from 'react'
import type { AllAggregation, DateMode } from '../hooks/useDispatchData'

interface ToggleOption {
  key: string
  label: string
  // Label in the compact dropdown, where the neighbouring options aren't there to give it context
  menuLabel?: string
  title?: string
  active: boolean
  onClick: () => void
}

interface ToggleGroupProps {
  options: ToggleOption[]
  // Render as a dropdown, for toolbars too narrow for the buttons
  compact?: boolean
  ariaLabel?: string
  // A last button of the caller's own, e.g. PeriodToggle's calendar. The dropdown leaves it out.
  trail?: ReactNode
}

// Segmented button group, e.g. Generation / Offers.
export function ToggleGroup({ options, compact = false, ariaLabel, trail }: ToggleGroupProps) {
  // A single button stays a button: a one-option dropdown has nothing to choose from
  if (compact && options.length > 1) {
    const active = options.find(o => o.active)
    return (
      <select
        value={active?.key ?? ''}
        onChange={e => options.find(o => o.key === e.target.value)?.onClick()}
        aria-label={ariaLabel}
        className="toggle-select"
      >
        {options.map(o => (
          <option key={o.key} value={o.key} title={o.title}>{o.menuLabel ?? o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <div role="group" aria-label={ariaLabel} className="toggle-group">
      {options.map(o => (
        <button key={o.key} onClick={o.onClick} title={o.title} aria-pressed={o.active}>
          {o.label}
        </button>
      ))}
      {trail}
    </div>
  )
}

export type Period = 'today' | 'recent' | 'last30' | 'lastYear' | '5y' | 'all'

const PERIODS: { kind: Period; label: string; menuLabel?: string; title?: string }[] = [
  { kind: 'today', label: 'Today' },
  { kind: 'recent', label: '3d', menuLabel: '3 days', title: 'Last 3 days' },
  { kind: 'last30', label: '30d', menuLabel: '30 days', title: 'Last 30 days' },
  { kind: 'lastYear', label: '1y', menuLabel: '1 year', title: 'Last 52 weeks' },
  { kind: '5y', label: '5y', menuLabel: '5 years', title: 'Last 60 months' },
  { kind: 'all', label: 'All', menuLabel: 'All time', title: 'Everything since 2009' },
]

interface PeriodToggleProps {
  dateMode: DateMode
  onSelect: (period: Period) => void
  compact?: boolean
  // A date or range is picked, or being picked, with the date range picker
  customDates: boolean
  // The compact toolbar hides the calendar button, so its dropdown has an option to show it
  onCustom: () => void
  // DateRangePicker's button, after All
  calendar: ReactNode
}

// The Today | 3d | 30d | 1y | 5y | All toggle shared by the node panels and GridOverviewPanel.
export function PeriodToggle({ dateMode, onSelect, compact = false, customDates, onCustom, calendar }: PeriodToggleProps) {
  const options: ToggleOption[] = PERIODS.map(p => ({
    key: p.kind,
    label: p.label,
    menuLabel: p.menuLabel,
    title: p.title,
    active: !customDates && dateMode.kind === p.kind,
    onClick: () => onSelect(p.kind),
  }))
  if (compact) options.push({ key: 'custom', label: 'Custom dates', active: customDates, onClick: onCustom })
  return <ToggleGroup compact={compact} ariaLabel="Period" options={options} trail={calendar} />
}

const AGGREGATIONS: { kind: AllAggregation; label: string; title: string }[] = [
  { kind: 'annual', label: 'Yearly', title: 'Every complete year since 2009' },
  { kind: 'quarterly', label: 'Quarterly', title: 'Every complete calendar quarter since 2009' },
]

interface AggregationToggleProps {
  aggregation: AllAggregation
  onSelect: (aggregation: AllAggregation) => void
  compact?: boolean
}

// The Yearly | Quarterly toggle beside PeriodToggle while All is picked
export function AggregationToggle({ aggregation, onSelect, compact = false }: AggregationToggleProps) {
  const options: ToggleOption[] = AGGREGATIONS.map(a => ({
    key: a.kind,
    label: a.label,
    title: a.title,
    active: aggregation === a.kind,
    onClick: () => onSelect(a.kind),
  }))
  return <ToggleGroup compact={compact} ariaLabel="Totals" options={options} />
}
