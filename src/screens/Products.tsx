import type { Nav } from '../App'
import { Header } from '../ui'
import { ProductSearch } from './ProductSearch'

export function Products(props: { nav: Nav }) {
  return (
    <div class="screen">
      <Header title="Продукты" />
      <ProductSearch
        onPick={(p) =>
          p.kind === 'recipe'
            ? props.nav.push({ name: 'recipe', id: p.recipeId })
            : props.nav.push({ name: 'product', id: p.id })
        }
        onCreate={(draft) => props.nav.push({ name: 'product', draft })}
        emptyHint="Здесь будут продукты, которые вы едите. Значения — на 100 г."
      />
    </div>
  )
}
