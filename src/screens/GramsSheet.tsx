import { useState } from 'preact/hooks'
import { forGrams, type Nutrition } from '../calc'
import { fmt, Macros, NumField, parseNum, Sheet } from '../ui'

export function GramsSheet(props: {
  title: string
  per100g: Nutrition
  initialGrams?: number
  submitLabel: string
  onSubmit: (grams: number) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [grams, setGrams] = useState(props.initialGrams ? String(props.initialGrams) : '')
  const g = parseNum(grams)
  const n = forGrams(props.per100g, g ?? 0)

  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">{props.title}</h2>
      <p class="muted small">
        на 100 г: {fmt(props.per100g.kcal)} ккал · <Macros n={props.per100g} compact />
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (g) props.onSubmit(g)
        }}
      >
        <NumField label="Сколько съели" value={grams} onInput={setGrams} suffix="г" autoFocus placeholder="100" />
        <div class="preview">
          <strong>{fmt(n.kcal)} ккал</strong>
          <Macros n={n} />
        </div>
        <div class="row">
          {props.onDelete && (
            <button type="button" class="btn danger" onClick={props.onDelete}>
              Удалить
            </button>
          )}
          <button type="submit" class="btn primary grow" disabled={!g}>
            {props.submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
