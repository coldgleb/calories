import { useState } from 'preact/hooks'
import type { Nutrition } from '../calc'
import { fromLabel, type LabelBasis, type PortionInfo } from '../db'
import { fmt, fmt1, NumField, parseNum } from '../ui'

const prefilled = (v: number | undefined) => (v ? fmt1(v) : '')

export interface LabelInitial {
  basis?: LabelBasis
  values?: Nutrition
  portionGrams?: number
}

/** State of the "values from the label" fields: per 100 g or per portion, with an optional portion weight. */
export function useLabel(initial: LabelInitial = {}) {
  const [basis, setBasis] = useState<LabelBasis>(initial.basis ?? 'per100')
  const [portion, setPortion] = useState(prefilled(initial.portionGrams))
  const [kcal, setKcal] = useState(prefilled(initial.values?.kcal))
  const [protein, setProtein] = useState(prefilled(initial.values?.protein))
  const [fat, setFat] = useState(prefilled(initial.values?.fat))
  const [carbs, setCarbs] = useState(prefilled(initial.values?.carbs))

  const p = parseNum(protein) ?? 0
  const f = parseNum(fat) ?? 0
  const c = parseNum(carbs) ?? 0
  const kcalFromMacros = p * 4 + f * 9 + c * 4
  const entered: Nutrition = { kcal: parseNum(kcal) ?? kcalFromMacros, protein: p, fat: f, carbs: c }
  const portionGrams = parseNum(portion)
  const stored: Nutrition & PortionInfo = fromLabel(basis, entered, portionGrams)

  function load(l: LabelInitial) {
    if (l.basis) setBasis(l.basis)
    setPortion(prefilled(l.portionGrams))
    setKcal(prefilled(l.values?.kcal))
    setProtein(prefilled(l.values?.protein))
    setFat(prefilled(l.values?.fat))
    setCarbs(prefilled(l.values?.carbs))
  }

  return {
    basis, setBasis, portion, setPortion, kcal, setKcal, protein, setProtein, fat, setFat, carbs, setCarbs,
    kcalFromMacros, entered, portionGrams, stored, load,
    valid: entered.kcal > 0,
  }
}

export type LabelState = ReturnType<typeof useLabel>

export function LabelFields(props: { label: LabelState; focusValues?: boolean; portionHint?: string }) {
  const l = props.label
  const perPortion = l.basis === 'portion'
  return (
    <>
      <div class="segmented" role="radiogroup">
        <button type="button" class={perPortion ? '' : 'active'} onClick={() => l.setBasis('per100')}>
          На 100 г
        </button>
        <button type="button" class={perPortion ? 'active' : ''} onClick={() => l.setBasis('portion')}>
          На порцию
        </button>
      </div>

      <div class="grid3">
        <NumField label="Белки" value={l.protein} onInput={l.setProtein} suffix="г" autoFocus={props.focusValues} />
        <NumField label="Жиры" value={l.fat} onInput={l.setFat} suffix="г" />
        <NumField label="Углеводы" value={l.carbs} onInput={l.setCarbs} suffix="г" />
      </div>
      <NumField
        label="Калории"
        value={l.kcal}
        onInput={l.setKcal}
        suffix="ккал"
        placeholder={l.kcalFromMacros ? fmt(l.kcalFromMacros) : '0'}
      />
      {!l.kcal && l.kcalFromMacros > 0 && <p class="muted small">Калории не указаны — посчитаны по БЖУ.</p>}

      <NumField
        label={perPortion ? 'Вес порции (если указан)' : 'Вес порции (необязательно)'}
        value={l.portion}
        onInput={l.setPortion}
        suffix="г"
        placeholder="—"
      />
      <p class="muted small">
        {perPortion
          ? l.portionGrams
            ? `На 100 г: ${fmt(l.stored.kcal)} ккал · Б ${fmt1(l.stored.protein)} · Ж ${fmt1(l.stored.fat)} · У ${fmt1(l.stored.carbs)}`
            : props.portionHint ?? 'Без веса продукт будет считаться только порциями.'
          : 'С весом порции еду можно добавлять порциями, а не граммами.'}
      </p>
    </>
  )
}
