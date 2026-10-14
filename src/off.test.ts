import { describe, expect, it } from 'vitest'
import { parseOff } from './off'
import { niceTicks } from './screens/WeightChart'

describe('parseOff', () => {
  it('reads per-100 g values and prefers the Russian name', () => {
    const p = parseOff({
      status: 1,
      product: {
        product_name: 'Cottage cheese',
        product_name_ru: 'Творог 5%',
        brands: 'Простоквашино, Danone',
        nutriments: { 'energy-kcal_100g': 121, proteins_100g: 17, fat_100g: 5, carbohydrates_100g: '1.8' },
      },
    })
    expect(p).toEqual({ name: 'Творог 5%, «Простоквашино»', per100g: { kcal: 121, protein: 17, fat: 5, carbs: 1.8 } })
  })

  it('converts kJ when kcal is missing', () => {
    const p = parseOff({ status: 1, product: { product_name: 'X', nutriments: { energy_100g: 418.4 } } })
    expect(p!.per100g!.kcal).toBeCloseTo(100)
  })

  it('returns no values when nutriments are absent', () => {
    expect(parseOff({ status: 1, product: { product_name: 'X' } })!.per100g).toBeUndefined()
  })

  it('returns null for unknown products', () => {
    expect(parseOff({ status: 0 })).toBeNull()
  })
})

describe('niceTicks', () => {
  it('covers the range with round steps', () => {
    expect(niceTicks(88.3, 90.6)).toEqual([88, 89, 90, 91])
    expect(niceTicks(80, 80)).toEqual([79.5, 80, 80.5])
    const wide = niceTicks(70, 95)
    expect(wide[0]).toBeLessThanOrEqual(70)
    expect(wide[wide.length - 1]).toBeGreaterThanOrEqual(95)
    expect(wide.length).toBeLessThanOrEqual(6)
  })
})
