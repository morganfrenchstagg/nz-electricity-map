export interface UnderConstructionNode {
  name: string
  locationDescription?: string
  site?: string
  fuel: string
  operator: string
  status: string
  capacityMW?: number
  location?: { lat: number; long: number }
}

export declare const underConstruction: UnderConstructionNode[]
