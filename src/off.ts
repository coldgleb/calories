import type { Nutrition } from './calc'

const OFF = 'https://world.openfoodfacts.org'
const APP = { app_name: 'Kalorii PWA', app_version: '1.0' }

/** A product found in Open Food Facts. Values may be missing or wrong — the user checks them. */
export interface OffProduct {
  code?: string
  /** Name with the brand appended, ready to be used as a product name. */
  name: string
  title: string
  brand?: string
  quantity?: string
  per100g?: Nutrition
}

interface RawProduct {
  code?: string
  product_name?: string
  product_name_ru?: string
  brands?: string
  quantity?: string
  nutriments?: Record<string, number | string | undefined>
}

interface OffResponse {
  status: number
  product?: RawProduct
}

const FIELDS = 'code,product_name,product_name_ru,brands,quantity,nutriments'

function num(v: number | string | undefined): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return n != null && Number.isFinite(n) && n >= 0 ? n : undefined
}

export function parseProduct(p: RawProduct): OffProduct {
  const title = (p.product_name_ru || p.product_name || '').trim()
  const brand = p.brands?.split(',')[0]?.trim() || undefined
  const name = [title, brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `«${brand}»` : '']
    .filter(Boolean)
    .join(', ')

  const n = p.nutriments ?? {}
  const kj = num(n['energy_100g'])
  const kcal = num(n['energy-kcal_100g']) ?? (kj != null ? kj / 4.184 : undefined)
  const protein = num(n['proteins_100g'])
  const fat = num(n['fat_100g'])
  const carbs = num(n['carbohydrates_100g'])
  const known = kcal != null || protein != null || fat != null || carbs != null
  return {
    code: p.code,
    name,
    title,
    brand,
    quantity: p.quantity?.trim() || undefined,
    per100g: known ? { kcal: kcal ?? 0, protein: protein ?? 0, fat: fat ?? 0, carbs: carbs ?? 0 } : undefined,
  }
}

export function parseOff(json: OffResponse): OffProduct | null {
  if (json.status !== 1 || !json.product) return null
  return parseProduct(json.product)
}

export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<OffProduct | null> {
  const res = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts ответил ${res.status}`)
  return parseOff(await res.json())
}

const searchCache = new Map<string, OffProduct[]>()

/**
 * Full-text search over product names and brands, most scanned first.
 * OFF allows about 10 searches a minute per IP; when exceeded it answers 503
 * without CORS headers, which the browser reports as a bare network error.
 */
export async function searchOff(query: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const key = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const cached = searchCache.get(key)
  if (cached) return cached
  let hits: OffProduct[]
  try {
    hits = await fetchSearch(key, signal)
  } catch (e) {
    if ((e as Error).name === 'TypeError' && navigator.onLine) {
      throw new Error('Open Food Facts временно ограничил поиск (около 10 запросов в минуту). Подождите минуту и повторите.')
    }
    throw e
  }
  searchCache.set(key, hits)
  return hits
}

async function fetchSearch(query: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    sort_by: 'unique_scans_n',
    fields: FIELDS,
  })
  const res = await fetch(`${OFF}/cgi/search.pl?${params}`, { signal })
  if (res.status === 503 || res.status === 429) throw new Error('Open Food Facts перегружен, попробуйте через минуту.')
  if (!res.ok) throw new Error(`Open Food Facts ответил ${res.status}`)
  const json = (await res.json()) as { products?: RawProduct[] }
  const seen = new Set<string>()
  return (json.products ?? [])
    .map(parseProduct)
    .filter((p) => p.title && p.code && !seen.has(p.code) && seen.add(p.code))
}

export interface OffContribution {
  code: string
  name: string
  brand?: string
  quantity?: string
  per100g: Nutrition
}

/** Form fields of the Open Food Facts write API (product_jqm2.pl). */
export function contributionForm(c: OffContribution, user: string, password: string): URLSearchParams {
  const r = (n: number) => String(Math.round(n * 10) / 10)
  const f = new URLSearchParams({
    ...APP,
    user_id: user,
    password,
    code: c.code,
    lang: 'ru',
    product_name_ru: c.name,
    nutrition_data_per: '100g',
    'nutriment_energy-kcal': r(c.per100g.kcal),
    'nutriment_energy-kcal_unit': 'kcal',
    nutriment_proteins: r(c.per100g.protein),
    nutriment_proteins_unit: 'g',
    nutriment_fat: r(c.per100g.fat),
    nutriment_fat_unit: 'g',
    nutriment_carbohydrates: r(c.per100g.carbs),
    nutriment_carbohydrates_unit: 'g',
    comment: 'Добавлено из приложения «Калории»',
  })
  if (c.brand) f.set('brands', c.brand)
  if (c.quantity) f.set('quantity', c.quantity)
  return f
}

export async function submitToOff(c: OffContribution, user: string, password: string): Promise<void> {
  // A form-encoded POST is a "simple" request, so the browser sends it without a CORS preflight.
  const res = await fetch(`${OFF}/cgi/product_jqm2.pl`, { method: 'POST', body: contributionForm(c, user, password) })
  if (res.status === 401 || res.status === 403) throw new Error('Неверный логин или пароль Open Food Facts')
  if (!res.ok) throw new Error(`Open Food Facts ответил ${res.status}`)
  const json = (await res.json().catch(() => ({}))) as { status?: number; status_verbose?: string }
  if (json.status !== 1) throw new Error(json.status_verbose || 'Open Food Facts не принял данные')
}

export function offProductUrl(code: string): string {
  return `${OFF}/product/${encodeURIComponent(code)}`
}
