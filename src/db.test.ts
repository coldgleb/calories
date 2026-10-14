import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addEntry, db, exportData, importData, saveProduct, saveRecipe } from './db'

const chicken = { name: 'Курица', kcal: 113, protein: 23.6, fat: 1.9, carbs: 0.4 }
const rice = { name: 'Рис', kcal: 344, protein: 6.7, fat: 0.7, carbs: 78.9 }

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('recipes', () => {
  it('stores a recipe as a searchable product', async () => {
    const c = await saveProduct(chicken)
    const r = await saveProduct(rice)
    const id = await saveRecipe('Курица с рисом', [{ productId: c, grams: 500 }, { productId: r, grams: 200 }], 900)
    const recipe = await db.recipes.get(id)
    const product = await db.products.get(recipe!.productId)
    expect(product!.kind).toBe('recipe')
    expect(product!.recipeId).toBe(id)
    expect(product!.kcal).toBeCloseTo(1253 / 9)
  })

  it('recalculates a recipe when an ingredient changes', async () => {
    const c = await saveProduct(chicken)
    const id = await saveRecipe('Курица', [{ productId: c, grams: 500 }], 400)
    await saveProduct({ ...chicken, kcal: 120 }, c)
    const recipe = await db.recipes.get(id)
    expect((await db.products.get(recipe!.productId))!.kcal).toBeCloseTo(150)
  })
})

describe('entries', () => {
  it('keeps a snapshot so later edits do not change history', async () => {
    const c = await saveProduct(chicken)
    await addEntry((await db.products.get(c))!, 200, '2026-10-14')
    await saveProduct({ ...chicken, kcal: 999 }, c)
    const [entry] = await db.entries.toArray()
    expect(entry.per100g.kcal).toBe(113)
    expect((await db.products.get(c))!.usageCount).toBe(1)
  })
})

describe('backup', () => {
  it('round-trips through export and import', async () => {
    const c = await saveProduct(chicken)
    await addEntry((await db.products.get(c))!, 150, '2026-10-14')
    const dump = JSON.parse(JSON.stringify(await exportData()))
    await Promise.all(db.tables.map((t) => t.clear()))
    await importData(dump)
    expect(await db.products.count()).toBe(1)
    expect((await db.entries.toArray())[0].grams).toBe(150)
  })

  it('rejects foreign files', async () => {
    await expect(importData({ foo: 1 })).rejects.toThrow()
  })
})
