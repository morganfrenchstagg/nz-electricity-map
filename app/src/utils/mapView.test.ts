import { describe, expect, it } from 'vitest'
import { viewBesideNz } from './mapView'
import type { InitialView } from './mapView'

// Cape Reinga, East Cape, West Cape and South Cape (Stewart Island)
const EAST_CAPE: [number, number] = [178.55, -37.69]
const WEST_CAPE: [number, number] = [166.43, -45.86]
const NZ_EXTREMES: [number, number][] = [[172.68, -34.43], EAST_CAPE, WEST_CAPE, [167.55, -47.29]]

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)

// Where a point lands on screen with the map's centre in the middle of the room beside the panel
function onScreen([lng, lat]: [number, number], { panelWidth, center, zoom }: InitialView, width: number, height: number) {
  const worldPx = 512 * 2 ** zoom
  return {
    x: panelWidth + (width - panelWidth) / 2 + ((lng - center[0]) / 360) * worldPx,
    y: height / 2 + (mercatorY(center[1]) - mercatorY(lat)) * worldPx,
  }
}

function expectNzInView(width: number, height: number) {
  const view = viewBesideNz(width, height)!
  for (const point of NZ_EXTREMES) {
    const { x, y } = onScreen(point, view, width, height)
    expect(x).toBeGreaterThan(view.panelWidth)
    expect(x).toBeLessThan(width)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(height)
  }
  // Fiordland touches the panel's edge, and East Cape the right of the window
  expect(onScreen(WEST_CAPE, view, width, height).x - view.panelWidth).toBeLessThan(4)
  expect(width - onScreen(EAST_CAPE, view, width, height).x).toBeLessThan(4)
  return view
}

describe('viewBesideNz', () => {
  it('leaves the map just wide enough for all of NZ at the zoom where it takes up 65% of the height', () => {
    // A 13" laptop, where the default 60% panel would cut off the top and bottom of NZ at zoom 5
    const laptop = expectNzInView(1440, 820)
    expect(laptop.zoom).toBeLessThan(5)
    expect(laptop.panelWidth).toBe(1063)
    // A larger screen zooms in and still gives the rest to the panel
    const monitor = expectNzInView(2560, 1300)
    expect(monitor.zoom).toBeGreaterThan(5)
    expect(monitor.panelWidth).toBe(1963)
  })

  it('zooms out to fit NZ beside the narrowest panel on a tall, narrow viewport', () => {
    expect(expectNzInView(1080, 1800).panelWidth).toBe(480)
    expect(expectNzInView(770, 800).panelWidth).toBe(480)
  })

  it('has no view for a viewport too small for both', () => {
    expect(viewBesideNz(750, 800)).toBeNull()
    expect(viewBesideNz(1440, 500)).toBeNull()
    expect(viewBesideNz(300, 40)).toBeNull()
  })
})
