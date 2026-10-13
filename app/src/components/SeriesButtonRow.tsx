import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

const GAP = 6

// A series toggle button: filled with the series colour when it's showing
export function seriesButtonStyle(colour: string, active: boolean): React.CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 12,
    border: `1.5px solid ${colour}`,
    background: active ? colour : 'transparent',
    color: active ? 'white' : colour,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  }
}

const MORE_STYLE: React.CSSProperties = { ...seriesButtonStyle('#bbb', false), color: '#666', flexShrink: 0 }

// Deselects every series in a row, or selects them all again once cleared
export function ClearButton({ cleared, onClick }: { cleared: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...MORE_STYLE, whiteSpace: 'nowrap' }}>
      {cleared ? 'Select all' : 'Clear'}
    </button>
  )
}

interface Props {
  // Always shown, at the start of the row
  lead?: ReactElement[]
  // As many as fit on one line after the lead; the rest collapse behind "+N more"
  items: ReactElement[]
  // Always shown, at the end of the row (after "+N more")
  trail?: ReactElement[]
}

// A row of series buttons that never overflows its width: whatever doesn't fit
// on one line goes behind a "+N more" button, which expands the row to wrap.
export default function SeriesButtonRow({ lead = [], items, trail = [] }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fitCount, setFitCount] = useState(items.length)
  const [expanded, setExpanded] = useState(false)

  // Fits items against the hidden copy's natural widths, leaving room for
  // "+N more" when some don't fit. Re-run after every render (labels change
  // width, e.g. Hide/Show generators) and whenever the row resizes.
  const updateFitRef = useRef(() => {})
  useLayoutEffect(() => {
    updateFitRef.current = () => {
      const row = rowRef.current
      const measure = measureRef.current
      if (!row || !measure) return
      const widths = [...measure.children].map((el) => el.getBoundingClientRect().width)
      const moreWidth = widths.pop() ?? 0
      const leadWidths = widths.slice(0, lead.length)
      const itemWidths = widths.slice(lead.length, lead.length + items.length)
      const trailWidths = widths.slice(lead.length + items.length)
      const lineWidth = (ws: number[]) => ws.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, ws.length - 1)
      const available = row.getBoundingClientRect().width
      let count = itemWidths.length
      while (count > 0 && lineWidth([...leadWidths, ...itemWidths.slice(0, count), ...(count < itemWidths.length ? [moreWidth] : []), ...trailWidths]) > available) count--
      setFitCount(count)
    }
    updateFitRef.current()
  })
  useEffect(() => {
    const observer = new ResizeObserver(() => updateFitRef.current())
    if (rowRef.current) observer.observe(rowRef.current)
    return () => observer.disconnect()
  }, [])

  const hiddenCount = items.length - fitCount
  return (
    <div ref={rowRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: GAP }}>
      {lead}
      {expanded || hiddenCount <= 0 ? items : items.slice(0, fitCount)}
      {hiddenCount > 0 && (
        <button onClick={() => setExpanded(v => !v)} style={MORE_STYLE}>
          {expanded ? 'Show fewer ▲' : `+${hiddenCount} more ▼`}
        </button>
      )}
      {trail}
      {/* Zero-size, clipped copy of every button at its natural width, for measuring */}
      <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden' }}>
        <div ref={measureRef} style={{ display: 'flex', alignItems: 'center', gap: GAP, width: 'max-content' }}>
          {lead}
          {items}
          {trail}
          <button style={MORE_STYLE}>{`+${items.length} more ▼`}</button>
        </div>
      </div>
    </div>
  )
}
