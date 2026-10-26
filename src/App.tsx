import { useState } from 'preact/hooks'
import type { NewProduct } from './screens/ProductSearch'
import { todayISO } from './db'
import { Catalog } from './screens/Catalog'
import { Day } from './screens/Day'
import { ProductForm } from './screens/ProductForm'
import { RecipeEditor } from './screens/RecipeEditor'
import { Settings } from './screens/Settings'
import { Weight } from './screens/Weight'

type Tab = 'day' | 'catalog' | 'weight' | 'settings'

export type Screen =
  | { name: 'add'; date: string }
  | { name: 'product'; id?: number; draft?: NewProduct; then?: (id: number) => void }
  | { name: 'recipe'; id?: number; initialName?: string; then?: (productId: number) => void }

export interface Nav {
  push: (s: Screen) => void
  /** Closes the top `count` screens. */
  pop: (count?: number) => void
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'day', label: 'Дневник', icon: '📅' },
  { id: 'catalog', label: 'Справочник', icon: '🥫' },
  { id: 'weight', label: 'Вес', icon: '⚖️' },
  { id: 'settings', label: 'Цель', icon: '🎯' },
]

function renderScreen(s: Screen, nav: Nav) {
  switch (s.name) {
    case 'add':
      return <Catalog mode="pick" date={s.date} nav={nav} />
    case 'product':
      return <ProductForm id={s.id} draft={s.draft} then={s.then} nav={nav} />
    case 'recipe':
      return <RecipeEditor id={s.id} initialName={s.initialName} then={s.then} nav={nav} />
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('day')
  const [date, setDate] = useState(todayISO())
  const [stack, setStack] = useState<Screen[]>([])

  const nav: Nav = {
    push: (s) => setStack((st) => [...st, s]),
    // Also used directly as an onClick handler, so ignore non-numeric arguments.
    pop: (count?: unknown) => {
      const n = typeof count === 'number' ? count : 1
      setStack((st) => st.slice(0, Math.max(0, st.length - n)))
    },
  }

  // Screens below the top stay mounted (just hidden) so they keep their state.
  return (
    <>
      <div class="app" hidden={stack.length > 0}>
        <main class="content">
          {tab === 'day' && <Day date={date} setDate={setDate} nav={nav} />}
          {tab === 'catalog' && <Catalog mode="manage" nav={nav} />}
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
