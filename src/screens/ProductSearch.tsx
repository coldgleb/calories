import { useRef, useState } from 'preact/hooks'
import type { Nutrition } from '../calc'
import { db, useLive, type Product } from '../db'
import { lookupBarcode, searchOff, type OffProduct } from '../off'
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

type OffState =
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; hits: OffProduct[] }
  | { status: 'error'; query: string; message: string }

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
  const [off, setOff] = useState<OffState>()
  const offAbort = useRef<AbortController>()
  const inputRef = useAutoFocus<HTMLInputElement>(props.autoFocus)
  const all = useLive(() => db.products.toArray())
  const q = query.trim().toLowerCase()

  const list = (all ?? [])
    .filter((p) => !props.exclude?.includes(p.id))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.barcode === q)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.usageCount - a.usageCount || a.name.localeCompare(b.name, 'ru'))

  async function searchInOff() {
    const text = query.trim()
    if (text.length < 2) return
    offAbort.current?.abort()
    const ctrl = (offAbort.current = new AbortController())
    setOff({ status: 'loading', query: text })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, 20000)
    try {
      const hits = await searchOff(text, ctrl.signal)
      if (!ctrl.signal.aborted) setOff({ status: 'done', query: text, hits })
    } catch (e) {
      if (ctrl.signal.aborted && !timedOut) return
      setOff({
        status: 'error',
        query: text,
        message: !navigator.onLine
          ? 'Нет интернета.'
          : timedOut
            ? 'Open Food Facts не ответил, попробуйте ещё раз.'
            : (e as Error).message,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async function pickOff(hit: OffProduct) {
    const local = hit.code ? await db.products.where('barcode').equals(hit.code).first() : undefined
    if (local && !props.exclude?.includes(local.id)) props.onPick(local)
    else props.onCreate({ name: hit.name, barcode: hit.code, prefill: hit.per100g, fromOff: true })
  }

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
          enterKeyHint="search"
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            offAbort.current?.abort()
            setOff(undefined)
          }}
          onKeyDown={(e) => {
            // Enter with nothing found locally goes straight to Open Food Facts.
            if (e.key === 'Enter' && list.length === 0) searchInOff()
          }}
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
      {all && list.length === 0 && !off && (
        <p class="empty">{q ? 'В справочнике ничего не найдено' : props.emptyHint ?? 'Справочник пуст'}</p>
      )}

      {q.length >= 2 && !off && (
        <button class="list-item off-search" onClick={searchInOff}>
          <span class="li-title">🔍 Найти «{query.trim()}» в Open Food Facts</span>
        </button>
      )}
      {off && (
        <section class="off-results">
          <h2 class="section-title">Open Food Facts</h2>
          {off.status === 'loading' && <p class="muted">Ищу «{off.query}»…</p>}
          {off.status === 'error' && (
            <div class="row">
              <p class="error grow">{off.message}</p>
              <button class="btn" onClick={searchInOff}>
                Повторить
              </button>
            </div>
          )}
          {off.status === 'done' && off.hits.length === 0 && (
            <p class="muted">Ничего не найдено. Попробуйте короче: «творог простоквашино», а не полное название.</p>
          )}
          {off.status === 'done' && off.hits.length > 0 && (
            <>
              <ul class="list flush">
                {off.hits.map((h) => (
                  <li key={h.code}>
                    <button class="list-item" onClick={() => pickOff(h)}>
                      <span class="li-main">
                        <span class="li-title">{h.title}</span>
                        <span class="li-sub">
                          {[h.brand, h.quantity].filter(Boolean).join(' · ') || 'без бренда'}
                          {h.per100g && (
                            <>
                              {' · '}
                              <Macros n={h.per100g} compact />
                            </>
                          )}
                        </span>
                      </span>
                      <span class={h.per100g ? 'li-kcal' : 'li-kcal muted'}>{h.per100g ? fmt(h.per100g.kcal) : 'нет КБЖУ'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p class="muted small">Данные вносят пользователи OFF — сверяйте с этикеткой.</p>
            </>
          )}
        </section>
      )}

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
