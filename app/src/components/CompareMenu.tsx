import { useState } from 'react'
import type { Key } from 'react'
import { Button, Dialog, DialogTrigger, ListBox, ListBoxItem, Popover } from 'react-aria-components'
import type { DateMode } from '../hooks/useDispatchData'
import {
  compareButtonLabel,
  compareOptions,
  customStartBounds,
  optionLabel,
  optionPeriod,
  priorPeriod,
  viewLabel,
} from '../utils/compare'
import type { Compare, CompareOption, PriorPeriod } from '../utils/compare'
import { CompareCalendar } from './LazyDatePickers'
import { CalendarIcon } from './dateLabels'

const OFF = 'off'

interface Props {
  dateMode: DateMode
  compare: Compare | null
  onCompareChange: (compare: Compare | null) => void
  // The toolbar's compact layout, where it's a dropdown (see PanelToolbar)
  compact: boolean
}

// The button after the period toggle that compares the view with an earlier
// period, charted as dotted lines (see utils/compare). It opens a list of the
// view's choices, each with the dates it compares with, and a calendar to
// pick a custom start from. The compact toolbar has a dropdown in its place,
// with a calendar button beside it while a custom start is picked.
export default function CompareMenu({ dateMode, compare, onCompareChange, compact }: Props) {
  const [open, setOpen] = useState(false)
  const options = compareOptions(dateMode)
  const period = priorPeriod(dateMode, compare)
  const selected = period?.option ?? OFF

  // Each choice's period, or null where it reaches outside the data. A custom
  // start's is only known once one's picked.
  const periodOf = (option: CompareOption) =>
    option === 'custom' ? (selected === 'custom' ? period : null) : optionPeriod(dateMode, option)
  const unavailable = (option: CompareOption) => option !== 'custom' && periodOf(option) === null

  // A custom start picks up from the period compared with, where it can
  function startCustom() {
    const bounds = customStartBounds(dateMode)
    const start = period && period.from <= bounds.max ? period.from : bounds.max
    onCompareChange(start)
  }

  function select(key: Key) {
    if (key === OFF) onCompareChange(null)
    else if (key === 'custom') startCustom()
    else onCompareChange(key as Compare)
    // The calendar stays open to pick the custom start from
    if (key !== 'custom') setOpen(false)
  }

  const custom = selected === 'custom' && period && (
    <CustomStart dateMode={dateMode} period={period} onChange={onCompareChange} />
  )

  if (options.length === 0) {
    return (
      <Button isDisabled aria-label="Compare: All has no earlier period" className="compare-button">
        <CompareIcon />
        Compare
      </Button>
    )
  }

  if (compact) {
    return (
      <>
        <select
          value={selected}
          onChange={(e) => {
            select(e.target.value)
            if (e.target.value === 'custom') setOpen(true)
          }}
          aria-label="Compare with"
          className="toggle-select"
        >
          {/* Says Compare while nothing is, as the button does; once something is, it's how to turn it off */}
          <option value={OFF}>{selected === OFF ? 'Compare' : 'No comparison'}</option>
          {options.map((o) => (
            <option key={o} value={o} disabled={unavailable(o)}>
              vs {optionLabel(dateMode, o).toLowerCase()}
              {o === 'custom' ? '…' : ''}
            </option>
          ))}
        </select>
        {custom && (
          <DialogTrigger isOpen={open} onOpenChange={setOpen}>
            <Button aria-label={`Compare from ${period.label}`} className="icon-button">
              <CalendarIcon />
            </Button>
            <Popover placement="bottom start" offset={4} className="popover">
              <Dialog aria-label="Compare from" className="compare-dialog">
                {custom}
              </Dialog>
            </Popover>
          </DialogTrigger>
        )}
      </>
    )
  }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className={period ? 'compare-button is-active' : 'compare-button'}>
        <CompareIcon />
        {compareButtonLabel(dateMode, period)}
        <span aria-hidden="true" className="compare-chevron">
          ▾
        </span>
      </Button>
      <Popover placement="bottom start" offset={4} className="popover">
        <Dialog aria-label="Compare with" className="compare-dialog">
          <ListBox
            aria-label="Compare with"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[selected]}
            disabledKeys={options.filter(unavailable)}
            onSelectionChange={(keys) => {
              const [key] = [...keys]
              if (key !== undefined) select(key)
            }}
            className="compare-options"
          >
            <ListBoxItem id={OFF} className="menu-item">
              No comparison
            </ListBoxItem>
            {options.map((o) => {
              const p = periodOf(o)
              const label = `${optionLabel(dateMode, o)}${o === 'custom' && !p ? '…' : ''}`
              return (
                <ListBoxItem key={o} id={o} textValue={label} className="menu-item">
                  <span>{label}</span>
                  {p && <span className="compare-option-dates">{p.label}</span>}
                </ListBoxItem>
              )
            })}
          </ListBox>
          {custom}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

// The calendar a custom period's start is picked from, and the days it runs to
function CustomStart({
  dateMode,
  period,
  onChange,
}: {
  dateMode: DateMode
  period: PriorPeriod
  onChange: (start: string) => void
}) {
  const { min, max, days } = customStartBounds(dateMode)
  return (
    <div className="compare-custom">
      <span className="eyebrow">Compare from</span>
      <CompareCalendar value={period.from} onChange={onChange} min={min} max={max} days={days} />
      <span className="status-text">{days > 1 ? `${period.label} · ${days} days, to match` : period.label}</span>
    </div>
  )
}

// The key to a compared chart, over it: the view's solid line and the earlier
// period's dotted one, with `note` saying which series it's drawn for
export function CompareLegend({ dateMode, period, note }: { dateMode: DateMode; period: PriorPeriod; note?: string }) {
  return (
    <div className="compare-legend">
      <span>
        <span className="compare-legend-line" />
        {viewLabel(dateMode)}
      </span>
      <span>
        <span className="compare-legend-line compare-legend-line--prior" />
        {period.label}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  )
}

function CompareIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3" />
    </svg>
  )
}
