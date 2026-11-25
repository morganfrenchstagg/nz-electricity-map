import { describe, expect, it } from 'vitest'
import { tipPosition } from './chartTip'

describe('tipPosition', () => {
  const viewport = { width: 400, height: 800 }
  const size = { width: 120, height: 60 }

  it('centres the tooltip over the bar', () => {
    expect(tipPosition({ left: 190, width: 20 }, 300, size, viewport)).toEqual({ left: 140, top: 232 })
  })

  it('keeps it inside the viewport beside a bar at an edge', () => {
    expect(tipPosition({ left: 0, width: 20 }, 300, size, viewport).left).toBe(8)
    expect(tipPosition({ left: 380, width: 20 }, 300, size, viewport).left).toBe(272)
  })

  it('puts it under the top of a bar with no room above', () => {
    expect(tipPosition({ left: 190, width: 20 }, 30, size, viewport).top).toBe(38)
  })
})
