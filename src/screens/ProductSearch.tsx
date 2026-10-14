import { useRef, useState } from 'preact/hooks'
import type { Nutrition } from '../calc'
import { db, useLive, type Product } from '../db'
import { lookupBarcode } from '../off'
import { fmt, Macros, Sheet, useAutoFocus } from '../ui'
import { Scanner } from './Scanner'

/** What we know about a product that is about to be created. */
export interface NewProduct {
  name: string
  barcode?: string
  prefill?: Nutrition
  /** Values came from Open Food Facts and should be checked against the label. */
  fromOff?: boolean
}

type ScanState =
  | { step: 'camera' }
  | { step: 'lookup'; code: string }
  | { step: 'error'; code: string; message: string }

export function ProductSearch(props: {
  onPick: (p: Product) => void
  onCreate: (p: NewProduct) => void
  /** Products that can't be picked, e.g. the recipe itself. */
  exclude?: number[]
  emptyHint?: string
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const [scan, setScan] = useState<ScanState>()
  // Bumped on every lookup and on close, so a late answer for a dismissed scan is ignored.
  const lookupId = useRef(0)
  const inputRef = useAutoFocus<HTMLInputElement>(props.autoFocus)
  const all = useLive(() => db.products.toArray())
  const q = query.trim().toLowerCase()

  const list = (all ?? [])
    .filter((p) => !props.exclude?.includes(p.id))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.barcode === q)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.usageCount - a.usageCount || a.name.localeCompare(b.name, 'ru'))

  async function onDetected(code: string) {
    const local = await db.products.where('barcode').equals(code).first()
    if (local && !props.exclude?.includes(local.id)) {
      setScan(undefined)
      props.onPick(local)
      return
    }
    setScan({ step: 'lookup', code })
    const id = ++lookupId.current
    try {
      const found = await lookupBarcode(code, AbortSignal.timeout(10000))
      if (id !== lookupId.current) return
      setScan(undefined)
      props.onCreate(
        found
          ? { name: found.name, barcode: code, prefill: found.per100g, fromOff: true }
          : { name: '', barcode: code },
      )
    } catch (e) {
      if (id !== lookupId.current) return
      setScan({
        step: 'error',
        code,
        message: navigator.onLine ? (e as Error).message : 'Нет интернета, базу штрихкодов проверить не удалось.',
      })
    }
  }

  return (
    <>
      <div class="search">
        <input
          type="search"
          placeholder="Поиск продукта или рецепта"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          ref={inputRef}
        />
        <button class="btn scan-btn" onClick={() => setScan({ step: 'camera' })} aria-label="Сканировать штрихкод">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16 8v8"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <button class="list-item create" onClick={() => props.onCreate({ name: query.trim() })}>
        <span class="li-title">＋ Новый продукт{query.trim() && ` «${query.trim()}»`}</span>
      </button>
      <ul class="list">
        {list.map((p) => (
          <li key={p.id}>
            <button class="list-item" onClick={() => props.onPick(p)}>
              <span class="li-main">
                <span class="li-title">
                  {p.kind === 'recipe' && <span class="badge">рецепт</span>}
                  {p.name}
                </span>
                <span class="li-sub">
                  на 100 г · <Macros n={p} compact />
                </span>
              </span>
              <span class="li-kcal">{fmt(p.kcal)}</span>
            </button>
          </li>
        ))}
      </ul>
      {all && list.length === 0 && <p class="empty">{q ? 'Ничего не найдено' : props.emptyHint ?? 'Справочник пуст'}</p>}

      {scan?.step === 'camera' && <Scanner onDetected={onDetected} onClose={() => setScan(undefined)} />}
      {scan?.step === 'lookup' && (
        <Sheet
          onClose={() => {
            lookupId.current++
            setScan(undefined)
          }}
        >
          <h2 class="sheet-title">Штрихкод {scan.code}</h2>
          <p class="muted">Ищу в Open Food Facts…</p>
        </Sheet>
      )}
      {scan?.step === 'error' && (
        <Sheet onClose={() => setScan(undefined)}>
          <h2 class="sheet-title">Штрихкод {scan.code}</h2>
          <p class="error">{scan.message}</p>
          <div class="row">
            <button class="btn" onClick={() => onDetected(scan.code)}>
              Повторить
            </button>
            <button
              class="btn primary grow"
              onClick={() => {
                setScan(undefined)
                props.onCreate({ name: '', barcode: scan.code })
              }}
            >
              Ввести вручную
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
