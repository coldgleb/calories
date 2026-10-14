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
    const id = await saveRecipe({ name: 'Курица с рисом', ingredients: [{ productId: c, grams: 500 }, { productId: r, grams: 200 }], cookedWeight: 900 })
    const recipe = await db.recipes.get(id)
    const product = await db.products.get(recipe!.productId)
    expect(product!.kind).toBe('recipe')
    expect(product!.recipeId).toBe(id)
    expect(product!.kcal).toBeCloseTo(1253 / 9)
  })

  it('recalculates a recipe when an ingredient changes', async () => {
    const c = await saveProduct(chicken)
    const id = await saveRecipe({ name: 'Курица', ingredients: [{ productId: c, grams: 500 }], cookedWeight: 400, portions: 4 })
    await saveProduct({ ...chicken, kcal: 120 }, c)
    const recipe = await db.recipes.get(id)
    const product = (await db.products.get(recipe!.productId))!
    expect(product.kcal).toBeCloseTo(150)
    expect(product.portionGrams).toBe(100)
  })
})

describe('entries', () => {
  it('keeps a snapshot so later edits do not change history', async () => {
    const c = await saveProduct(chicken)
    await addEntry((await db.products.get(c))!, { grams: 200 }, '2026-10-14')
    await saveProduct({ ...chicken, kcal: 999 }, c)
    const [entry] = await db.entries.toArray()
    expect(entry.per100g.kcal).toBe(113)
    expect((await db.products.get(c))!.usageCount).toBe(1)
  })
})

describe('backup', () => {
  it('round-trips through export and import', async () => {
    const c = await saveProduct(chicken)
    await addEntry((await db.products.get(c))!, { grams: 150 }, '2026-10-14')
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

describe('fromLabel', () => {
  it('keeps per-100 g values and the optional portion weight', async () => {
    const { fromLabel } = await import('./db')
    expect(fromLabel('per100', { kcal: 450, protein: 8, fat: 20, carbs: 55 }, 40)).toMatchObject({ kcal: 450, portionGrams: 40 })
  })

  it('converts per-portion values when the weight is known', async () => {
    const { fromLabel } = await import('./db')
    const r = fromLabel('portion', { kcal: 180, protein: 8, fat: 6, carbs: 22 }, 40)
    expect(r.kcal).toBeCloseTo(450)
    expect(r.portionGrams).toBe(40)
    expect(r.portionOnly).toBeUndefined()
  })

  it('stores per-portion values as is without the weight', async () => {
    const { fromLabel } = await import('./db')
    expect(fromLabel('portion', { kcal: 620, protein: 30, fat: 25, carbs: 60 })).toMatchObject({ kcal: 620, portionOnly: true })
  })

  it('logs a portion-only meal as portions', async () => {
    const id = await saveProduct({ name: 'Ланч', kcal: 620, protein: 30, fat: 25, carbs: 60, portionOnly: true })
    await addEntry((await db.products.get(id))!, { grams: 150, portions: 1.5 }, '2026-10-14')
    const [e] = await db.entries.toArray()
    expect(e.portionOnly).toBe(true)
    expect(e.portions).toBe(1.5)
    const { forGrams } = await import('./calc')
    expect(forGrams(e.per100g, e.grams).kcal).toBe(930)
  })
})

describe('recipe portions', () => {
  it('splits the cooked weight, or the raw weight without it', async () => {
    const { recipePortionGrams } = await import('./db')
    const ing = [{ productId: 1, grams: 500 }, { productId: 2, grams: 200 }]
    expect(recipePortionGrams(ing, 900, 4)).toBe(225)
    expect(recipePortionGrams(ing, undefined, 2)).toBe(350)
    expect(recipePortionGrams(ing, 900)).toBeUndefined()
  })

  it('removes the portion when the count is cleared', async () => {
    const c = await saveProduct(chicken)
    const id = await saveRecipe({ name: 'Суп', ingredients: [{ productId: c, grams: 400 }], portions: 4 })
    await saveRecipe({ name: 'Суп', ingredients: [{ productId: c, grams: 400 }] }, id)
    const recipe = await db.recipes.get(id)
    expect((await db.products.get(recipe!.productId))!.portionGrams).toBeUndefined()
  })
})
