import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCsv, dailyRows, toCsv } from './csv'
import { db, type Entry } from './db'

const entry = (date: string, grams: number, kcal: number, name = 'Еда'): Entry => ({
  id: 0,
  uid: `${date}:${name}:${grams}`,
  updatedAt: 0,
  date,
  productId: 1,
  name,
  per100g: { kcal, protein: 10, fat: 5, carbs: 20 },
  grams,
  createdAt: new Date(`${date}T12:30:00`).getTime(),
})

describe('toCsv', () => {
  it('uses BOM, semicolons, decimal commas and quotes', () => {
    expect(toCsv([['a;b', 1.25, 'say "hi"', undefined]])).toBe('﻿"a;b";1,3;"say ""hi""";\r\n')
  })
})

describe('dailyRows', () => {
  it('sums each day and joins weights', () => {
    const rows = dailyRows(
      [entry('2026-10-01', 200, 100), entry('2026-10-01', 100, 300), entry('2026-10-03', 50, 200)],
      [{ date: '2026-10-02', weightKg: 90.2 }, { date: '2026-10-03', weightKg: 90 }],
    )
    expect(rows.slice(1)).toEqual([
      ['01.10.2026', 500, 30, 15, 60, 2, undefined],
      ['02.10.2026', undefined, undefined, undefined, undefined, 0, 90.2],
      ['03.10.2026', 100, 5, 2.5, 10, 1, 90],
    ])
  })
})

describe('buildCsv', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.entries.bulkAdd(
      ['2026-09-30', '2026-10-01', '2026-10-07', '2026-10-08'].map((d) => {
        const { id: _, ...e } = entry(d, 100, 100, `Еда ${d}`)
        return e as Entry
      }),
    )
  })

  it('filters diary by an inclusive period', async () => {
    const { csv, rows } = await buildCsv('diary', '2026-10-01', '2026-10-07')
    expect(rows).toBe(2)
    expect(csv).toContain('01.10.2026;12:30;Еда 2026-10-01;100;;100;10;5;20')
    expect(csv).not.toContain('Еда 2026-09-30')
    expect(csv).not.toContain('Еда 2026-10-08')
  })

  it('treats an empty start as "from the beginning"', async () => {
    expect((await buildCsv('diary', '', '2026-10-07')).rows).toBe(3)
  })
})

describe('diaryRows with portions', () => {
  it('shows portions and hides the pseudo-weight of portion-only food', async () => {
    const { diaryRows } = await import('./csv')
    const meal = { ...entry('2026-10-02', 150, 400, 'Ланч'), portions: 1.5, portionOnly: true }
    const bar = { ...entry('2026-10-02', 80, 450, 'Батончик'), portions: 2, portionGrams: 40 }
    const rows = diaryRows([meal, bar])
    expect(rows[1].slice(2)).toEqual(['Ланч', undefined, 1.5, 600, 15, 7.5, 30])
    expect(rows[2].slice(2, 6)).toEqual(['Батончик', 80, 2, 360])
  })
})
