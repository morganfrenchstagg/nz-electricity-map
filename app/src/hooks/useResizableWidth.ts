import { useState, useCallback } from 'react'

const MIN_PX = 300
const MAX_OFFSET_PX = 50

export function useResizableWidth(defaultPx: number, onResizeEnd?: () => void) {
  const [width, setWidth] = useState(defaultPx)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    const onMove = (ev: MouseEvent) => {
      setWidth(Math.max(MIN_PX, Math.min(window.innerWidth - MAX_OFFSET_PX, ev.clientX)))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      onResizeEnd?.()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [onResizeEnd])

  return { width, onMouseDown }
}
