import { lazy, Suspense, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { setTheme, useTheme } from '../theme'

const InfoModal = lazy(() => import('./InfoModal'))

// Narrowest panel with room for the grid panel's title beside all of the header's
// buttons. Narrower panels, and mobile, gather all but Close into a menu.
const MENU_BELOW_PX = 680

// One of a panel's own header buttons: one that does something, or a link to
// a page of the site's own outside the app, e.g. the Analysis section's
export type PanelAction = { label: string } & ({ onClick: () => void; href?: never } | { href: string; onClick?: never })

// Whether the panel's header gathers its buttons into a menu, as it does on
// mobile and on panels too narrow for them (see MENU_BELOW_PX)
export function hasHeaderMenu({ isMobile = false, expanded, panelWidth }: Pick<PanelProps, 'isMobile' | 'expanded' | 'panelWidth'>) {
  return isMobile || (!expanded && panelWidth < MENU_BELOW_PX)
}

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
  // Before the buttons in the header row
  header: ReactNode
  // The panel's own buttons, before About this site
  actions?: PanelAction[]
  // The header row, for a panel that drops header content when it overflows
  headerRef?: Ref<HTMLDivElement>
  // Hidden rather than unmounted, so the panel keeps its state
  visible?: boolean
  children: ReactNode
}

// The resizable side panel that GeneratorPanel, SubstationPanel and
// GridOverviewPanel fill: a header ending in the panel's own buttons and those
// to open About this site, expand the panel over the map or close it, then
// whatever the panel puts below.
export default function Panel({ header, actions = [], headerRef, visible = true, children, onClose, panelWidth, onResizeHandleMouseDown, expanded, onExpandedChange, isMobile = false }: Props) {
  const [infoOpen, setInfoOpen] = useState(false)
  const theme = useTheme()
  const otherTheme = theme === 'dark' ? 'light' : 'dark'
  const themeLabel = otherTheme === 'dark' ? 'Dark mode' : 'Light mode'

  return (
    <div className="side-panel" style={{ display: visible ? undefined : 'none', width: expanded ? '100vw' : panelWidth }}>
      <div ref={headerRef} className="section section--header" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {header}
        {hasHeaderMenu({ isMobile, expanded, panelWidth }) ? (
          <MenuTrigger>
            <Button className="button-secondary" style={isMobile ? { padding: 'var(--space-sm) var(--space-lg)' } : undefined} aria-label="More">
              <DotsIcon />
            </Button>
            <Popover placement="bottom end" offset={4} className="popover">
              <Menu aria-label="More" className="menu">
                {actions.map(a => (
                  <MenuItem key={a.label} href={a.href} onAction={a.onClick} className="menu-item">{a.label}</MenuItem>
                ))}
                <MenuItem onAction={() => setTheme(otherTheme)} className="menu-item">{themeLabel}</MenuItem>
                <MenuItem onAction={() => setInfoOpen(true)} className="menu-item">About this site</MenuItem>
                {!isMobile && <MenuItem onAction={() => onExpandedChange(true)} className="menu-item">Expand</MenuItem>}
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : (
          <>
            {actions.map(a => a.href ? (
              <a key={a.label} href={a.href} className="button-secondary">
                {a.label}
              </a>
            ) : (
              <button key={a.label} onClick={a.onClick} className="button-secondary">
                {a.label}
              </button>
            ))}
            <button onClick={() => setTheme(otherTheme)} className="button-secondary" aria-label={themeLabel} title={themeLabel}>
              {otherTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
            </button>
            <button onClick={() => setInfoOpen(true)} className="button-secondary" aria-label="About this site">
              About this site
            </button>
            <button onClick={() => onExpandedChange(!expanded)} className="button-secondary" aria-label={expanded ? 'Collapse' : 'Expand'}>
              {expanded ? 'Show map' : 'Expand'}
            </button>
          </>
        )}
        {/* On mobile the panel is always expanded (see App), so closing it is the way back to the map */}
        {isMobile ? (
          <button onClick={onClose} className="button-secondary" style={{ padding: 'var(--space-sm) var(--space-lg)' }} aria-label="Show map">
            Show map
          </button>
        ) : !expanded && (
          <button onClick={onClose} className="button-secondary" aria-label="Close">
            Close
          </button>
        )}
      </div>
      <Suspense fallback={null}>
        {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
      </Suspense>
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

// The theme toggle's icons, for the theme it switches to
function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M11.5 8.2A5 5 0 0 1 4.8 1.5a5 5 0 1 0 6.7 6.7Z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="6.5" cy="6.5" r="2.3" fill="currentColor" stroke="none" />
      <path d="M6.5 0.9v1.3M6.5 10.8v1.3M0.9 6.5h1.3M10.8 6.5h1.3M2.54 2.54l.92.92M9.54 9.54l.92.92M2.54 10.46l.92-.92M9.54 3.46l.92-.92" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="2" cy="6.5" r="1.25" />
      <circle cx="6.5" cy="6.5" r="1.25" />
      <circle cx="11" cy="6.5" r="1.25" />
    </svg>
  )
}
