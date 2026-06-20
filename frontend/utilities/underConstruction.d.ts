export interface UnderConstructionNode {
  name: string
  locationDescription?: string
  site?: string
  fuel: string
  operator: string
  status: string
  capacityMW?: number
  capacityMWp?: number
  capacityMWh?: number
  location?: { lat: number; long: number }
}

export declare const underConstruction: UnderConstructionNode[]
