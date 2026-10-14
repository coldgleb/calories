import { useEffect, useState } from 'preact/hooks'
import type { Nav } from '../App'
import { portionToPer100, type Nutrition } from '../calc'
import { db, recipesUsing, saveProduct } from '../db'
import { fmt, fmt1, Header, NumField, parseNum, useAutoFocus } from '../ui'
import type { NewProduct } from './ProductSearch'

type Mode = 'per100' | 'portion'

const prefilled = (v: number | undefined) => (v ? fmt1(v) : '')

export function ProductForm(props: { id?: number; draft?: NewProduct; then?: (id: number) => void; nav: Nav }) {
  const draft = props.draft
  const [name, setName] = useState(draft?.name ?? '')
  const [barcode, setBarcode] = useState(draft?.barcode ?? '')
  const [mode, setMode] = useState<Mode>('per100')
  const [portion, setPortion] = useState('')
  const [kcal, setKcal] = useState(prefilled(draft?.prefill?.kcal))
  const [protein, setProtein] = useState(prefilled(draft?.prefill?.protein))
  const [fat, setFat] = useState(prefilled(draft?.prefill?.fat))
  const [carbs, setCarbs] = useState(prefilled(draft?.prefill?.carbs))
  const [error, setError] = useState('')
  const nameRef = useAutoFocus<HTMLInputElement>(!props.id && !draft?.name)

  useEffect(() => {
    if (!props.id) return
    db.products.get(props.id).then((p) => {
      if (!p) return
      setName(p.name)
      setBarcode(p.barcode ?? '')
      setKcal(fmt1(p.kcal))
      setProtein(fmt1(p.protein))
      setFat(fmt1(p.fat))
      setCarbs(fmt1(p.carbs))
    })
  }, [props.id])

  const p = parseNum(protein) ?? 0
  const f = parseNum(fat) ?? 0
  const c = parseNum(carbs) ?? 0
  const kcalFromMacros = p * 4 + f * 9 + c * 4
  const entered: Nutrition = { kcal: parseNum(kcal) ?? kcalFromMacros, protein: p, fat: f, carbs: c }
  const portionG = parseNum(portion) ?? 0
  const per100 = mode === 'portion' ? portionToPer100(entered, portionG) : entered
  const valid = name.trim() !== '' && (mode === 'per100' || portionG > 0) && per100.kcal > 0

  async function save(e: Event) {
    e.preventDefault()
    if (!valid) return
    const code = barcode.replace(/\D/g, '')
    if (code) {
      const other = await db.products.where('barcode').equals(code).first()
      if (other && other.id !== props.id) {
        setError(`Этот штрихкод уже у продукта «${other.name}».`)
        return
      }
    }
    const id = await saveProduct({ name: name.trim(), barcode: code || undefined, ...per100 }, props.id)
    props.nav.pop()
    props.then?.(id)
  }

  async function remove() {
    if (!props.id) return
    const used = await recipesUsing(props.id)
    if (used.length) {
      setError(`Продукт используется в рецептах: ${used.map((r) => r.name).join(', ')}. Сначала уберите его оттуда.`)
      return
    }
    if (!confirm(`Удалить «${name}» из справочника? Записи в дневнике останутся.`)) return
    await db.products.delete(props.id)
    props.nav.pop()
  }

  return (
    <div class="screen">
      <Header title={props.id ? 'Продукт' : 'Новый продукт'} onBack={props.nav.pop} />
      <form class="form" onSubmit={save}>
        <label class="field">
          <span class="field-label">Название</span>
          <input
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Творог 5%, «Простоквашино»"
            ref={nameRef}
          />
        </label>

        {draft?.fromOff && (
          <p class="warn">
            Данные из Open Food Facts — их вносят пользователи. Сверьте КБЖУ с этикеткой.
            {!draft.prefill && ' КБЖУ в базе нет, введите вручную.'}
          </p>
        )}
        {draft?.barcode && !draft.fromOff && (
          <p class="muted small">Штрихкода {draft.barcode} нет в базе. Введите КБЖУ с этикетки — в следующий раз продукт найдётся сразу.</p>
        )}

        <div class="segmented" role="radiogroup">
          <button type="button" class={mode === 'per100' ? 'active' : ''} onClick={() => setMode('per100')}>
            На 100 г
          </button>
          <button type="button" class={mode === 'portion' ? 'active' : ''} onClick={() => setMode('portion')}>
            На порцию
          </button>
        </div>

        {mode === 'portion' && <NumField label="Вес порции" value={portion} onInput={setPortion} suffix="г" />}

        <NumField
          label="Калории"
          value={kcal}
          onInput={setKcal}
          suffix="ккал"
          autoFocus={!!draft?.name && !draft.prefill}
          placeholder={kcalFromMacros ? fmt(kcalFromMacros) : '0'}
        />
        <div class="grid3">
          <NumField label="Белки" value={protein} onInput={setProtein} suffix="г" />
          <NumField label="Жиры" value={fat} onInput={setFat} suffix="г" />
          <NumField label="Углеводы" value={carbs} onInput={setCarbs} suffix="г" />
        </div>
        {!kcal && kcalFromMacros > 0 && <p class="muted small">Калории не указаны — посчитаны по БЖУ.</p>}
        {mode === 'portion' && portionG > 0 && (
          <p class="muted small">
            На 100 г: {fmt(per100.kcal)} ккал · Б {fmt1(per100.protein)} · Ж {fmt1(per100.fat)} · У {fmt1(per100.carbs)}
          </p>
        )}
        <label class="field">
          <span class="field-label">Штрихкод (необязательно)</span>
          <input
            inputMode="numeric"
            value={barcode}
            onInput={(e) => setBarcode(e.currentTarget.value)}
            placeholder="4600000000000"
          />
        </label>
        {error && <p class="error">{error}</p>}

        <div class="row">
          {props.id && (
            <button type="button" class="btn danger" onClick={remove}>
              Удалить
            </button>
          )}
          <button type="submit" class="btn primary grow" disabled={!valid}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  )
}
