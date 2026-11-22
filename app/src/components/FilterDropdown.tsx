import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Close } from './icons'

interface Props {
  // Shown while nothing is picked
  label: string
  // Shown while several are picked
  countLabel?: (count: number) => string
  options: string[]
  active: Set<string>
  onToggle: (option: string) => void
  onClear: () => void
  // Each option's swatch, when it has one
  swatch?: (option: string) => React.CSSProperties | undefined
  // The popover's edge to line up with the button's
  align?: 'left' | 'right'
}

// A filter button that opens a popover of options to pick any number of
export default function FilterDropdown({ label, countLabel = (n) => `${label}: ${n}`, options, active, onToggle, onClear, swatch, align = 'left' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isActive = active.size > 0
  const summary = active.size === 0 ? label
    : active.size === 1 ? [...active][0]
      : countLabel(active.size)

  return (
    // Stretches to the height of whatever shares its row, e.g. a search input
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignSelf: 'stretch' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className={isActive ? 'filter-button is-active' : 'filter-button'}
      >
        {summary}
        {isActive && (
          <span
            onClick={e => { e.stopPropagation(); onClear() }}
            aria-label={`Clear ${label}`}
            style={{ opacity: 0.6 }}
          ><Close size={11} /></span>
        )}
        <span style={{ opacity: 0.5 }}><ChevronDown size={12} /></span>
      </button>
      {open && (
        <div className="popover" style={{ top: 'calc(100% + 4px)', [align]: 0, zIndex: 50, minWidth: 200, maxHeight: 260, overflowY: 'auto' }}>
          {options.map(opt => {
            const checked = active.has(opt)
            const swatchStyle = swatch?.(opt)
            return (
              <div key={opt} onClick={() => onToggle(opt)} className={checked ? 'menu-item is-selected' : 'menu-item'}>
                {swatchStyle && <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, ...swatchStyle }} />}
                <span style={{ flex: 1, fontWeight: checked ? 600 : 400, color: checked ? 'var(--color-accent-text)' : 'var(--color-text)' }}>{opt}</span>
                {checked && <Check size={12} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
