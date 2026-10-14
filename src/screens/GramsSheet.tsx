import { useState } from 'preact/hooks'
import { forGrams, type Nutrition } from '../calc'
import { portionUnit, type Amount, type PortionInfo } from '../db'
import { fmt, fmt1, Macros, NumField, parseNum, Sheet } from '../ui'

const QUICK_PORTIONS = [0.5, 1, 1.5, 2]

export function portionWord(n: number): string {
  if (!Number.isInteger(n)) return 'порции'
  const n100 = n % 100
  const n10 = n % 10
  if (n10 === 1 && n100 !== 11) return 'порция'
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'порции'
  return 'порций'
}

const portionText = (n: number) => `${n === 0.5 ? '½' : fmt1(n)} ${portionWord(n)}`

/** "1 порция · 350 г", "½ порции" or "250 г". */
export function amountLabel(a: Amount & PortionInfo): string {
  if (a.portionOnly) return portionText(a.portions ?? a.grams / 100)
  if (a.portions != null) return `${portionText(a.portions)} · ${fmt(a.grams)} г`
  return `${fmt(a.grams)} г`
}

/** State of the "how much was eaten" input: portions when the food has them, otherwise grams. */
export function useAmount(portion: PortionInfo | undefined, initial?: Amount) {
  const unitG = portion ? portionUnit(portion) : undefined
  const portionOnly = !!portion?.portionOnly
  const [preferPortions, setPreferPortions] = useState(initial ? initial.portions != null || portionOnly : true)
  const [grams, setGrams] = useState(initial && !portionOnly ? String(initial.grams) : '')
  const [portions, setPortions] = useState(
    initial?.portions != null ? fmt1(initial.portions) : initial && unitG ? fmt1(initial.grams / unitG) : '1',
  )
  const byPortion = !!unitG && (portionOnly || preferPortions)

  let amount: Amount | undefined
  if (byPortion) {
    const p = parseNum(portions)
    amount = p ? { grams: p * unitG!, portions: p } : undefined
  } else {
    const g = parseNum(grams)
    amount = g ? { grams: g } : undefined
  }
  return { unitG, portionOnly, byPortion, setPreferPortions, grams, setGrams, portions, setPortions, amount }
}

export type AmountState = ReturnType<typeof useAmount>

export function AmountFields(props: { amount: AmountState; focusGrams?: boolean }) {
  const a = props.amount
  return (
    <>
      {a.unitG && !a.portionOnly && (
        <div class="segmented" role="radiogroup">
          <button type="button" class={a.byPortion ? 'active' : ''} onClick={() => a.setPreferPortions(true)}>
            Порции
          </button>
          <button type="button" class={a.byPortion ? '' : 'active'} onClick={() => a.setPreferPortions(false)}>
            Граммы
          </button>
        </div>
      )}
      {a.byPortion ? (
        <>
          <NumField label="Сколько порций съели" value={a.portions} onInput={a.setPortions} suffix="шт" />
          <div class="chips">
            {QUICK_PORTIONS.map((q) => (
              <button
                key={q}
                type="button"
                class={parseNum(a.portions) === q ? 'chip active' : 'chip'}
                onClick={() => a.setPortions(fmt1(q))}
              >
                {q === 0.5 ? '½' : fmt1(q)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <NumField label="Сколько съели" value={a.grams} onInput={a.setGrams} suffix="г" autoFocus={props.focusGrams} placeholder="100" />
      )}
    </>
  )
}

/** Asks how much was eaten, in grams or — for foods with a portion — in portions. */
export function GramsSheet(props: {
  title: string
  per100g: Nutrition
  portion?: PortionInfo
  initial?: Amount
  submitLabel: string
  onSubmit: (amount: Amount) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const a = useAmount(props.portion, props.initial)
  const n = forGrams(props.per100g, a.amount?.grams ?? 0)
  const perPortion = a.unitG ? forGrams(props.per100g, a.unitG) : undefined

  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">{props.title}</h2>
      <p class="muted small">
        {a.portionOnly ? (
          <>
            на порцию: {fmt(props.per100g.kcal)} ккал · <Macros n={props.per100g} compact />
          </>
        ) : (
          <>
            на 100 г: {fmt(props.per100g.kcal)} ккал · <Macros n={props.per100g} compact />
            {perPortion && ` · порция ${fmt(a.unitG!)} г = ${fmt(perPortion.kcal)} ккал`}
          </>
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (a.amount) props.onSubmit(a.amount)
        }}
      >
        <AmountFields amount={a} focusGrams />
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
          <button type="submit" class="btn primary grow" disabled={!a.amount}>
            {props.submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
