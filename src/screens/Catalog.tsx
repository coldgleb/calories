import { useState } from 'preact/hooks'
import type { Nav } from '../App'
import { addEntry, db, type Product, type ProductKind } from '../db'
import { Header } from '../ui'
import { GramsSheet } from './GramsSheet'
import { ProductSearch, type NewProduct } from './ProductSearch'

const SECTIONS: {
  kind: ProductKind
  label: string
  create: string
  placeholder: string
  empty: string
}[] = [
  {
    kind: 'product',
    label: 'Продукты',
    create: 'Новый продукт',
    placeholder: 'Поиск продукта',
    empty: 'Продукты с этикетки или из Open Food Facts. Значения — на 100 г.',
  },
  {
    kind: 'recipe',
    label: 'Рецепты',
    create: 'Новый рецепт',
    placeholder: 'Поиск рецепта',
    empty: 'Ваши блюда: соберите из продуктов, укажите вес готового и число порций.',
  },
  {
    kind: 'ready',
    label: 'Готовая еда',
    create: 'Новая готовая еда',
    placeholder: 'Поиск готовой еды',
    empty: 'Ланчи, доставка, полуфабрикаты — КБЖУ на порцию, вес не обязателен.',
  },
]

const SECTION_KEY = 'catalog-section'

function savedSection(): ProductKind {
  try {
    const v = localStorage.getItem(SECTION_KEY)
    return SECTIONS.some((s) => s.kind === v) ? (v as ProductKind) : 'product'
  } catch {
    return 'product'
  }
}

/**
 * The food catalogue: products and ready food (shared, also searchable in Open Food Facts)
 * and personal recipes. In "pick" mode a tap logs the food for `date`, in "manage" mode it
 * opens the editor.
 */
export function Catalog(props: { mode: 'pick' | 'manage'; date?: string; nav: Nav }) {
  const [section, setSection] = useState<ProductKind>(savedSection)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Product>()
  const pick = props.mode === 'pick'
  const current = SECTIONS.find((s) => s.kind === section)!

  function choose(kind: ProductKind) {
    setSection(kind)
    try {
      localStorage.setItem(SECTION_KEY, kind)
    } catch {
      // not critical
    }
  }

  // After creating something from "+", go straight to "how much did you eat".
  const thenLog = pick ? async (productId: number) => setPicked(await db.products.get(productId)) : undefined

  function open(p: Product) {
    if (pick) setPicked(p)
    else if (p.kind === 'recipe') props.nav.push({ name: 'recipe', id: p.recipeId })
    else props.nav.push({ name: 'product', id: p.id })
  }

  function create(draft: NewProduct) {
    if (section === 'recipe') props.nav.push({ name: 'recipe', initialName: draft.name, then: thenLog })
    else props.nav.push({ name: 'product', draft, then: thenLog })
  }

  return (
    <div class="screen">
      <Header title={pick ? 'Добавить еду' : 'Справочник'} onBack={pick ? props.nav.pop : undefined} />
      <div class="segmented catalog-tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button
            key={s.kind}
            type="button"
            role="tab"
            aria-selected={s.kind === section}
            class={s.kind === section ? 'active' : ''}
            onClick={() => choose(s.kind)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ProductSearch
        // Remount per section so scanner and Open Food Facts state don't leak between them.
        key={section}
        autoFocus={pick}
        query={query}
        onQuery={setQuery}
        kinds={[section]}
        draftKind={section === 'recipe' ? undefined : section}
        offline={section === 'recipe'}
        createLabel={current.create}
        placeholder={current.placeholder}
        emptyHint={current.empty}
        onPick={open}
        onCreate={create}
      />
      {picked && props.date && (
        <GramsSheet
          title={picked.name}
          per100g={picked}
          portion={picked}
          submitLabel="Добавить"
          onClose={() => setPicked(undefined)}
          onSubmit={async (amount) => {
            await addEntry(picked, amount, props.date!)
            props.nav.pop()
          }}
        />
      )}
    </div>
  )
}
