import { useState } from 'preact/hooks'
import type { Nav } from '../App'
import { forGrams } from '../calc'
import { addEntry, db, entryFor, saveProduct } from '../db'
import { fmt, Header, Macros, useAutoFocus } from '../ui'
import { AmountFields, useAmount } from './GramsSheet'
import { LabelFields, useLabel } from './LabelFields'

/**
 * Ready-made food: values straight from the label (usually per portion, often without
 * the portion weight) and how many portions were eaten — in one screen.
 */
export function ReadyMeal(props: { date: string; nav: Nav; onDone: () => void }) {
  const [name, setName] = useState('')
  const [save, setSave] = useState(true)
  const label = useLabel({ basis: 'portion' })
  const amount = useAmount(label.stored)
  const nameRef = useAutoFocus<HTMLInputElement>(true)

  const n = forGrams(label.stored, amount.amount?.grams ?? 0)
  const title = name.trim()
  const valid = label.valid && !!amount.amount

  async function submit(e: Event) {
    e.preventDefault()
    if (!valid) return
    if (save && title) {
      const id = await saveProduct({ name: title, ...label.stored })
      await addEntry((await db.products.get(id))!, amount.amount!, props.date)
    } else {
      await db.entries.add(entryFor({ name: title || 'Готовая еда', ...label.stored }, amount.amount!, props.date))
    }
    props.onDone()
  }

  return (
    <div class="screen">
      <Header title="Готовая еда" onBack={props.nav.pop} />
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">Название</span>
          <input
            ref={nameRef}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Бизнес-ланч, «Самокат» паста карбонара"
          />
        </label>

        <h2 class="section-title">С этикетки</h2>
        <LabelFields label={label} portionHint="Вес не обязателен — посчитаем порциями." />

        <h2 class="section-title">Сколько съели</h2>
        <AmountFields amount={amount} />

        <div class="card preview">
          <strong>{fmt(n.kcal)} ккал</strong>
          <Macros n={n} />
        </div>

        <label class="check">
          <input type="checkbox" checked={save && !!title} disabled={!title} onChange={(e) => setSave(e.currentTarget.checked)} />
          <span>
            Сохранить в справочник
            <span class="muted small"> {title ? '— в следующий раз найдётся в поиске' : '— укажите название'}</span>
          </span>
        </label>

        <button type="submit" class="btn primary" disabled={!valid}>
          Записать в дневник
        </button>
      </form>
    </div>
  )
}
