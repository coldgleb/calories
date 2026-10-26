import type { IndexableType, Transaction } from 'dexie'
import {
  computeRecipe,
  db,
  recipePortionGrams,
  recipesUsing,
  type Entry,
  type Product,
  type Recipe,
  type RecipeIngredient,
  type Settings,
  type SyncedTable,
  type WeightLog,
} from './db'

/**
 * Local-first sync with the server.
 *
 * Dexie stays the source of truth for the UI. Hooks mark local changes `dirty` and record
 * deletions as tombstones; a sync pulls what changed on the server since last time (newer
 * wins), then pushes dirty records and tombstones. Products and ready food go to the shared
 * `foods` collection, everything else to collections visible only to the owner.
 */

export type Collection = 'foods' | 'recipes' | 'entries' | 'weights' | 'settings'

export interface RemoteRecord {
  id: string
  uid: string
  /** Server timestamp, "2026-10-26 12:00:00.123Z" — sortable as a string. */
  updated: string
  clientUpdatedAt?: number
  deleted?: boolean
  [field: string]: unknown
}

/** What sync needs from the server; PocketBase in the app, an in-memory fake in tests. */
export interface Remote {
  readonly userId: string
  readonly isAdmin: boolean
  /** Records with `updated >= since`, oldest first; everything when `since` is empty. */
  pull(collection: Collection, since: string): Promise<RemoteRecord[]>
  /** Creates or replaces records by `id`; all or nothing. */
  upsert(collection: Collection, records: Record<string, unknown>[]): Promise<void>
  markDeleted(collection: Collection, id: string): Promise<'ok' | 'missing'>
  /** Whether the account already has personal data (diary, recipes, weight, settings). */
  hasPersonalData(): Promise<boolean>
}

const BATCH = 50
const COLLECTION_OF: Record<SyncedTable, Collection> = {
  products: 'foods',
  recipes: 'recipes',
  entries: 'entries',
  weights: 'weights',
  settings: 'settings',
}
const SYNCED_TABLES = Object.keys(COLLECTION_OF) as SyncedTable[]

// ---------------------------------------------------------------------------
// Record ids
// ---------------------------------------------------------------------------

function hash53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Server record id derived from the uid, so a push is a plain upsert with no lookup.
 * PocketBase ids are 15 characters of [a-z0-9]. Personal uids such as a weight's date
 * repeat between users, so the owner is part of the key.
 */
export function recordId(collection: Collection, owner: string, uid: string): string {
  const key = `${collection}|${collection === 'foods' ? '' : owner}|${uid}`
  const a = hash53(key, 1).toString(36).padStart(11, '0')
  const b = hash53(key, 2).toString(36).padStart(11, '0')
  return (a + b).slice(0, 15)
}

// ---------------------------------------------------------------------------
// Change tracking
// ---------------------------------------------------------------------------

const SYNC_TX = '__fromSync'
/** Fields that only matter on this device: "recent" ordering in search. */
const LOCAL_PRODUCT_FIELDS = new Set(['usageCount', 'lastUsedAt'])

function isSyncTx(tx: Transaction | undefined): boolean {
  return !!(tx as unknown as Record<string, unknown> | undefined)?.[SYNC_TX]
}

/** Runs writes that come from the server: they must not be marked as local changes. */
function applyRemote<T>(tables: SyncedTable[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables.map((t) => db.table(t)), async (tx) => {
    ;(tx as unknown as Record<string, unknown>)[SYNC_TX] = true
    return fn()
  })
}

function uidOf(table: SyncedTable, row: Record<string, unknown>): string | undefined {
  if (table === 'weights') return row.date as string
  if (table === 'settings') return 'main'
  return row.uid as string | undefined
}

let tracking = false

export function installTracking() {
  if (tracking) return
  tracking = true
  for (const table of SYNCED_TABLES) {
    const t = db.table(table)
    t.hook('creating', function (_pk, obj, tx) {
      if (isSyncTx(tx)) return
      // Recipe products are derived from recipes, which sync on their own.
      if (table === 'products' && obj.kind === 'recipe') return
      obj.dirty = 1
      obj.updatedAt ??= Date.now()
      if (table === 'products' && !obj.author && active) obj.author = active.userId
      scheduleSync()
    })
    t.hook('updating', function (mods, _pk, obj, tx) {
      if (isSyncTx(tx)) return
      if (table === 'products' && (obj as Product).kind === 'recipe') return
      const keys = Object.keys(mods)
      if (table === 'products' && keys.every((k) => LOCAL_PRODUCT_FIELDS.has(k))) return
      if (keys.every((k) => k === 'dirty')) return
      scheduleSync()
      return { dirty: 1, updatedAt: Date.now() }
    })
    t.hook('deleting', function (_pk, obj, tx) {
      if (isSyncTx(tx)) return
      if (table === 'products' && (obj as Product).kind === 'recipe') return
      const uid = uidOf(table, obj)
      if (!uid) return
      // Other tables may be outside this transaction; record the deletion once it commits.
      tx.on('complete', () => {
        db.tombstones.add({ table, uid } as never).then(scheduleSync, console.error)
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Mapping between local rows and server records
// ---------------------------------------------------------------------------

const orUndef = (n: unknown) => (typeof n === 'number' && n > 0 ? n : undefined)

export function foodToRemote(p: Product, me: string) {
  return {
    id: recordId('foods', me, p.uid),
    uid: p.uid,
    clientUpdatedAt: p.updatedAt,
    deleted: false,
    author: p.author ?? me,
    kind: p.kind,
    name: p.name,
    kcal: p.kcal,
    protein: p.protein,
    fat: p.fat,
    carbs: p.carbs,
    barcode: p.barcode ?? '',
    portionGrams: p.portionGrams ?? 0,
    portionOnly: !!p.portionOnly,
  }
}

function foodFromRemote(r: RemoteRecord) {
  return {
    uid: r.uid,
    updatedAt: r.clientUpdatedAt ?? 0,
    author: r.author as string,
    kind: r.kind as 'product' | 'ready',
    name: r.name as string,
    kcal: (r.kcal as number) ?? 0,
    protein: (r.protein as number) ?? 0,
    fat: (r.fat as number) ?? 0,
    carbs: (r.carbs as number) ?? 0,
    barcode: (r.barcode as string) || undefined,
    portionGrams: orUndef(r.portionGrams),
    portionOnly: r.portionOnly ? true : undefined,
  }
}

export function recipeToRemote(r: Recipe, productUid: string, me: string) {
  return {
    id: recordId('recipes', me, r.uid),
    uid: r.uid,
    clientUpdatedAt: r.updatedAt,
    deleted: false,
    owner: me,
    name: r.name,
    productUid,
    ingredients: r.ingredients.filter((i) => i.uid).map((i) => ({ uid: i.uid, grams: i.grams })),
    cookedWeight: r.cookedWeight ?? 0,
    portions: r.portions ?? 0,
  }
}

export function entryToRemote(e: Entry, me: string) {
  return {
    id: recordId('entries', me, e.uid),
    uid: e.uid,
    clientUpdatedAt: e.updatedAt,
    deleted: false,
    owner: me,
    date: e.date,
    foodUid: e.foodUid ?? '',
    name: e.name,
    per100g: e.per100g,
    grams: e.grams,
    portions: e.portions ?? 0,
    portionGrams: e.portionGrams ?? 0,
    portionOnly: !!e.portionOnly,
    createdAt: e.createdAt,
  }
}

export function weightToRemote(w: WeightLog, me: string) {
  return {
    id: recordId('weights', me, w.date),
    uid: w.date,
    clientUpdatedAt: w.updatedAt ?? 0,
    deleted: false,
    owner: me,
    date: w.date,
    weightKg: w.weightKg,
  }
}

export function settingsToRemote(s: Settings, me: string) {
  return {
    id: recordId('settings', me, 'main'),
    uid: 'main',
    clientUpdatedAt: s.updatedAt ?? 0,
    deleted: false,
    owner: me,
    profile: s.profile ?? null,
    override: s.override ?? null,
  }
}

/** Remote wins unless the local copy has newer unsent changes. */
function remoteWins(local: { dirty?: 0 | 1; updatedAt?: number } | undefined, r: RemoteRecord): boolean {
  return !local || !local.dirty || (local.updatedAt ?? 0) <= (r.clientUpdatedAt ?? 0)
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function productIdByUid(uid: string | undefined): Promise<number> {
  if (!uid) return 0
  return (await db.products.where('uid').equals(uid).first())?.id ?? 0
}

async function refreshRecipeProduct(recipe: Recipe) {
  const values = await computeRecipe(recipe.ingredients, recipe.cookedWeight)
  const portionGrams = recipePortionGrams(recipe.ingredients, recipe.cookedWeight, recipe.portions)
  await db.products.update(recipe.productId, { ...values, portionGrams, name: recipe.name })
}

async function applyFoods(records: RemoteRecord[]) {
  await applyRemote(['products', 'recipes'], async () => {
    const changed: number[] = []
    for (const r of records) {
      const local = await db.products.where('uid').equals(r.uid).first()
      if (r.deleted) {
        if (local) await db.products.delete(local.id)
        continue
      }
      if (!remoteWins(local, r)) continue
      const fields = { ...foodFromRemote(r), dirty: 0 as const }
      if (local) {
        await db.products.update(local.id, fields)
        changed.push(local.id)
      } else {
        await db.products.add({ ...fields, usageCount: 0, lastUsedAt: 0 } as Product)
      }
    }
    // Shared values changed: recipes built from them change too.
    for (const id of changed) for (const recipe of await recipesUsing(id)) await refreshRecipeProduct(recipe)
  })
}

async function resolveIngredients(list: { uid?: string; grams: number }[]): Promise<RecipeIngredient[]> {
  const out: RecipeIngredient[] = []
  for (const i of list) out.push({ uid: i.uid, grams: i.grams, productId: await productIdByUid(i.uid) })
  return out
}

async function applyRecipes(records: RemoteRecord[]) {
  await applyRemote(['products', 'recipes'], async () => {
    const touched: Recipe[] = []
    for (const r of records) {
      const local = await db.recipes.where('uid').equals(r.uid).first()
      if (r.deleted) {
        if (local) {
          await db.recipes.delete(local.id)
          await db.products.delete(local.productId)
        }
        continue
      }
      if (!remoteWins(local, r)) continue
      const productUid = r.productUid as string
      let product = await db.products.where('uid').equals(productUid).first()
      if (!product) {
        const id = await db.products.add({
          uid: productUid,
          updatedAt: r.clientUpdatedAt ?? 0,
          name: r.name as string,
          kind: 'recipe',
          kcal: 0,
          protein: 0,
          fat: 0,
          carbs: 0,
          usageCount: 0,
          lastUsedAt: 0,
        } as Product)
        product = (await db.products.get(id))!
      }
      const recipe = {
        uid: r.uid,
        updatedAt: r.clientUpdatedAt ?? 0,
        name: r.name as string,
        ingredients: await resolveIngredients((r.ingredients as { uid?: string; grams: number }[]) ?? []),
        cookedWeight: orUndef(r.cookedWeight),
        portions: orUndef(r.portions),
        productId: product.id,
        dirty: 0 as const,
      }
      let id: number
      if (local) await db.recipes.update((id = local.id), recipe)
      else id = await db.recipes.add(recipe as Recipe)
      await db.products.update(product.id, { recipeId: id })
      touched.push({ ...recipe, id } as Recipe)
    }
    // A recipe may use another recipe that arrived later in the same batch.
    for (const recipe of touched) {
      if (recipe.ingredients.some((i) => !i.productId && i.uid)) {
        recipe.ingredients = await resolveIngredients(recipe.ingredients)
        await db.recipes.update(recipe.id, { ingredients: recipe.ingredients })
      }
    }
    for (const recipe of touched) await refreshRecipeProduct(recipe)
  })
}

async function applyEntries(records: RemoteRecord[]) {
  await applyRemote(['entries', 'products'], async () => {
    for (const r of records) {
      const local = await db.entries.where('uid').equals(r.uid).first()
      if (r.deleted) {
        if (local) await db.entries.delete(local.id)
        continue
      }
      if (!remoteWins(local, r)) continue
      const entry = {
        uid: r.uid,
        updatedAt: r.clientUpdatedAt ?? 0,
        dirty: 0 as const,
        date: r.date as string,
        foodUid: (r.foodUid as string) || undefined,
        productId: await productIdByUid(r.foodUid as string),
        name: r.name as string,
        per100g: r.per100g as Entry['per100g'],
        grams: r.grams as number,
        portions: orUndef(r.portions),
        portionGrams: orUndef(r.portionGrams),
        portionOnly: r.portionOnly ? true : undefined,
        createdAt: (r.createdAt as number) || 0,
      }
      if (local) await db.entries.update(local.id, entry)
      else await db.entries.add(entry as Entry)
    }
  })
}

async function applyWeights(records: RemoteRecord[]) {
  await applyRemote(['weights'], async () => {
    for (const r of records) {
      const local = await db.weights.get(r.date as string)
      if (r.deleted) {
        if (local) await db.weights.delete(local.date)
        continue
      }
      if (!remoteWins(local, r)) continue
      await db.weights.put({
        date: r.date as string,
        weightKg: r.weightKg as number,
        updatedAt: r.clientUpdatedAt ?? 0,
        dirty: 0,
      })
    }
  })
}

async function applySettings(records: RemoteRecord[]) {
  await applyRemote(['settings'], async () => {
    for (const r of records) {
      const local = await db.settings.get('main')
      if (r.deleted || !remoteWins(local, r)) continue
      await db.settings.put({
        key: 'main',
        profile: (r.profile as Settings['profile']) ?? undefined,
        override: (r.override as Settings['override']) ?? undefined,
        updatedAt: r.clientUpdatedAt ?? 0,
        dirty: 0,
      })
    }
  })
}

const APPLY: Record<Collection, (records: RemoteRecord[]) => Promise<void>> = {
  foods: applyFoods,
  recipes: applyRecipes,
  entries: applyEntries,
  weights: applyWeights,
  settings: applySettings,
}

/** Foods first: recipes and entries refer to them. */
const PULL_ORDER: Collection[] = ['foods', 'recipes', 'entries', 'weights', 'settings']

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export async function pull(remote: Remote) {
  for (const collection of PULL_ORDER) {
    const since = (await getMeta<string>(`pulled:${collection}`)) ?? ''
    const records = await remote.pull(collection, since)
    if (!records.length) continue
    await APPLY[collection](records)
    // `>=` on the next pull re-reads records from the same millisecond; applying them twice is harmless.
    await setMeta(`pulled:${collection}`, records[records.length - 1].updated)
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** Records the server refused (validation, permissions); skipped until the app restarts. */
const refused = new Set<string>()

interface Outgoing<T> {
  row: T
  record: Record<string, unknown>
}

async function upsertAll<T>(remote: Remote, collection: Collection, items: Outgoing<T>[]) {
  const sent: Outgoing<T>[] = []
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    try {
      await remote.upsert(collection, chunk.map((c) => c.record))
      sent.push(...chunk)
    } catch (e) {
      if (isNetworkError(e)) throw e
      // A batch is all or nothing: find the culprit one by one.
      for (const item of chunk) {
        try {
          await remote.upsert(collection, [item.record])
          sent.push(item)
        } catch (err) {
          if (isNetworkError(err)) throw err
          console.warn('Сервер не принял запись', collection, item.record, err)
          refused.add(`${collection}:${item.record.uid}`)
        }
      }
    }
  }
  return sent
}

/** Clears `dirty` unless the row changed again while it was being sent. */
async function markSent<T extends { updatedAt?: number }>(
  table: SyncedTable,
  sent: Outgoing<T>[],
  keyOf: (row: T) => IndexableType,
) {
  if (!sent.length) return
  await applyRemote([table], async () => {
    for (const { row } of sent) {
      const key = keyOf(row)
      const current = (await db.table(table).get(key)) as { updatedAt?: number } | undefined
      if (current && current.updatedAt === row.updatedAt) await db.table(table).update(key, { dirty: 0 })
    }
  })
}

const notRefused = (collection: Collection) => <T>(o: Outgoing<T>) => !refused.has(`${collection}:${o.record.uid}`)

export async function push(remote: Remote) {
  const me = remote.userId

  const products = (await db.products.where('dirty').equals(1).toArray()).filter((p) => p.kind !== 'recipe')
  const mine = products.filter((p) => !p.author || p.author === me || remote.isAdmin)
  const foods = mine.map((row) => ({ row, record: foodToRemote(row, me) })).filter(notRefused('foods'))
  await markSent('products', await upsertAll(remote, 'foods', foods), (p: Product) => p.id)

  const recipes = await db.recipes.where('dirty').equals(1).toArray()
  const recipeItems: Outgoing<Recipe>[] = []
  for (const row of recipes) {
    const product = await db.products.get(row.productId)
    if (product) recipeItems.push({ row, record: recipeToRemote(row, product.uid, me) })
  }
  await markSent('recipes', await upsertAll(remote, 'recipes', recipeItems.filter(notRefused('recipes'))), (r: Recipe) => r.id)

  const entries = await db.entries.where('dirty').equals(1).toArray()
  const entryItems = entries.map((row) => ({ row, record: entryToRemote(row, me) })).filter(notRefused('entries'))
  await markSent('entries', await upsertAll(remote, 'entries', entryItems), (e: Entry) => e.id)

  const weights = await db.weights.where('dirty').equals(1).toArray()
  const weightItems = weights.map((row) => ({ row, record: weightToRemote(row, me) })).filter(notRefused('weights'))
  await markSent('weights', await upsertAll(remote, 'weights', weightItems), (w: WeightLog) => w.date)

  const settings = await db.settings.where('dirty').equals(1).toArray()
  const settingItems = settings.map((row) => ({ row, record: settingsToRemote(row, me) }))
  await markSent('settings', await upsertAll(remote, 'settings', settingItems), (s: Settings) => s.key)

  for (const t of await db.tombstones.toArray()) {
    const collection = COLLECTION_OF[t.table]
    // "missing" — never reached the server, or it isn't ours to delete: nothing to do either way.
    await remote.markDeleted(collection, recordId(collection, me, t.uid))
    await db.tombstones.delete(t.id)
  }
}

// ---------------------------------------------------------------------------
// Accounts on this device
// ---------------------------------------------------------------------------

async function hasLocalData(): Promise<boolean> {
  const counts = await Promise.all([
    db.products.count(),
    db.entries.count(),
    db.weights.count(),
    db.settings.count(),
  ])
  return counts.some((n) => n > 0)
}

/** Makes everything on this device the user's own and queues it for upload. */
async function adoptLocalData(me: string) {
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones], async () => {
    // Deletions made before signing in refer to nothing on the server.
    await db.tombstones.clear()
    await db.products.toCollection().modify((p: Product) => {
      if (p.kind === 'recipe') return
      p.author ??= me
      p.dirty = 1
    })
    for (const t of ['recipes', 'entries', 'weights', 'settings'] as const) {
      await db.table(t).toCollection().modify((row: { dirty?: 0 | 1 }) => {
        row.dirty = 1
      })
    }
  })
}

/** Removes everything from this device, e.g. on sign-out — the device may be shared. */
export async function wipeLocal() {
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones, db.meta], async (tx) => {
    ;(tx as unknown as Record<string, unknown>)[SYNC_TX] = true
    for (const t of [...SYNCED_TABLES, 'tombstones', 'meta']) await db.table(t).clear()
  })
}

export type FirstSync = 'ready' | 'ask'

/**
 * Prepares the device for an account after sign-in. Returns "ask" when both the device and
 * the account have data, so the user decides between merging and taking the server's copy.
 */
export async function prepareAccount(remote: Remote, choice?: 'merge' | 'server'): Promise<FirstSync> {
  const me = remote.userId
  if ((await getMeta<string>('userId')) === me) return 'ready'
  if (choice === 'server') {
    await wipeLocal()
  } else if (await hasLocalData()) {
    if (!choice && (await remote.hasPersonalData())) return 'ask'
    await adoptLocalData(me)
  }
  await setMeta('userId', me)
  return 'ready'
}

export async function pendingChanges(): Promise<number> {
  const counts = await Promise.all([
    ...SYNCED_TABLES.map((t) => db.table(t).where('dirty').equals(1).count()),
    db.tombstones.count(),
  ])
  return counts.reduce((a, b) => a + b, 0)
}

// ---------------------------------------------------------------------------
// Running sync
// ---------------------------------------------------------------------------

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt?: number
  error?: string
  pending: number
  refused: number
}

let status: SyncStatus = { state: 'off', pending: 0, refused: 0 }
const listeners = new Set<(s: SyncStatus) => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, refused: refused.size }
  for (const l of listeners) l(status)
}

export function getSyncStatus() {
  return status
}

export function onSyncStatus(listener: (s: SyncStatus) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isNetworkError(e: unknown): boolean {
  const err = e as { status?: number; isAbort?: boolean; name?: string }
  return err?.status === 0 || err?.name === 'TypeError'
}

let active: Remote | null = null
let running: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let describeError: (e: unknown) => string = (e) => (e as Error)?.message ?? String(e)

export function syncNow(): Promise<void> {
  const remote = active
  if (!remote) return Promise.resolve()
  if (running) return running
  setStatus({ state: 'syncing' })
  running = (async () => {
    try {
      await pull(remote)
      await push(remote)
      if (remote !== active) return
      setStatus({ state: 'idle', lastSyncAt: Date.now(), error: undefined, pending: await pendingChanges() })
    } catch (e) {
      if (remote !== active) return
      const offline = isNetworkError(e)
      setStatus({
        state: offline ? 'offline' : 'error',
        error: offline ? undefined : describeError(e),
        pending: await pendingChanges(),
      })
    } finally {
      running = null
    }
  })()
  return running
}

/** Debounced sync after a local change. */
export function scheduleSync(delay = 2000) {
  clearTimeout(timer)
  // Called from Dexie hooks: count outside the hook's transaction, which may not cover every table.
  setTimeout(() => pendingChanges().then((pending) => setStatus({ pending }), console.error), 0)
  if (active) timer = setTimeout(syncNow, delay)
}

let listening = false
/** Returning to the app syncs, but not more often than every 30 s (switching apps back and forth). */
const onVisible = () => {
  if (document.visibilityState !== 'visible') return
  if (status.lastSyncAt && Date.now() - status.lastSyncAt < 30_000) return
  syncNow()
}
let interval: ReturnType<typeof setInterval> | undefined

export function startSync(remote: Remote, describe?: (e: unknown) => string) {
  active = remote
  if (describe) describeError = describe
  if (typeof window !== 'undefined') {
    if (!listening) {
      listening = true
      window.addEventListener('online', () => syncNow())
      document.addEventListener('visibilitychange', onVisible)
    }
    interval ??= setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60 * 1000)
  }
  return syncNow()
}

export async function stopSync() {
  active = null
  clearTimeout(timer)
  clearInterval(interval)
  interval = undefined
  await running?.catch(() => {})
  setStatus({ state: 'off', lastSyncAt: undefined, error: undefined })
}

export function currentUserId(): string | undefined {
  return active?.userId
}

export function isAdmin(): boolean {
  return !!active?.isAdmin
}
