import { describe, expect, it } from 'vitest'
import type { Substation } from '../types'
import { substationsOf, substationsTitle } from './substations'

const sub = (siteId: string, description: string): Substation => ({
  siteId, description, lat: 0, long: 0, type: 'ACSTN', gridZone: 2, island: 'north',
})
const ota = sub('OTA', 'Ōtāhuhu')
const pen = sub('PEN', 'Penrose')
const mng = sub('MNG', 'Māngere')

describe('substationsOf', () => {
  it('lists one substation, or several', () => {
    expect(substationsOf({ kind: 'substation', substation: ota })).toEqual([ota])
    expect(substationsOf({ kind: 'substations', substations: [ota, pen] })).toEqual([ota, pen])
  })
})

describe('substationsTitle', () => {
  it('names one substation', () => {
    expect(substationsTitle([ota])).toBe('Ōtāhuhu Substation')
  })

  it('names both of two', () => {
    expect(substationsTitle([ota, pen])).toBe('Ōtāhuhu, Penrose Substations')
  })

  it('names the first of more, and counts the rest', () => {
    expect(substationsTitle([ota, pen, mng])).toBe('Ōtāhuhu +2 more Substations')
  })
})
