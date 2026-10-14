import { useState } from 'preact/hooks'
import type { Nav } from '../App'
import { forGrams, sum } from '../calc'
import { db, effectiveTargets, shiftDate, todayISO, useLive, type Entry } from '../db'
import { Bar, fmt, Macros } from '../ui'
import { GramsSheet } from './GramsSheet'

function dateLabel(iso: string): string {
  const today = todayISO()
  if (iso === today) return 'Сегодня'
  if (iso === shiftDate(today, -1)) return 'Вчера'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
}

export function Day(props: { date: string; setDate: (d: string) => void; nav: Nav }) {
  const { date } = props
  const entries = useLive(() => db.entries.where('date').equals(date).sortBy('createdAt'), [date])
  const settings = useLive(() => db.settings.get('main'))
  const [editing, setEditing] = useState<Entry>()

  const target = effectiveTargets(settings)
  const totals = sum((entries ?? []).map((e) => forGrams(e.per100g, e.grams)))
  const left = target ? target.kcal - totals.kcal : undefined

  return (
    <div class="screen">
      <header class="header">
        <button class="icon-btn" onClick={() => props.setDate(shiftDate(date, -1))} aria-label="Предыдущий день">
          ‹
        </button>
        <h1>
          <button class="link" onClick={() => props.setDate(todayISO())}>
            {dateLabel(date)}
          </button>
        </h1>
        <button class="icon-btn" onClick={() => props.setDate(shiftDate(date, 1))} aria-label="Следующий день">
          ›
        </button>
      </header>

      <section class="card summary">
        {left !== undefined && (
          <div class="left">
            <span class={left < 0 ? 'left-num over' : 'left-num'}>{fmt(Math.abs(left))}</span>
            <span class="muted">{left < 0 ? 'ккал сверх цели' : 'ккал осталось'}</span>
          </div>
        )}
        <Bar big label="Калории" value={totals.kcal} max={target?.kcal ?? 0} unit="ккал" />
        <div class="macro-bars">
          <Bar label="Белки" value={totals.protein} max={target?.protein ?? 0} unit="г" />
          <Bar label="Жиры" value={totals.fat} max={target?.fat ?? 0} unit="г" />
          <Bar label="Углеводы" value={totals.carbs} max={target?.carbs ?? 0} unit="г" />
        </div>
        {!target && <p class="muted small">Задайте цель на вкладке «Цель», чтобы видеть остаток.</p>}
      </section>

      <ul class="list">
        {entries?.map((e) => {
          const n = forGrams(e.per100g, e.grams)
          return (
            <li key={e.id}>
              <button class="list-item" onClick={() => setEditing(e)}>
                <span class="li-main">
                  <span class="li-title">{e.name}</span>
                  <span class="li-sub">
                    {fmt(e.grams)} г · <Macros n={n} compact />
                  </span>
                </span>
                <span class="li-kcal">{fmt(n.kcal)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {entries?.length === 0 && <p class="empty">Пока ничего не записано</p>}

      <button class="fab" onClick={() => props.nav.push({ name: 'add', date })} aria-label="Добавить еду">
        +
      </button>

      {editing && (
        <GramsSheet
          title={editing.name}
          per100g={editing.per100g}
          initialGrams={editing.grams}
          submitLabel="Сохранить"
          onClose={() => setEditing(undefined)}
          onSubmit={async (grams) => {
            await db.entries.update(editing.id, { grams })
            setEditing(undefined)
          }}
          onDelete={async () => {
            await db.entries.delete(editing.id)
            setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}
