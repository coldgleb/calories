import { useEffect, useState } from 'preact/hooks'
import type { Nav } from '../App'
import { forGrams, recipePer100, sum } from '../calc'
import { db, deleteRecipe, saveRecipe, useLive, type Product, type RecipeIngredient } from '../db'
import { fmt, fmt1, Header, NumField, parseNum, useAutoFocus } from '../ui'
import { GramsSheet } from './GramsSheet'
import { ProductSearch } from './ProductSearch'

export function RecipeEditor(props: { id?: number; nav: Nav }) {
  const [name, setName] = useState('')
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([])
  const [cooked, setCooked] = useState('')
  const [productId, setProductId] = useState<number>()
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState<Product>()
  const [editingIdx, setEditingIdx] = useState<number>()
  const nameRef = useAutoFocus<HTMLInputElement>(!props.id)

  useEffect(() => {
    if (!props.id) return
    db.recipes.get(props.id).then((r) => {
      if (!r) return
      setName(r.name)
      setIngredients(r.ingredients)
      setCooked(r.cookedWeight ? String(r.cookedWeight) : '')
      setProductId(r.productId)
    })
  }, [props.id])

  const ids = ingredients.map((i) => i.productId).join(',')
  const products = useLive(
    async () => {
      const list = await db.products.bulkGet(ingredients.map((i) => i.productId))
      return new Map(list.filter((p): p is Product => !!p).map((p) => [p.id, p]))
    },
    [ids],
  )

  const rows = ingredients.map((i) => ({ ...i, product: products?.get(i.productId) }))
  const known = rows.filter((r) => r.product)
  const rawWeight = ingredients.reduce((w, i) => w + i.grams, 0)
  const total = sum(known.map((r) => forGrams(r.product!, r.grams)))
  const cookedWeight = parseNum(cooked)
  const per100 = recipePer100(
    known.map((r) => ({ per100g: r.product!, grams: r.grams })),
    cookedWeight,
  )
  const valid = name.trim() !== '' && ingredients.length > 0

  async function save(e: Event) {
    e.preventDefault()
    if (!valid) return
    await saveRecipe(name.trim(), ingredients, cookedWeight || undefined, props.id)
    props.nav.pop()
  }

  async function remove() {
    if (!props.id || !confirm(`Удалить рецепт «${name}»? Записи в дневнике останутся.`)) return
    await deleteRecipe(props.id)
    props.nav.pop()
  }

  if (picking) {
    return (
      <div class="screen">
        <Header title="Ингредиент" onBack={() => setPicking(false)} />
        <ProductSearch
          autoFocus
          exclude={productId ? [productId] : []}
          onPick={(p) => {
            setPicking(false)
            setAdding(p)
          }}
          onCreate={(draft) =>
            props.nav.push({
              name: 'product',
              draft,
              then: async (id) => {
                setPicking(false)
                setAdding(await db.products.get(id))
              },
            })
          }
        />
      </div>
    )
  }

  const editing = editingIdx !== undefined ? rows[editingIdx] : undefined

  return (
    <div class="screen">
      <Header title={props.id ? 'Рецепт' : 'Новый рецепт'} onBack={props.nav.pop} />
      <form class="form" onSubmit={save}>
        <label class="field">
          <span class="field-label">Название</span>
          <input ref={nameRef} value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Плов" />
        </label>

        <h2 class="section-title">Ингредиенты (сырой вес)</h2>
        <ul class="list flush">
          {rows.map((r, idx) => (
            <li key={idx}>
              <button type="button" class="list-item" onClick={() => setEditingIdx(idx)}>
                <span class="li-main">
                  <span class="li-title">{r.product?.name ?? 'Удалённый продукт'}</span>
                  <span class="li-sub">{fmt(r.grams)} г</span>
                </span>
                <span class="li-kcal">{r.product ? fmt(forGrams(r.product, r.grams).kcal) : '—'}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn" onClick={() => setPicking(true)}>
          ＋ Добавить ингредиент
        </button>

        <NumField
          label="Вес готового блюда"
          value={cooked}
          onInput={setCooked}
          suffix="г"
          placeholder={rawWeight ? fmt(rawWeight) : 'взвесьте кастрюлю без крышки…'}
        />
        <p class="muted small">
          Взвесьте блюдо после готовки (без посуды). Если не указать, возьмём сумму сырых весов —{' '}
          {fmt(rawWeight)} г.
        </p>

        <div class="card result">
          <div>
            <span class="muted small">Всего в блюде</span>
            <strong>{fmt(total.kcal)} ккал</strong>
          </div>
          <div>
            <span class="muted small">На 100 г готового</span>
            <strong>{fmt(per100.kcal)} ккал</strong>
            <span class="small">
              Б {fmt1(per100.protein)} · Ж {fmt1(per100.fat)} · У {fmt1(per100.carbs)}
            </span>
          </div>
        </div>

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

      {adding && (
        <GramsSheet
          title={adding.name}
          per100g={adding}
          submitLabel="В рецепт"
          onClose={() => setAdding(undefined)}
          onSubmit={(grams) => {
            setIngredients((list) => [...list, { productId: adding.id, grams }])
            setAdding(undefined)
          }}
        />
      )}
      {editing && (
        <GramsSheet
          title={editing.product?.name ?? 'Ингредиент'}
          per100g={editing.product ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 }}
          initialGrams={editing.grams}
          submitLabel="Сохранить"
          onClose={() => setEditingIdx(undefined)}
          onSubmit={(grams) => {
            setIngredients((list) => list.map((i, idx) => (idx === editingIdx ? { ...i, grams } : i)))
            setEditingIdx(undefined)
          }}
          onDelete={() => {
            setIngredients((list) => list.filter((_, idx) => idx !== editingIdx))
            setEditingIdx(undefined)
          }}
        />
      )}
    </div>
  )
}
