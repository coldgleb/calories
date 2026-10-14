import { forGrams, sum } from './calc'
import { db, type Entry, type Product, type WeightLog } from './db'

/**
 * CSV for Excel with Russian locale: ";" separator, decimal comma, UTF-8 BOM
 * (without it Excel reads Cyrillic as mojibake) and CRLF line endings.
 */
export function toCsv(rows: (string | number | undefined)[][]): string {
  const cell = (v: string | number | undefined) => {
    if (v == null) return ''
    if (typeof v === 'number') return String(Math.round(v * 10) / 10).replace('.', ',')
    return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
}

const ru = (iso: string) => iso.split('-').reverse().join('.')

export function diaryRows(entries: Entry[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  return [
    ['Дата', 'Время', 'Продукт', 'Граммы', 'Ккал', 'Белки, г', 'Жиры, г', 'Углеводы, г'],
    ...sorted.map((e) => {
      const n = forGrams(e.per100g, e.grams)
      const time = new Date(e.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return [ru(e.date), time, e.name, e.grams, n.kcal, n.protein, n.fat, n.carbs]
    }),
  ]
}

export function dailyRows(entries: Entry[], weights: WeightLog[]) {
  const byDate = new Map<string, Entry[]>()
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  const weightOf = new Map(weights.map((w) => [w.date, w.weightKg]))
  const dates = [...new Set([...byDate.keys(), ...weightOf.keys()])].sort()
  return [
    ['Дата', 'Ккал', 'Белки, г', 'Жиры, г', 'Углеводы, г', 'Записей', 'Вес, кг'],
    ...dates.map((d) => {
      const list = byDate.get(d) ?? []
      const t = sum(list.map((e) => forGrams(e.per100g, e.grams)))
      return list.length
        ? [ru(d), t.kcal, t.protein, t.fat, t.carbs, list.length, weightOf.get(d)]
        : [ru(d), undefined, undefined, undefined, undefined, 0, weightOf.get(d)]
    }),
  ]
}

export function weightRows(weights: WeightLog[]) {
  return [['Дата', 'Вес, кг'], ...[...weights].sort((a, b) => a.date.localeCompare(b.date)).map((w) => [ru(w.date), w.weightKg])]
}

export function productRows(products: Product[]) {
  return [
    ['Название', 'Тип', 'Штрихкод', 'Ккал/100 г', 'Белки/100 г', 'Жиры/100 г', 'Углеводы/100 г', 'Использований'],
    ...[...products]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((p) => [p.name, p.kind === 'recipe' ? 'рецепт' : 'продукт', p.barcode, p.kcal, p.protein, p.fat, p.carbs, p.usageCount]),
  ]
}

export type ExportKind = 'diary' | 'daily' | 'weight' | 'products'

export const EXPORT_KINDS: { value: ExportKind; label: string; file: string }[] = [
  { value: 'diary', label: 'Дневник — каждая запись', file: 'дневник' },
  { value: 'daily', label: 'Итоги по дням + вес', file: 'итоги' },
  { value: 'weight', label: 'Вес', file: 'вес' },
  { value: 'products', label: 'Справочник продуктов', file: 'продукты' },
]

/** Builds the CSV for an inclusive date range; empty bounds mean "from the start" / "until today". */
export async function buildCsv(kind: ExportKind, from: string, to: string): Promise<{ csv: string; rows: number }> {
  const lo = from || '0000-00-00'
  const hi = to || '9999-99-99'
  let rows: (string | number | undefined)[][]
  if (kind === 'products') {
    rows = productRows(await db.products.toArray())
  } else {
    const weights = await db.weights.where('date').between(lo, hi, true, true).toArray()
    if (kind === 'weight') rows = weightRows(weights)
    else {
      const entries = await db.entries.where('date').between(lo, hi, true, true).toArray()
      rows = kind === 'diary' ? diaryRows(entries) : dailyRows(entries, weights)
    }
  }
  return { csv: toCsv(rows), rows: rows.length - 1 }
}

export function downloadFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
