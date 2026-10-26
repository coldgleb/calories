import { useEffect, useState } from 'preact/hooks'
import type { Nav } from '../App'
import { db, recipesUsing, saveProduct, type ProductKind } from '../db'
import { currentUserId, isAdmin } from '../sync'
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
  const [kind, setKind] = useState<Exclude<ProductKind, 'recipe'>>(draft?.kind ?? 'product')
  const ready = kind === 'ready'
  // Ready food labels usually give values per portion.
  const label = useLabel({
    basis: draft?.portionOnly || (ready && !draft?.prefill) ? 'portion' : 'per100',
    values: draft?.prefill,
    portionGrams: draft?.portionGrams,
  })
  const [error, setError] = useState('')
  const [contributing, setContributing] = useState(false)
  const [author, setAuthor] = useState<string>()
  const me = currentUserId()
  // Shared catalogue: only the author or an admin may change someone's food.
  const readOnly = !!props.id && !!author && author !== me && !isAdmin()
  const sharedByMe = !!props.id && !!me && author === me
  const nameRef = useAutoFocus<HTMLInputElement>(!props.id && !draft?.name)

  useEffect(() => {
    if (!props.id) return
    db.products.get(props.id).then((p) => {
      if (!p) return
      setName(p.name)
      setBarcode(p.barcode ?? '')
      if (p.kind !== 'recipe') setKind(p.kind)
      setAuthor(p.author)
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
    const id = await saveProduct({ name: name.trim(), barcode: code || undefined, ...label.stored }, props.id, kind)
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
    const where = sharedByMe ? 'из общего справочника — у всех пользователей' : 'из справочника'
    if (!confirm(`Удалить «${name}» ${where}? Записи в дневнике останутся.`)) return
    await db.products.delete(props.id)
    props.nav.pop()
  }

  return (
    <div class="screen">
      <Header
        title={props.id ? (ready ? 'Готовая еда' : 'Продукт') : ready ? 'Новая готовая еда' : 'Новый продукт'}
        onBack={props.nav.pop}
      />
      <form class="form" onSubmit={save}>
        {readOnly && (
          <p class="muted small">
            Это продукт из общего справочника, его добавил другой пользователь. Изменить его может только автор или
            администратор — но можно сделать свою копию.
          </p>
        )}
        <fieldset class="plain" disabled={readOnly}>
        <label class="field">
          <span class="field-label">Название</span>
          <input
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={ready ? 'Бизнес-ланч, паста карбонара «Самокат»' : 'Творог 5%, «Простоквашино»'}
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

        <LabelFields
          label={label}
          focusValues={!!draft?.name && !draft.prefill}
          portionHint={ready ? 'Вес не обязателен — посчитаем порциями.' : undefined}
        />
        <label class="field">
          <span class="field-label">Штрихкод (необязательно)</span>
          <input
            inputMode="numeric"
            value={barcode}
            onInput={(e) => setBarcode(e.currentTarget.value)}
            placeholder="4600000000000"
          />
        </label>
        </fieldset>
        {error && <p class="error">{error}</p>}

        {readOnly ? (
          <button
            type="button"
            class="btn primary"
            onClick={() =>
              props.nav.push({
                name: 'product',
                draft: {
                  name: name.trim(),
                  kind,
                  prefill: label.stored,
                  portionGrams: label.stored.portionGrams,
                  portionOnly: label.stored.portionOnly,
                },
              })
            }
          >
            Сделать свою копию
          </button>
        ) : (
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
        )}
        {sharedByMe && <p class="muted small">Вы автор: изменения увидят все пользователи.</p>}
        {props.id && !readOnly && !label.stored.portionOnly && (
          <button type="button" class="btn" disabled={!valid} onClick={() => setContributing(true)}>
            Отправить в Open Food Facts
          </button>
        )}
        {props.id && !readOnly && (
          <button
            type="button"
            class="btn link-btn"
            onClick={async () => {
              const next = ready ? 'product' : 'ready'
              await db.products.update(props.id!, { kind: next, updatedAt: Date.now() })
              setKind(next)
            }}
          >
            {ready ? 'Это продукт — перенести в «Продукты»' : 'Это готовая еда — перенести в «Готовую еду»'}
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
