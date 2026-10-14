import { describe, expect, it } from 'vitest'
import { splitBrand } from './ProductForm'

describe('splitBrand', () => {
  it('splits a trailing «brand»', () => {
    expect(splitBrand('Творог 5%, «Простоквашино»')).toEqual({ name: 'Творог 5%', brand: 'Простоквашино' })
    expect(splitBrand('Кефир «Домик в деревне»')).toEqual({ name: 'Кефир', brand: 'Домик в деревне' })
  })

  it('leaves other names alone', () => {
    expect(splitBrand('Куриное филе')).toEqual({ name: 'Куриное филе' })
    expect(splitBrand('«Пятёрочка»')).toEqual({ name: '«Пятёрочка»' })
  })
})
