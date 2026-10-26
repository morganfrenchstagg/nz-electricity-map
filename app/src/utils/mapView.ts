// Mainland NZ and Stewart Island as [west, south, east, north], leaving off the Chathams
const NZ_BOUNDS = [166.4, -47.3, 178.6, -34.3] as const
// How much of the window's height NZ takes up. Its sides touch the panel and the right of
// the window, which only Fiordland and East Cape reach.
const HEIGHT_SHARE = 0.8
// The narrowest the panel starts, and the furthest out the map zooms to fit NZ beside it.
// A viewport without room for both keeps the default layout.
const MIN_PANEL_PX = 480
const MIN_ZOOM = 4.25
// MapLibre's world is one 512px tile at zoom 0
const TILE_PX = 512

// Web Mercator y of a latitude, in tiles at zoom 0, and back
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const latitude = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(2 * Math.PI * y)) - 90

export interface InitialView {
  panelWidth: number
  // Of the map beside the panel
  center: [number, number]
  zoom: number
}

// The widest the side panel can start with all of NZ in view on the map beside it, at the
// zoom where NZ takes up HEIGHT_SHARE of the map's height (or fits the room beside the
// narrowest panel, on a tall, narrow viewport). Null when the viewport is too small for both.
export function viewBesideNz(viewportWidth: number, viewportHeight: number): InitialView | null {
  const [west, south, east, north] = NZ_BOUNDS
  const [southY, northY] = [mercatorY(south), mercatorY(north)]
  // NZ's size in px at zoom 0
  const nzWidth = ((east - west) / 360) * TILE_PX
  const nzHeight = (northY - southY) * TILE_PX

  const zoom = Math.min(
    Math.log2((viewportHeight * HEIGHT_SHARE) / nzHeight),
    Math.log2((viewportWidth - MIN_PANEL_PX) / nzWidth),
  )
  // NaN too, when there's no room at all
  if (!(zoom >= MIN_ZOOM)) return null

  return {
    panelWidth: Math.round(viewportWidth - nzWidth * 2 ** zoom),
    center: [(west + east) / 2, latitude((southY + northY) / 2)],
    zoom,
  }
}
