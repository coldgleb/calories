import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { forGrams } from './calc'
import { addEntry, db, entryFor, saveProduct, saveRecipe } from './db'
import {
  installTracking,
  pendingChanges,
  prepareAccount,
  pull,
  push,
  recordId,
  wipeLocal,
  type Collection,
  type Remote,
  type RemoteRecord,
} from './sync'

/** In-memory server with the same access rules as the PocketBase collections. */
class FakeServer {
  data = new Map<Collection, Map<string, RemoteRecord>>()
  private clock = 0
  rejectName?: string

  table(c: Collection) {
    if (!this.data.has(c)) this.data.set(c, new Map())
    return this.data.get(c)!
  }

  stamp() {
    const ms = Date.UTC(2026, 9, 26, 12, 0, 0, ++this.clock)
    return new Date(ms).toISOString().replace('T', ' ')
  }
}

class FakeRemote implements Remote {
  private server: FakeServer
  readonly userId: string
  readonly isAdmin: boolean

  constructor(server: FakeServer, userId: string, isAdmin = false) {
    this.server = server
    this.userId = userId
    this.isAdmin = isAdmin
  }

  private visible(c: Collection, r: RemoteRecord) {
    return c === 'foods' || r.owner === this.userId
  }

  async pull(c: Collection, since: string) {
    return [...this.server.table(c).values()]
      .filter((r) => this.visible(c, r) && r.updated >= since)
      .sort((a, b) => a.updated.localeCompare(b.updated))
  }

  async upsert(c: Collection, records: Record<string, unknown>[]) {
    const t = this.server.table(c)
    for (const r of records) {
      const existing = t.get(r.id as string)
      if (this.server.rejectName && r.name === this.server.rejectName) throw Object.assign(new Error('invalid'), { status: 400 })
      if (c === 'foods') {
        if (existing && existing.author !== this.userId && !this.isAdmin) throw Object.assign(new Error('403'), { status: 404 })
        if (!existing && r.author !== this.userId) throw Object.assign(new Error('403'), { status: 400 })
      } else if (r.owner !== this.userId || (existing && existing.owner !== this.userId)) {
        throw Object.assign(new Error('403'), { status: 404 })
      }
    }
    for (const r of records) {
      t.set(r.id as string, { ...t.get(r.id as string), ...r, updated: this.server.stamp() } as RemoteRecord)
    }
  }

  async markDeleted(c: Collection, id: string) {
    const r = this.server.table(c).get(id)
    if (!r || !this.visible(c, r) || (c === 'foods' && r.author !== this.userId && !this.isAdmin)) return 'missing' as const
    r.deleted = true
    r.updated = this.server.stamp()
    return 'ok' as const
  }

  async hasPersonalData() {
    return (['recipes', 'entries', 'weights', 'settings'] as Collection[]).some((c) =>
      [...this.server.table(c).values()].some((r) => r.owner === this.userId && !r.deleted),
    )
  }
}

const chicken = { name: 'Курица', kcal: 113, protein: 23.6, fat: 1.9, carbs: 0.4 }
const rice = { name: 'Рис', kcal: 344, protein: 6.7, fat: 0.7, carbs: 78.9 }

/** Another device signing in: an empty local database that pulls the account. */
async function freshDevice(remote: Remote) {
  await wipeLocal()
  await prepareAccount(remote)
  await pull(remote)
}

async function sync(remote: Remote) {
  await pull(remote)
  await push(remote)
}

let server: FakeServer
let alice: FakeRemote
let bob: FakeRemote

beforeAll(() => installTracking())

beforeEach(async () => {
  await wipeLocal()
  server = new FakeServer()
  alice = new FakeRemote(server, 'alice')
  bob = new FakeRemote(server, 'bob')
})

describe('change tracking', () => {
  it('marks local changes and records deletions', async () => {
    const id = await saveProduct(chicken)
    expect((await db.products.get(id))!.dirty).toBe(1)

    await db.products.update(id, { dirty: 0 })
    await addEntry((await db.products.get(id))!, { grams: 100 }, '2026-10-26')
    // Usage counters are local: they don't make the product dirty again.
    expect((await db.products.get(id))!.dirty).toBe(0)

    const [entry] = await db.entries.toArray()
    expect(entry.dirty).toBe(1)
    expect(entry.foodUid).toBe((await db.products.get(id))!.uid)
    await db.entries.delete(entry.id)
    await new Promise((r) => setTimeout(r, 0))
    expect(await db.tombstones.toArray()).toMatchObject([{ table: 'entries', uid: entry.uid }])
  })

  it('does not mark records written by sync', async () => {
    await saveProduct(chicken)
    await prepareAccount(alice)
    await sync(alice)
    expect(await pendingChanges()).toBe(0)
    await freshDevice(alice)
    expect(await pendingChanges()).toBe(0)
    expect(await db.products.count()).toBe(1)
  })
})

describe('sync between devices', () => {
  it('restores diary, recipes, weight and settings on another device', async () => {
    const c = await saveProduct(chicken)
    const r = await saveProduct(rice)
    await saveRecipe({ name: 'Плов', ingredients: [{ productId: c, grams: 500 }, { productId: r, grams: 200 }], cookedWeight: 900, portions: 4 })
    const plov = (await db.products.where('kind').equals('recipe').first())!
    await addEntry(plov, { grams: 225, portions: 1 }, '2026-10-26')
    await db.weights.put({ date: '2026-10-26', weightKg: 89.5 })
    await db.settings.put({ key: 'main', override: { kcal: 2000 } })
    await prepareAccount(alice)
    await sync(alice)

    await freshDevice(alice)
    const recipe = (await db.recipes.toArray())[0]
    const product = (await db.products.get(recipe.productId))!
    expect(recipe.ingredients.map((i) => i.grams)).toEqual([500, 200])
    expect(recipe.ingredients.every((i) => i.productId > 0)).toBe(true)
    expect(product.kind).toBe('recipe')
    expect(product.kcal).toBeCloseTo(1253 / 9)
    expect(product.portionGrams).toBe(225)

    const [entry] = await db.entries.toArray()
    expect(entry).toMatchObject({ name: 'Плов', grams: 225, portions: 1, productId: product.id })
    expect(forGrams(entry.per100g, entry.grams).kcal).toBeCloseTo(313.25)
    expect(await db.weights.get('2026-10-26')).toMatchObject({ weightKg: 89.5 })
    expect((await db.settings.get('main'))!.override).toEqual({ kcal: 2000 })
  })

  it('propagates deletions', async () => {
    await saveProduct(chicken)
    await db.entries.add(entryFor({ ...chicken }, { grams: 100 }, '2026-10-26'))
    await prepareAccount(alice)
    await sync(alice)

    const [entry] = await db.entries.toArray()
    await db.entries.delete(entry.id)
    await new Promise((r) => setTimeout(r, 0))
    await sync(alice)
    expect(server.table('entries').get(recordId('entries', 'alice', entry.uid))!.deleted).toBe(true)

    await freshDevice(alice)
    expect(await db.entries.count()).toBe(0)
  })

  it('keeps newer local changes and takes newer remote ones', async () => {
    await db.weights.put({ date: '2026-10-26', weightKg: 90 })
    await prepareAccount(alice)
    await sync(alice)

    // The other device saves 89 later.
    const remote = server.table('weights').get(recordId('weights', 'alice', '2026-10-26'))!
    Object.assign(remote, { weightKg: 89, clientUpdatedAt: Date.now() + 60_000, updated: server.stamp() })
    await db.weights.put({ date: '2026-10-26', weightKg: 91 }) // older than the remote change
    await sync(alice)
    expect((await db.weights.get('2026-10-26'))!.weightKg).toBe(89)

    await new Promise((r) => setTimeout(r, 5))
    remote.clientUpdatedAt = Date.now() - 60_000
    remote.updated = server.stamp()
    await db.weights.put({ date: '2026-10-26', weightKg: 88 }) // newer than the remote change
    await sync(alice)
    expect((await db.weights.get('2026-10-26'))!.weightKg).toBe(88)
    expect(server.table('weights').get(recordId('weights', 'alice', '2026-10-26'))!.weightKg).toBe(88)
  })

  it('skips a refused record and sends the rest', async () => {
    server.rejectName = 'Плохой'
    await saveProduct(chicken)
    await saveProduct({ ...rice, name: 'Плохой' })
    await prepareAccount(alice)
    await sync(alice)
    expect([...server.table('foods').values()].map((f) => f.name)).toEqual(['Курица'])
  })
})

describe('shared catalogue and privacy', () => {
  it('shares foods but keeps diaries private', async () => {
    const c = await saveProduct(chicken)
    await addEntry((await db.products.get(c))!, { grams: 150 }, '2026-10-26')
    await prepareAccount(alice)
    await sync(alice)

    await wipeLocal()
    await prepareAccount(bob)
    await sync(bob)
    const shared = (await db.products.toArray())[0]
    expect(shared).toMatchObject({ name: 'Курица', author: 'alice' })
    expect(await db.entries.count()).toBe(0)

    // Bob changes his local copy of Alice's food: it isn't sent, Alice's record stays.
    await db.products.update(shared.id, { kcal: 999 })
    await sync(bob)
    expect([...server.table('foods').values()][0].kcal).toBe(113)
  })

  it('lets an admin fix somebody else\'s food', async () => {
    await saveProduct(chicken)
    await prepareAccount(alice)
    await sync(alice)

    const admin = new FakeRemote(server, 'admin', true)
    await wipeLocal()
    await prepareAccount(admin)
    await sync(admin)
    const food = (await db.products.toArray())[0]
    await db.products.update(food.id, { kcal: 120 })
    await sync(admin)
    const remote = [...server.table('foods').values()][0]
    expect(remote).toMatchObject({ kcal: 120, author: 'alice' })
  })
})

describe('first sign-in on a device', () => {
  it('uploads local data when the account is empty', async () => {
    await saveProduct(chicken)
    expect(await prepareAccount(alice)).toBe('ready')
    await sync(alice)
    expect(server.table('foods').size).toBe(1)
  })

  it('asks when both have data, and can take the server copy', async () => {
    await db.weights.put({ date: '2026-10-20', weightKg: 95 })
    await prepareAccount(alice)
    await sync(alice)

    await wipeLocal()
    await db.weights.put({ date: '2026-10-26', weightKg: 90 })
    expect(await prepareAccount(alice)).toBe('ask')

    await prepareAccount(alice, 'server')
    await pull(alice)
    expect((await db.weights.toArray()).map((w) => w.date)).toEqual(['2026-10-20'])
  })

  it('merges both copies when asked to', async () => {
    await db.weights.put({ date: '2026-10-20', weightKg: 95 })
    await prepareAccount(alice)
    await sync(alice)

    await wipeLocal()
    await db.weights.put({ date: '2026-10-26', weightKg: 90 })
    await prepareAccount(alice, 'merge')
    await sync(alice)
    expect((await db.weights.toArray()).map((w) => w.date)).toEqual(['2026-10-20', '2026-10-26'])
    expect(server.table('weights').size).toBe(2)
  })
})

describe('recordId', () => {
  it('is a valid, stable PocketBase id that separates owners', () => {
    const a = recordId('weights', 'alice', '2026-10-26')
    expect(a).toMatch(/^[a-z0-9]{15}$/)
    expect(recordId('weights', 'alice', '2026-10-26')).toBe(a)
    expect(recordId('weights', 'bob', '2026-10-26')).not.toBe(a)
    expect(recordId('foods', 'alice', 'x')).toBe(recordId('foods', 'bob', 'x'))
  })
})
