import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

describe('schema v3 migration', () => {
  it('adds sync fields and moves per-portion products to ready food', async () => {
    // A database as version 2 of the app left it.
    const old = new Dexie('calories')
    old.version(1).stores({
      products: '++id, name, kind, lastUsedAt, usageCount',
      recipes: '++id, name, productId',
      entries: '++id, date, productId',
      settings: 'key',
      weights: 'date',
    })
    old.version(2).stores({ products: '++id, name, kind, lastUsedAt, usageCount, barcode' })
    await old.open()
    await old.table('products').bulkAdd([
      { name: 'Творог', kind: 'product', kcal: 121, protein: 17, fat: 5, carbs: 2, usageCount: 0, lastUsedAt: 0 },
      { name: 'Ланч', kind: 'product', portionOnly: true, kcal: 620, protein: 30, fat: 25, carbs: 60, usageCount: 0, lastUsedAt: 0 },
    ])
    await old.table('recipes').add({ name: 'Плов', ingredients: [], productId: 1 })
    old.close()

    const { db } = await import('./db')
    const products = await db.products.orderBy('id').toArray()
    expect(products.map((p) => p.kind)).toEqual(['product', 'ready'])
    expect(new Set(products.map((p) => p.uid)).size).toBe(2)
    expect(products.every((p) => p.updatedAt > 0)).toBe(true)
    const [recipe] = await db.recipes.toArray()
    expect(recipe.uid).toMatch(/^[0-9a-f-]{36}$/)
  })
})
