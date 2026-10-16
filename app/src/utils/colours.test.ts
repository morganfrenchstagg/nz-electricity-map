import { describe, expect, it } from 'vitest'
import { fuelCodeColour, fuelCodeLabel, fuelColour, fuelFamilies, RENEWABLE_FUEL_CODES } from './colours'

describe('biomass', () => {
  it('is labelled and coloured by its code and its fuel name alike', () => {
    expect(fuelCodeLabel('BIO')).toBe('Biomass')
    expect(fuelColour('Biomass')).toBe(fuelCodeColour('BIO'))
    expect(fuelColour('Biomass')).not.toBe(fuelColour('Unknown'))
  })

  it('sorts between coal/gas and geothermal', () => {
    expect(fuelFamilies(['Geothermal', 'Biomass', 'Coal/Gas', 'Hydro']).map((f) => f.label))
      .toEqual(['Hydro', 'Coal/Gas', 'Biomass', 'Geothermal'])
  })
})

describe('RENEWABLE_FUEL_CODES', () => {
  it('counts biomass and battery discharge, not thermal fuels or charging', () => {
    expect([...RENEWABLE_FUEL_CODES].sort()).toEqual(['BESS', 'BIO', 'GEO', 'HYD', 'SOL', 'WIN'])
  })
})
