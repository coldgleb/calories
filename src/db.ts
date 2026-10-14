import Dexie, { liveQuery, type EntityTable } from 'dexie'
import { useEffect, useState } from 'preact/hooks'
import { portionToPer100, recipePer100, targets, type Nutrition, type Profile, type Targets } from './calc'

export interface Product extends Nutrition {
  id: number
  name: string
  /** Values are per 100 g (per portion when `portionOnly`). Recipes are stored as products too. */
  kind: 'product' | 'recipe'
  recipeId?: number
  barcode?: string
  /** Weight of one portion, when the label gives it. */
  portionGrams?: number
  /** The label only gives values per portion, without its weight. */
  portionOnly?: boolean
  usageCount: number
  lastUsedAt: number
}

export interface RecipeIngredient {
  productId: number
  grams: number
}

export interface Recipe {
  id: number
  name: string
  ingredients: RecipeIngredient[]
  cookedWeight?: number
  /** How many portions the dish is split into. */
  portions?: number
  productId: number
}

export interface Entry {
  id: number
  /** Local date, YYYY-MM-DD. */
  date: string
  productId: number
  name: string
  /** Snapshot of the product's per-100 g values when it was eaten. */
  per100g: Nutrition
  grams: number
  /** Set when the amount was entered in portions. */
  portions?: number
  portionGrams?: number
  /** `per100g` holds per-portion values and `grams` is portions × 100. */
  portionOnly?: boolean
  createdAt: number
}

/** How much was eaten. For portion-only foods `grams` is portions × 100. */
export interface Amount {
  grams: number
  portions?: number
}

export interface PortionInfo {
  portionGrams?: number
  portionOnly?: boolean
}

export type LabelBasis = 'per100' | 'portion'

/**
 * Turns label values into what we store: per-100 g values plus the portion weight,
 * or — when the label gives values per portion but not its weight — per-portion values.
 */
export function fromLabel(basis: LabelBasis, values: Nutrition, portionGrams?: number): Nutrition & PortionInfo {
  const g = portionGrams && portionGrams > 0 ? portionGrams : undefined
  if (basis === 'per100') return { ...values, portionGrams: g, portionOnly: undefined }
  if (g) return { ...portionToPer100(values, g), portionGrams: g, portionOnly: undefined }
  return { ...values, portionGrams: undefined, portionOnly: true }
}

/** Grams one portion stands for in calculations, if the food has portions. */
export function portionUnit(p: PortionInfo): number | undefined {
  return p.portionOnly ? 100 : p.portionGrams
}

export interface Settings {
  key: 'main'
  profile?: Profile
  /** Manual overrides of the computed targets. */
  override?: Partial<Nutrition>
}

export interface WeightLog {
  date: string
  weightKg: number
}

export const db = new Dexie('calories') as Dexie & {
  products: EntityTable<Product, 'id'>
  recipes: EntityTable<Recipe, 'id'>
  entries: EntityTable<Entry, 'id'>
  settings: EntityTable<Settings, 'key'>
  weights: EntityTable<WeightLog, 'date'>
}

db.version(1).stores({
  products: '++id, name, kind, lastUsedAt, usageCount',
  recipes: '++id, name, productId',
  entries: '++id, date, productId',
  settings: 'key',
  weights: 'date',
})

db.version(2).stores({
  products: '++id, name, kind, lastUsedAt, usageCount, barcode',
})

export function useLive<T>(query: () => T | Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: console.error })
    return () => sub.unsubscribe()
  }, deps)
  return value
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return todayISO(new Date(y, m - 1, d + days))
}

export function nutritionOf(p: Nutrition): Nutrition {
  return { kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs }
}

export async function addEntry(product: Product, amount: Amount, date: string) {
  const now = Date.now()
  await db.transaction('rw', db.entries, db.products, async () => {
    await db.entries.add(entryFor(product, amount, date, now))
    await db.products.update(product.id, { usageCount: product.usageCount + 1, lastUsedAt: now })
  })
}

/** A diary entry for food that isn't (or isn't yet) in the product list; `productId` 0 means ad hoc. */
export function entryFor(
  food: Nutrition & PortionInfo & { name: string; id?: number },
  amount: Amount,
  date: string,
  now = Date.now(),
): Entry {
  return {
    date,
    productId: food.id ?? 0,
    name: food.name,
    per100g: nutritionOf(food),
    grams: amount.grams,
    portions: amount.portions,
    portionGrams: food.portionGrams,
    portionOnly: food.portionOnly || undefined,
    createdAt: now,
  } as Entry
}

export async function saveProduct(data: Omit<Product, 'id' | 'usageCount' | 'lastUsedAt' | 'kind'>, id?: number) {
  if (id) {
    await db.transaction('rw', db.products, db.recipes, async () => {
      await db.products.update(id, data)
      await recalcRecipesUsing(id)
    })
    return id
  }
  return db.products.add({ ...data, kind: 'product', usageCount: 0, lastUsedAt: 0 } as Product)
}

export async function recipesUsing(productId: number): Promise<Recipe[]> {
  const all = await db.recipes.toArray()
  return all.filter((r) => r.ingredients.some((i) => i.productId === productId))
}

async function recalcRecipesUsing(productId: number) {
  for (const r of await recipesUsing(productId)) {
    await db.products.update(r.productId, await computeRecipe(r.ingredients, r.cookedWeight))
  }
}

export async function computeRecipe(ingredients: RecipeIngredient[], cookedWeight?: number): Promise<Nutrition> {
  const products = await db.products.bulkGet(ingredients.map((i) => i.productId))
  return recipePer100(
    ingredients.flatMap((i, idx) => {
      const p = products[idx]
      return p ? [{ per100g: nutritionOf(p), grams: i.grams }] : []
    }),
    cookedWeight,
  )
}

/** Weight of one portion: the finished dish (or raw ingredients) split evenly. */
export function recipePortionGrams(ingredients: RecipeIngredient[], cookedWeight?: number, portions?: number): number | undefined {
  if (!portions || portions <= 0) return undefined
  const weight = cookedWeight && cookedWeight > 0 ? cookedWeight : ingredients.reduce((w, i) => w + i.grams, 0)
  return weight > 0 ? weight / portions : undefined
}

export async function saveRecipe(
  r: { name: string; ingredients: RecipeIngredient[]; cookedWeight?: number; portions?: number },
  id?: number,
) {
  const { name, ingredients, cookedWeight, portions } = r
  const values = {
    ...(await computeRecipe(ingredients, cookedWeight)),
    portionGrams: recipePortionGrams(ingredients, cookedWeight, portions),
  }
  return db.transaction('rw', db.products, db.recipes, async () => {
    if (id) {
      const recipe = await db.recipes.get(id)
      if (!recipe) throw new Error('Рецепт не найден')
      await db.recipes.update(id, { name, ingredients, cookedWeight, portions })
      await db.products.update(recipe.productId, { name, ...values })
      return id
    }
    const productId = await db.products.add({ name, ...values, kind: 'recipe', usageCount: 0, lastUsedAt: Date.now() } as Product)
    const recipeId = await db.recipes.add({ name, ingredients, cookedWeight, portions, productId } as Recipe)
    await db.products.update(productId, { recipeId })
    return recipeId
  })
}

export async function deleteRecipe(id: number) {
  await db.transaction('rw', db.products, db.recipes, async () => {
    const recipe = await db.recipes.get(id)
    if (!recipe) return
    await db.recipes.delete(id)
    await db.products.delete(recipe.productId)
  })
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('main')) ?? { key: 'main' }
}

export function effectiveTargets(s: Settings | undefined): Targets | undefined {
  const base = s?.profile ? targets(s.profile) : undefined
  const o = s?.override ?? {}
  if (!base && o.kcal == null) return undefined
  return {
    kcal: o.kcal ?? base?.kcal ?? 0,
    protein: o.protein ?? base?.protein ?? 0,
    fat: o.fat ?? base?.fat ?? 0,
    carbs: o.carbs ?? base?.carbs ?? 0,
    clamped: base?.clamped ?? false,
  }
}

const TABLES = ['products', 'recipes', 'entries', 'settings', 'weights'] as const

export async function exportData() {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  return { app: 'calories', version: 1, exportedAt: new Date().toISOString(), data }
}

export async function importData(json: unknown) {
  const file = json as { app?: string; data?: Record<string, unknown[]> }
  if (file?.app !== 'calories' || !file.data) throw new Error('Это не файл резервной копии приложения')
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(file.data![t] ?? [])
    }
  })
}
