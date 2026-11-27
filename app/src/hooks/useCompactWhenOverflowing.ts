import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// For a single-line toolbar with a compact fallback (dropdowns for segmented buttons): true once
// the full layout overflows, false once there's room again. Measures the toolbar, not the
// viewport, as the panels are resizable.
export function useCompactWhenOverflowing<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [compact, setCompact] = useState(false)
  // Width the full layout needed when it last overflowed
  const fullWidth = useRef(0)

  const check = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { left, width } = el.getBoundingClientRect()
    if (!compact) {
      // Measured from the children, as scrollWidth leaves out the right padding
      const childrenRight = Math.max(left, ...Array.from(el.children, (c) => c.getBoundingClientRect().right))
      const neededWidth = childrenRight - left + parseFloat(getComputedStyle(el).paddingRight)
      // Half a pixel's slack for subpixel rounding
      if (neededWidth > width + 0.5) {
        fullWidth.current = neededWidth
        setCompact(true)
      }
    } else if (width + 0.5 >= fullWidth.current) {
      setCompact(false)
    }
  }, [compact])

  // After every render, as the contents change (loading text, offers mode)
  useLayoutEffect(check)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [check])

  return [ref, compact] as const
}
