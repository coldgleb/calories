import { useState } from 'preact/hooks'
import { db, getSettings, shiftDate, todayISO, useLive } from '../db'
import { fmt1, Header, NumField, parseNum } from '../ui'
import { WeightChart, parseISO } from './WeightChart'

type Range = 30 | 90 | 0

const RANGES: { value: Range; label: string }[] = [
  { value: 30, label: 'Месяц' },
  { value: 90, label: '3 месяца' },
  { value: 0, label: 'Всё' },
]

const RANGE_TEXT: Record<Range, string> = { 30: 'за месяц', 90: 'за 3 месяца', 0: 'с начала' }

export async function logWeight(weightKg: number, date = todayISO()) {
  await db.transaction('rw', db.weights, db.settings, async () => {
    await db.weights.put({ date, weightKg })
    // Keep the calorie target in step with the latest weight.
    const latest = await db.weights.orderBy('date').last()
    const s = await getSettings()
    if (s.profile && latest?.date === date) await db.settings.put({ ...s, profile: { ...s.profile, weightKg } })
  })
}

export function Weight() {
  const [range, setRange] = useState<Range>(30)
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const all = useLive(() => db.weights.orderBy('date').toArray())

  const from = range ? shiftDate(todayISO(), -range) : ''
  const points = (all ?? []).filter((w) => w.date >= from)
  const latest = all?.[all.length - 1]
  const first = points[0]
  const delta = latest && first && points.length > 1 ? latest.weightKg - first.weightKg : undefined
  const w = parseNum(input)

  async function save(e: Event) {
    e.preventDefault()
    if (!w) return
    await logWeight(w)
    setInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div class="screen">
      <Header title="Вес" />

      <section class="card weight-head">
        <div>
          <span class="left-num">{latest ? fmt1(latest.weightKg) : '—'}</span> <span class="muted">кг</span>
          {delta !== undefined && (
            <p class="muted small">
              {delta > 0 ? '+' : delta < 0 ? '−' : ''}
              {fmt1(Math.abs(delta))} кг {RANGE_TEXT[range]}
            </p>
          )}
        </div>
        <form class="row weight-form" onSubmit={save}>
          <NumField label="Вес сегодня" value={input} onInput={setInput} suffix="кг" placeholder={latest ? fmt1(latest.weightKg) : '80'} />
          <button class="btn primary" disabled={!w}>
            {saved ? '✓' : 'Записать'}
          </button>
        </form>
      </section>

      {all && all.length > 0 && (
        <>
          <div class="segmented range" role="radiogroup">
            {RANGES.map((r) => (
              <button key={r.value} type="button" class={range === r.value ? 'active' : ''} onClick={() => setRange(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          {points.length > 0 ? (
            <section class="card chart-card">
              <WeightChart points={points} />
            </section>
          ) : (
            <p class="empty">За этот период записей нет</p>
          )}

          <ul class="list">
            {[...points].reverse().map((x) => (
              <li key={x.date}>
                <button
                  class="list-item"
                  onClick={() =>
                    confirm(`Удалить запись веса за ${parseISO(x.date).toLocaleDateString('ru-RU')}?`) &&
                    db.weights.delete(x.date)
                  }
                >
                  <span class="li-main">
                    {parseISO(x.date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}
                  </span>
                  <span class="li-kcal">{fmt1(x.weightKg)} кг</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {all?.length === 0 && (
        <p class="empty">Взвешивайтесь утром натощак, хотя бы раз в неделю. Вес колеблется на 1–2 кг день ото дня — смотрите на тренд.</p>
      )}
    </div>
  )
}
