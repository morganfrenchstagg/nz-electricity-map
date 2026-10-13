import type { DateMode } from '../hooks/useDispatchData'

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
}

// Segmented button group, e.g. Generation / Offers.
export function ToggleGroup({ options, compact = false, ariaLabel }: ToggleGroupProps) {
  // A single button stays a button: a one-option dropdown has nothing to choose from
  if (compact && options.length > 1) {
    const active = options.find(o => o.active)
    return (
      <select
        value={active?.key ?? ''}
        onChange={e => options.find(o => o.key === e.target.value)?.onClick()}
        aria-label={ariaLabel}
        style={{ fontSize: 12, border: '1px solid #ddd', borderRadius: 6, padding: '2px 4px', color: '#333', background: 'white', cursor: 'pointer', flexShrink: 0 }}
      >
        {options.map(o => (
          <option key={o.key} value={o.key} title={o.title}>{o.menuLabel ?? o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', borderRadius: 6, border: '1px solid #ddd', overflow: 'hidden', flexShrink: 0 }}>
      {options.map((o, i) => (
        <button
          key={o.key}
          onClick={o.onClick}
          title={o.title}
          aria-pressed={o.active}
          style={{
            padding: '3px 9px', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1,
            background: o.active ? '#1d4ed8' : 'white',
            color: o.active ? 'white' : '#555',
            fontWeight: o.active ? 600 : 400,
            borderRight: i < options.length - 1 ? '1px solid #ddd' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type Period = 'today' | 'recent' | 'last30' | 'lastYear' | 'all'

const PERIODS: { kind: Period; label: string; menuLabel?: string; title?: string }[] = [
  { kind: 'today', label: 'Today' },
  { kind: 'recent', label: '3d', menuLabel: '3 days', title: 'Last 3 days' },
  { kind: 'last30', label: '30d', menuLabel: '30 days', title: 'Last 30 days' },
  { kind: 'lastYear', label: '1y', menuLabel: '1 year', title: 'Last 52 weeks' },
  { kind: 'all', label: 'All', menuLabel: 'All time', title: 'Every month since October 2020' },
]

interface PeriodToggleProps {
  dateMode: DateMode
  onSelect: (period: Period) => void
  compact?: boolean
  // A date or range is picked, or being picked, with the date inputs
  customDates: boolean
  // The compact toolbar hides the date inputs, so its dropdown has an option to show them
  onCustom: () => void
}

// The Today | 3d | 30d | 1y | All toggle shared by NodePanel and GridOverviewPanel.
export function PeriodToggle({ dateMode, onSelect, compact = false, customDates, onCustom }: PeriodToggleProps) {
  const options: ToggleOption[] = PERIODS.map(p => ({
    key: p.kind,
    label: p.label,
    menuLabel: p.menuLabel,
    title: p.title,
    active: !customDates && dateMode.kind === p.kind,
    onClick: () => onSelect(p.kind),
  }))
  if (compact) options.push({ key: 'custom', label: 'Custom dates', active: customDates, onClick: onCustom })
  return <ToggleGroup compact={compact} ariaLabel="Period" options={options} />
}
