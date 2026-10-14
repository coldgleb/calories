import { describe, expect, it } from 'vitest'
import { bmr, forGrams, portionToPer100, recipePer100, sum, targets, type Profile } from './calc'

const chicken = { kcal: 113, protein: 23.6, fat: 1.9, carbs: 0.4 }
const rice = { kcal: 344, protein: 6.7, fat: 0.7, carbs: 78.9 }

describe('forGrams', () => {
  it('scales per-100 g values', () => {
    expect(forGrams(chicken, 250).kcal).toBeCloseTo(282.5)
    expect(forGrams(chicken, 250).protein).toBeCloseTo(59)
  })
})

describe('recipePer100', () => {
  const ingredients = [
    { per100g: chicken, grams: 500 },
    { per100g: rice, grams: 200 },
  ]

  it('divides by cooked weight', () => {
    // 565 + 688 = 1253 kcal in 900 g of finished dish
    const r = recipePer100(ingredients, 900)
    expect(r.kcal).toBeCloseTo(1253 / 9)
    expect(r.protein).toBeCloseTo((118 + 13.4) / 9)
  })

  it('falls back to raw weight without cooked weight', () => {
    expect(recipePer100(ingredients).kcal).toBeCloseTo(1253 / 7)
    expect(recipePer100(ingredients, 0).kcal).toBeCloseTo(1253 / 7)
  })

  it('handles an empty recipe', () => {
    expect(recipePer100([]).kcal).toBe(0)
  })
})

describe('portionToPer100', () => {
  it('converts a 40 g bar label', () => {
    expect(portionToPer100({ kcal: 180, protein: 8, fat: 6, carbs: 22 }, 40).kcal).toBeCloseTo(450)
  })
})

describe('sum', () => {
  it('adds up entries', () => {
    expect(sum([chicken, rice]).kcal).toBeCloseTo(457)
  })
})

describe('targets', () => {
  const man: Profile = { sex: 'male', age: 30, heightCm: 180, weightKg: 90, activity: 1.375, deficit: 0.2 }

  it('computes Mifflin–St Jeor BMR', () => {
    expect(bmr(man)).toBe(900 + 1125 - 150 + 5)
  })

  it('applies activity and deficit', () => {
    const t = targets(man)
    expect(t.kcal).toBe(Math.round(1880 * 1.375 * 0.8))
    expect(t.protein).toBe(144)
    expect(t.fat).toBe(72)
    expect(t.carbs).toBe(Math.round((t.kcal - 144 * 4 - 72 * 9) / 4))
    expect(t.clamped).toBe(false)
  })

  it('does not go below the safe minimum', () => {
    const t = targets({ sex: 'female', age: 60, heightCm: 150, weightKg: 45, activity: 1.2, deficit: 0.4 })
    expect(t.kcal).toBe(1200)
    expect(t.clamped).toBe(true)
  })
})
