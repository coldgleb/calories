import { useEffect, useState } from 'preact/hooks'
import type { Nav } from '../App'
import { db, recipesUsing, saveProduct } from '../db'
import { Header, useAutoFocus } from '../ui'
import { LabelFields, useLabel } from './LabelFields'
import { OffContribute } from './OffContribute'
import type { NewProduct } from './ProductSearch'


/** "Творог 5%, «Простоквашино»" → name and brand, the way products from OFF are named. */
export function splitBrand(full: string): { name: string; brand?: string } {
  const m = full.match(/^(.*?)[,\s]*«([^»]+)»\s*$/)
  return m && m[1].trim() ? { name: m[1].trim(), brand: m[2].trim() } : { name: full.trim() }
}

export function ProductForm(props: { id?: number; draft?: NewProduct; then?: (id: number) => void; nav: Nav }) {
  const draft = props.draft
  const [name, setName] = useState(draft?.name ?? '')
  const [barcode, setBarcode] = useState(draft?.barcode ?? '')
  const label = useLabel({ values: draft?.prefill, portionGrams: draft?.portionGrams })
  const [error, setError] = useState('')
  const [contributing, setContributing] = useState(false)
  const nameRef = useAutoFocus<HTMLInputElement>(!props.id && !draft?.name)

  useEffect(() => {
    if (!props.id) return
    db.products.get(props.id).then((p) => {
      if (!p) return
      setName(p.name)
      setBarcode(p.barcode ?? '')
      label.load({ basis: p.portionOnly ? 'portion' : 'per100', values: p, portionGrams: p.portionGrams })
    })
  }, [props.id])

  const valid = name.trim() !== '' && label.valid

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
    if (props.id && label.stored.portionOnly) {
      const used = await recipesUsing(props.id)
      if (used.length) {
        setError(`Продукт есть в рецептах (${used.map((r) => r.name).join(', ')}), для них нужен вес порции.`)
        return
      }
    }
    const id = await saveProduct({ name: name.trim(), barcode: code || undefined, ...label.stored }, props.id)
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

        <LabelFields label={label} focusKcal={!!draft?.name && !draft.prefill} />
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
        {props.id && !label.stored.portionOnly && (
          <button type="button" class="btn" disabled={!valid} onClick={() => setContributing(true)}>
            Отправить в Open Food Facts
          </button>
        )}
      </form>

      {contributing && props.id && (
        <OffContribute
          {...splitBrand(name)}
          barcode={barcode.replace(/\D/g, '')}
          per100g={label.stored}
          onClose={() => setContributing(false)}
          onSaved={async (code) => {
            // Remember the barcode so the next scan finds this product locally.
            if (!barcode) {
              setBarcode(code)
              await db.products.update(props.id!, { barcode: code })
            }
          }}
        />
      )}
    </div>
  )
}
