import Dexie, { liveQuery, type EntityTable } from 'dexie'
import { useEffect, useState } from 'preact/hooks'
import { portionToPer100, recipePer100, targets, type Nutrition, type Profile, type Targets } from './calc'

/**
 * Products and ready food are meant to become a catalogue shared by all users once there is
 * a server; recipes stay personal. `uid` and `updatedAt` are there for that future sync —
 * local numeric ids differ between devices.
 */
export type ProductKind = 'product' | 'recipe' | 'ready'

export interface Product extends Nutrition {
  id: number
  uid: string
  updatedAt: number
  name: string
  /** Values are per 100 g (per portion when `portionOnly`). Recipes are stored as products too. */
  kind: ProductKind
  recipeId?: number
  barcode?: string
  /** Weight of one portion, when the label gives it. */
  portionGrams?: number
  /** The label only gives values per portion, without its weight. */
  portionOnly?: boolean
  /** Server user id of whoever added it to the shared catalogue; unset until signed in. */
  author?: string
  /** 1 when changed locally and not yet sent to the server. */
  dirty?: 0 | 1
  usageCount: number
  lastUsedAt: number
}

export interface RecipeIngredient {
  /** Local key; `uid` identifies the product across devices. */
  productId: number
  uid?: string
  grams: number
}

export interface Recipe {
  id: number
  uid: string
  updatedAt: number
  name: string
  ingredients: RecipeIngredient[]
  cookedWeight?: number
  /** How many portions the dish is split into. */
  portions?: number
  productId: number
  dirty?: 0 | 1
}

export interface Entry {
  id: number
  uid: string
  updatedAt: number
  dirty?: 0 | 1
  /** Local date, YYYY-MM-DD. */
  date: string
  /** Local key of the food (0 for ad hoc); `foodUid` identifies it across devices. */
  productId: number
  foodUid?: string
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
  updatedAt?: number
  dirty?: 0 | 1
}

export interface WeightLog {
  /** Also the record's uid: one weight per day. */
  date: string
  weightKg: number
  updatedAt?: number
  dirty?: 0 | 1
}

/** A local deletion still to be reported to the server. */
export interface Tombstone {
  id: number
  table: SyncedTable
  uid: string
}

export type SyncedTable = 'products' | 'recipes' | 'entries' | 'weights' | 'settings'

export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('calories') as Dexie & {
  products: EntityTable<Product, 'id'>
  recipes: EntityTable<Recipe, 'id'>
  entries: EntityTable<Entry, 'id'>
  settings: EntityTable<Settings, 'key'>
  weights: EntityTable<WeightLog, 'date'>
  tombstones: EntityTable<Tombstone, 'id'>
  meta: EntityTable<Meta, 'key'>
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

db.version(3)
  .stores({
    products: '++id, &uid, name, kind, lastUsedAt, usageCount, barcode',
    recipes: '++id, &uid, name, productId',
  })
  .upgrade(async (tx) => {
    await tx.table('products').toCollection().modify((p: Product) => fillProduct(p))
    await tx.table('recipes').toCollection().modify((r: Recipe) => fillSyncFields(r))
  })

db.version(4)
  .stores({
    products: '++id, &uid, name, kind, lastUsedAt, usageCount, barcode, dirty',
    recipes: '++id, &uid, name, productId, dirty',
    entries: '++id, &uid, date, productId, dirty',
    weights: 'date, dirty',
    settings: 'key, dirty',
    tombstones: '++id',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const uidById = new Map<number, string>()
    await tx.table('products').each((p: Product) => uidById.set(p.id, p.uid))
    await tx.table('entries').toCollection().modify((e: Entry) => fillEntry(e, uidById))
    await tx.table('recipes').toCollection().modify((r: Recipe) => fillIngredients(r, uidById))
  })

export function newUid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID needs a secure context; plain-http self-hosting still gets random ids.
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function fillSyncFields(r: { uid?: string; updatedAt?: number }) {
  r.uid ??= newUid()
  r.updatedAt ??= Date.now()
}

function fillEntry(e: Entry, uidById: Map<number, string>) {
  fillSyncFields(e)
  if (!e.foodUid && e.productId) e.foodUid = uidById.get(e.productId)
}

function fillIngredients(r: Recipe, uidById: Map<number, string>) {
  for (const i of r.ingredients) i.uid ??= uidById.get(i.productId)
}

/** Brings a product from an older version (database or backup file) up to date. */
function fillProduct(p: Product) {
  fillSyncFields(p)
  // Before the "ready food" section, ready meals were products known only per portion.
  if (p.kind === 'product' && p.portionOnly) p.kind = 'ready'
}

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
  food: Nutrition & PortionInfo & { name: string; id?: number; uid?: string },
  amount: Amount,
  date: string,
  now = Date.now(),
): Entry {
  return {
    uid: newUid(),
    updatedAt: now,
    date,
    productId: food.id ?? 0,
    foodUid: food.uid,
    name: food.name,
    per100g: nutritionOf(food),
    grams: amount.grams,
    portions: amount.portions,
    portionGrams: food.portionGrams,
    portionOnly: food.portionOnly || undefined,
    createdAt: now,
  } as Entry
}

export async function saveProduct(
  data: Omit<Product, 'id' | 'uid' | 'updatedAt' | 'usageCount' | 'lastUsedAt' | 'kind'>,
  id?: number,
  kind?: Exclude<ProductKind, 'recipe'>,
) {
  const now = Date.now()
  if (id) {
    await db.transaction('rw', db.products, db.recipes, async () => {
      await db.products.update(id, { ...data, ...(kind && { kind }), updatedAt: now })
      await recalcRecipesUsing(id)
    })
    return id
  }
  return db.products.add({ ...data, kind: kind ?? 'product', uid: newUid(), updatedAt: now, usageCount: 0, lastUsedAt: 0 } as Product)
}

export async function recipesUsing(productId: number): Promise<Recipe[]> {
  const all = await db.recipes.toArray()
  return all.filter((r) => r.ingredients.some((i) => i.productId === productId))
}

async function recalcRecipesUsing(productId: number) {
  for (const r of await recipesUsing(productId)) {
    await db.products.update(r.productId, { ...(await computeRecipe(r.ingredients, r.cookedWeight)), updatedAt: Date.now() })
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
  const { name, cookedWeight, portions } = r
  const now = Date.now()
  // Ingredients are referenced by uid on the server, local ids differ between devices.
  const products = await db.products.bulkGet(r.ingredients.map((i) => i.productId))
  const ingredients = r.ingredients.map((i, idx) => ({ ...i, uid: products[idx]?.uid ?? i.uid }))
  const values = {
    ...(await computeRecipe(ingredients, cookedWeight)),
    portionGrams: recipePortionGrams(ingredients, cookedWeight, portions),
    updatedAt: now,
  }
  return db.transaction('rw', db.products, db.recipes, async () => {
    if (id) {
      const recipe = await db.recipes.get(id)
      if (!recipe) throw new Error('Рецепт не найден')
      await db.recipes.update(id, { name, ingredients, cookedWeight, portions, updatedAt: now })
      await db.products.update(recipe.productId, { name, ...values })
      return id
    }
    const productId = await db.products.add({
      name,
      ...values,
      kind: 'recipe',
      uid: newUid(),
      usageCount: 0,
      lastUsedAt: now,
    } as Product)
    const recipeId = await db.recipes.add({ name, ingredients, cookedWeight, portions, productId, uid: newUid(), updatedAt: now } as Recipe)
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
  const uidById = new Map<number, string>()
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows = (file.data![t] ?? []) as Record<string, unknown>[]
      // Backups from older versions lack the sync fields; the schema upgrade only touched the database.
      if (t === 'products') rows.forEach((p) => fillProduct(p as unknown as Product))
      if (t === 'recipes') rows.forEach((r) => (fillSyncFields(r), fillIngredients(r as unknown as Recipe, uidById)))
      if (t === 'entries') rows.forEach((e) => fillEntry(e as unknown as Entry, uidById))
      if (t === 'products') for (const p of rows as unknown as Product[]) uidById.set(p.id, p.uid)
      await db.table(t).clear()
      await db.table(t).bulkAdd(rows)
    }
  })
}
