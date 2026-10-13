import type { ReactNode, Ref } from 'react'

// What App passes each panel for the frame it sits in
export interface PanelProps {
  onClose: () => void
  panelWidth: number
  onResizeHandleMouseDown: (e: React.MouseEvent) => void
  expanded: boolean
  onExpandedChange: (v: boolean) => void
  isMobile?: boolean
}

interface Props extends PanelProps {
  // Before the Expand and Close buttons in the header row
  header: ReactNode
  // The header row, for a panel that drops header content when it overflows
  headerRef?: Ref<HTMLDivElement>
  // Hidden rather than unmounted, so the panel keeps its state
  visible?: boolean
  children: ReactNode
}

// The resizable side panel that NodePanel and GridOverviewPanel fill: a
// header ending in the buttons to expand it over the map or close it, then
// whatever the panel puts below.
export default function Panel({ header, headerRef, visible = true, children, onClose, panelWidth, onResizeHandleMouseDown, expanded, onExpandedChange, isMobile = false }: Props) {
  return (
    <div className="side-panel" style={{ display: visible ? undefined : 'none', width: expanded ? '100vw' : panelWidth }}>
      <div ref={headerRef} className="section section--header" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {header}
        {/* On mobile the panel is always expanded (see App), so closing it is the way back to the map */}
        {isMobile ? (
          <button onClick={onClose} className="button-secondary" style={{ padding: 'var(--space-sm) var(--space-lg)' }} aria-label="Show map">
            Show map
          </button>
        ) : (
          <>
            <button onClick={() => onExpandedChange(!expanded)} className="button-secondary" aria-label={expanded ? 'Collapse' : 'Expand'}>
              {expanded ? 'Show map' : 'Expand'}
            </button>
            {!expanded && (
              <button onClick={onClose} className="button-secondary" aria-label="Close">
                Close
              </button>
            )}
          </>
        )}
      </div>
      {children}
      {!expanded && !isMobile && (
        <div
          onMouseDown={onResizeHandleMouseDown}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 20 }}
        />
      )}
    </div>
  )
}

// The row of controls under the header. When it's too narrow for one line
// (see useCompactWhenOverflowing, which measures it through toolbarRef), the
// panel switches its toggles to dropdowns and the row wraps.
export function PanelToolbar({ toolbarRef, compact, children }: { toolbarRef: Ref<HTMLDivElement>; compact: boolean; children: ReactNode }) {
  return (
    <div ref={toolbarRef} className="section section--toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: compact ? 'wrap' : 'nowrap' }}>
      {children}
    </div>
  )
}
