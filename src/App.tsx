import { useState } from 'preact/hooks'
import type { NewProduct } from './screens/ProductSearch'
import { todayISO } from './db'
import { AddFood } from './screens/AddFood'
import { Day } from './screens/Day'
import { ProductForm } from './screens/ProductForm'
import { Products } from './screens/Products'
import { RecipeEditor } from './screens/RecipeEditor'
import { Recipes } from './screens/Recipes'
import { Settings } from './screens/Settings'
import { Weight } from './screens/Weight'

type Tab = 'day' | 'products' | 'recipes' | 'weight' | 'settings'

export type Screen =
  | { name: 'add'; date: string }
  | { name: 'product'; id?: number; draft?: NewProduct; then?: (id: number) => void }
  | { name: 'recipe'; id?: number }

export interface Nav {
  push: (s: Screen) => void
  pop: () => void
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'day', label: 'Дневник', icon: '📅' },
  { id: 'products', label: 'Продукты', icon: '🥫' },
  { id: 'recipes', label: 'Рецепты', icon: '🍲' },
  { id: 'weight', label: 'Вес', icon: '⚖️' },
  { id: 'settings', label: 'Цель', icon: '🎯' },
]

function renderScreen(s: Screen, nav: Nav) {
  switch (s.name) {
    case 'add':
      return <AddFood date={s.date} nav={nav} />
    case 'product':
      return <ProductForm id={s.id} draft={s.draft} then={s.then} nav={nav} />
    case 'recipe':
      return <RecipeEditor id={s.id} nav={nav} />
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('day')
  const [date, setDate] = useState(todayISO())
  const [stack, setStack] = useState<Screen[]>([])

  const nav: Nav = {
    push: (s) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => st.slice(0, -1)),
  }

  // Screens below the top stay mounted (just hidden) so they keep their state.
  return (
    <>
      <div class="app" hidden={stack.length > 0}>
        <main class="content">
          {tab === 'day' && <Day date={date} setDate={setDate} nav={nav} />}
          {tab === 'products' && <Products nav={nav} />}
          {tab === 'recipes' && <Recipes nav={nav} />}
          {tab === 'weight' && <Weight />}
          {tab === 'settings' && <Settings />}
        </main>
        <nav class="tabbar">
          {TABS.map((t) => (
            <button key={t.id} class={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              <span class="tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {stack.map((s, i) => (
        <div key={i} class="app" hidden={i < stack.length - 1}>
          <main class="content">{renderScreen(s, nav)}</main>
        </div>
      ))}
    </>
  )
}
