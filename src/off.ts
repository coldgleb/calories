import type { Nutrition } from './calc'

/** A product found in Open Food Facts. Values may be missing or wrong — the user checks them. */
export interface OffProduct {
  name: string
  per100g?: Nutrition
}

interface OffResponse {
  status: number
  product?: {
    product_name?: string
    product_name_ru?: string
    brands?: string
    nutriments?: Record<string, number | string | undefined>
  }
}

function num(v: number | string | undefined): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return n != null && Number.isFinite(n) && n >= 0 ? n : undefined
}

export function parseOff(json: OffResponse): OffProduct | null {
  const p = json.product
  if (json.status !== 1 || !p) return null
  const title = (p.product_name_ru || p.product_name || '').trim()
  const brand = p.brands?.split(',')[0]?.trim()
  const name = [title, brand && !title.includes(brand) ? `«${brand}»` : ''].filter(Boolean).join(', ')

  const n = p.nutriments ?? {}
  const kj = num(n['energy_100g'])
  const kcal = num(n['energy-kcal_100g']) ?? (kj != null ? kj / 4.184 : undefined)
  const protein = num(n['proteins_100g'])
  const fat = num(n['fat_100g'])
  const carbs = num(n['carbohydrates_100g'])
  const known = kcal != null || protein != null || fat != null || carbs != null
  return {
    name,
    per100g: known ? { kcal: kcal ?? 0, protein: protein ?? 0, fat: fat ?? 0, carbs: carbs ?? 0 } : undefined,
  }
}

export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<OffProduct | null> {
  const fields = 'product_name,product_name_ru,brands,nutriments'
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`,
    { signal },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts ответил ${res.status}`)
  return parseOff(await res.json())
}
