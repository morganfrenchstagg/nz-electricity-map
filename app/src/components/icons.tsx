import type { ReactNode } from 'react'

// Lines in currentColor on a 16-unit grid, 13px unless sized. Hidden from screen readers, as each
// button has its own label.
function Icon({
  size = 13,
  viewBox = '0 0 16 16',
  children,
}: {
  size?: number
  viewBox?: string
  children: ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

type Props = { size?: number }

export function ChevronDown({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  )
}

export function ChevronLeft({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </Icon>
  )
}

export function ChevronRight({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </Icon>
  )
}

export function ArrowUp({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Icon>
  )
}

export function ArrowDown({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </Icon>
  )
}

export function Close({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  )
}

export function Check({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  )
}

// A part-ticked box's mark
export function Minus({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M4 8h8" />
    </Icon>
  )
}

export function ExternalLink({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M7 3H3.5v9.5H13V9M9.5 3H13v3.5M13 3L7.5 8.5" />
    </Icon>
  )
}

// Two arrows passing, for comparing with an earlier period
export function Compare({ size }: Props) {
  return (
    <Icon size={size}>
      <path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3" />
    </Icon>
  )
}

export function CalendarIcon({ size }: Props) {
  return (
    <Icon size={size}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </Icon>
  )
}

export function Gear({ size = 14 }: Props) {
  return (
    <Icon size={size}>
      <path d="M6.51 3.12L6.72 1.12L9.28 1.12L9.49 3.12A5.1 5.1 0 0 1 10.39 3.5L11.96 2.23L13.77 4.04L12.5 5.61A5.1 5.1 0 0 1 12.88 6.51L14.88 6.72L14.88 9.28L12.88 9.49A5.1 5.1 0 0 1 12.5 10.39L13.77 11.96L11.96 13.77L10.39 12.5A5.1 5.1 0 0 1 9.49 12.88L9.28 14.88L6.72 14.88L6.51 12.88A5.1 5.1 0 0 1 5.61 12.5L4.04 13.77L2.23 11.96L3.5 10.39A5.1 5.1 0 0 1 3.12 9.49L1.12 9.28L1.12 6.72L3.12 6.51A5.1 5.1 0 0 1 3.5 5.61L2.23 4.04L4.04 2.23L5.61 3.5A5.1 5.1 0 0 1 6.51 3.12Z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  )
}

// The theme toggle's, for the theme it switches to
export function Moon({ size }: Props) {
  return (
    <Icon size={size} viewBox="0 0 13 13">
      <path d="M11.5 8.2A5 5 0 0 1 4.8 1.5a5 5 0 1 0 6.7 6.7Z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function Sun({ size }: Props) {
  return (
    <Icon size={size} viewBox="0 0 13 13">
      <circle cx="6.5" cy="6.5" r="2.3" fill="currentColor" stroke="none" />
      <path
        d="M6.5 0.9v1.3M6.5 10.8v1.3M0.9 6.5h1.3M10.8 6.5h1.3M2.54 2.54l.92.92M9.54 9.54l.92.92M2.54 10.46l.92-.92M9.54 3.46l.92-.92"
        strokeWidth="1.3"
      />
    </Icon>
  )
}

export function Dots({ size }: Props) {
  return (
    <Icon size={size} viewBox="0 0 13 13">
      <g fill="currentColor" stroke="none">
        <circle cx="2" cy="6.5" r="1.25" />
        <circle cx="6.5" cy="6.5" r="1.25" />
        <circle cx="11" cy="6.5" r="1.25" />
      </g>
    </Icon>
  )
}
