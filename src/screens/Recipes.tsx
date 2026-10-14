import type { Nav } from '../App'
import { db, useLive } from '../db'
import { fmt, Header, Macros } from '../ui'

export function Recipes(props: { nav: Nav }) {
  const recipes = useLive(async () => {
    const list = await db.recipes.orderBy('name').toArray()
    const products = await db.products.bulkGet(list.map((r) => r.productId))
    return list.map((r, i) => ({ recipe: r, product: products[i] }))
  })

  return (
    <div class="screen">
      <Header title="Рецепты" />
      <button class="list-item create" onClick={() => props.nav.push({ name: 'recipe' })}>
        <span class="li-title">＋ Новый рецепт</span>
      </button>
      <ul class="list">
        {recipes?.map(({ recipe, product }) => (
          <li key={recipe.id}>
            <button class="list-item" onClick={() => props.nav.push({ name: 'recipe', id: recipe.id })}>
              <span class="li-main">
                <span class="li-title">{recipe.name}</span>
                <span class="li-sub">
                  {recipe.ingredients.length} ингр.
                  {recipe.cookedWeight ? ` · готовое ${fmt(recipe.cookedWeight)} г` : ''}
                  {product && (
                    <>
                      {' '}
                      · <Macros n={product} compact />
                    </>
                  )}
                </span>
              </span>
              {product && <span class="li-kcal">{fmt(product.kcal)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {recipes?.length === 0 && (
        <p class="empty">
          Соберите блюдо из продуктов, укажите вес готового — получите КБЖУ на 100 г. Рецепт появится в поиске, как
          обычный продукт.
        </p>
      )}
    </div>
  )
}
