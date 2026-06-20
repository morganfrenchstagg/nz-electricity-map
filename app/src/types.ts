export interface Unit {
  name: string
  unitCode: string
  node: string
  capacity: number
  fuel: string
  fuelCode: string
  active?: boolean
  installedCapacity?: number
  outageBlock?: string
}

export interface Generator {
  site: string
  name: string
  units: Unit[]
  location: { lat: number; long: number }
  gridZone: string
  island: 'NI' | 'SI'
  operator: string
  secondaryOperator?: string
  scheme?: string
  alias?: string
}

export interface Substation {
  siteId: string
  description: string
  lat: number
  long: number
  type: 'ACSTN' | 'TEE'
  gridZone: number
  island: 'north' | 'south'
}

export interface DefinitionsResponse {
  generators: Generator[]
  substations: Substation[]
}

export interface RecentData {
  series: string[]
  data: (string | number)[][]
}

export type SelectedNode =
  | { kind: 'generator'; generator: Generator }
  | { kind: 'substation'; substation: Substation }
  | null
