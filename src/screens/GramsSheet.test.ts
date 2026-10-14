import { describe, expect, it } from 'vitest'
import { amountLabel, portionWord } from './GramsSheet'

describe('portion labels', () => {
  it('declines «порция»', () => {
    expect([1, 2, 5, 11, 21, 22, 1.5].map(portionWord)).toEqual([
      'порция', 'порции', 'порций', 'порций', 'порция', 'порции', 'порции',
    ])
  })

  it('formats amounts', () => {
    expect(amountLabel({ grams: 250 })).toBe('250 г')
    expect(amountLabel({ grams: 80, portions: 2, portionGrams: 40 })).toBe('2 порции · 80 г')
    expect(amountLabel({ grams: 50, portions: 0.5, portionOnly: true })).toBe('½ порции')
  })
})
