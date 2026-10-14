import { useState } from 'preact/hooks'
import type { Nav } from '../App'
import { addEntry, db, type Product } from '../db'
import { Header } from '../ui'
import { GramsSheet } from './GramsSheet'
import { ProductSearch } from './ProductSearch'

export function AddFood(props: { date: string; nav: Nav }) {
  const [picked, setPicked] = useState<Product>()

  return (
    <div class="screen">
      <Header title="Добавить еду" onBack={props.nav.pop} />
      <ProductSearch
        autoFocus
        onPick={setPicked}
        onCreate={(draft) =>
          props.nav.push({
            name: 'product',
            draft,
            then: async (id) => setPicked(await db.products.get(id)),
          })
        }
        emptyHint="Справочник пуст. Добавьте первый продукт: название и КБЖУ с этикетки."
      />
      {picked && (
        <GramsSheet
          title={picked.name}
          per100g={picked}
          submitLabel="Добавить"
          onClose={() => setPicked(undefined)}
          onSubmit={async (grams) => {
            await addEntry(picked, grams, props.date)
            props.nav.pop()
          }}
        />
      )}
    </div>
  )
}
