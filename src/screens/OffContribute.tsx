import { useEffect, useState } from 'preact/hooks'
import type { Nutrition } from '../calc'
import { lookupBarcode, offProductUrl, submitToOff, type OffProduct } from '../off'
import { fmt, fmt1, Sheet } from '../ui'

const USER_KEY = 'off-user'

function savedUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Sends one of the user's products to Open Food Facts under their own OFF account. */
export function OffContribute(props: {
  name: string
  brand?: string
  barcode: string
  per100g: Nutrition
  onSaved: (barcode: string) => void
  onClose: () => void
}) {
  const [code, setCode] = useState(props.barcode)
  const [name, setName] = useState(props.name)
  const [brand, setBrand] = useState(props.brand ?? '')
  const [quantity, setQuantity] = useState('')
  const [user, setUser] = useState(savedUser)
  const [password, setPassword] = useState('')
  const [existing, setExisting] = useState<OffProduct | null>()
  const [state, setState] = useState<{ step: 'form' | 'sending' | 'done' } | { step: 'error'; message: string }>({
    step: 'form',
  })

  const digits = code.replace(/\D/g, '')
  const validCode = digits.length >= 8 && digits.length <= 14

  // Show what OFF already has for this barcode, so the user knows they'd be editing it.
  useEffect(() => {
    setExisting(undefined)
    if (!validCode) return
    const ctrl = new AbortController()
    lookupBarcode(digits, ctrl.signal)
      .then((p) => {
        setExisting(p)
        if (p?.brand) setBrand((b) => b || p.brand!)
        if (p?.quantity) setQuantity((q) => q || p.quantity!)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [digits])

  const canSend = validCode && name.trim() && user.trim() && password && state.step !== 'sending'

  async function send(e: Event) {
    e.preventDefault()
    if (!canSend) return
    setState({ step: 'sending' })
    try {
      await submitToOff(
        { code: digits, name: name.trim(), brand: brand.trim() || undefined, quantity: quantity.trim() || undefined, per100g: props.per100g },
        user.trim(),
        password,
      )
      try {
        localStorage.setItem(USER_KEY, user.trim())
      } catch {
        // not critical
      }
      setPassword('')
      setState({ step: 'done' })
      props.onSaved(digits)
    } catch (err) {
      setState({ step: 'error', message: navigator.onLine ? (err as Error).message : 'Нет интернета.' })
    }
  }

  if (state.step === 'done') {
    return (
      <Sheet onClose={props.onClose}>
        <h2 class="sheet-title">Спасибо!</h2>
        <p>Продукт отправлен в Open Food Facts. Изменения появятся в поиске через несколько минут.</p>
        <div class="row">
          <a class="btn grow" href={offProductUrl(digits)} target="_blank" rel="noopener">
            Открыть на сайте OFF
          </a>
          <button class="btn primary" onClick={props.onClose}>
            Готово
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={props.onClose}>
      <h2 class="sheet-title">Отправить в Open Food Facts</h2>
      <p class="muted small">
        На 100 г: {fmt(props.per100g.kcal)} ккал · Б {fmt1(props.per100g.protein)} · Ж {fmt1(props.per100g.fat)} · У{' '}
        {fmt1(props.per100g.carbs)}. Данные станут общедоступными под лицензией ODbL.
      </p>
      <form class="sheet-scroll" onSubmit={send}>
        <label class="field">
          <span class="field-label">Штрихкод</span>
          <input inputMode="numeric" value={code} onInput={(e) => setCode(e.currentTarget.value)} />
        </label>
        {existing && (
          <p class="warn">
            В OFF уже есть «{existing.title || 'без названия'}»
            {existing.per100g ? `, ${fmt(existing.per100g.kcal)} ккал на 100 г` : ', без КБЖУ'}. Ваши значения заменят
            текущие.
          </p>
        )}
        <label class="field">
          <span class="field-label">Название (без бренда)</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <div class="grid2">
          <label class="field">
            <span class="field-label">Производитель</span>
            <input value={brand} onInput={(e) => setBrand(e.currentTarget.value)} placeholder="Простоквашино" />
          </label>
          <label class="field">
            <span class="field-label">Вес/объём</span>
            <input value={quantity} onInput={(e) => setQuantity(e.currentTarget.value)} placeholder="200 г" />
          </label>
        </div>
        <p class="muted small">
          Нужен аккаунт на{' '}
          <a href="https://world.openfoodfacts.org/cgi/user.pl" target="_blank" rel="noopener">
            openfoodfacts.org
          </a>
          . Пароль уходит только в OFF и нигде не сохраняется.
        </p>
        <div class="grid2">
          <label class="field">
            <span class="field-label">Логин OFF</span>
            <input autoComplete="username" value={user} onInput={(e) => setUser(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="field-label">Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
        </div>
        {state.step === 'error' && <p class="error">{state.message}</p>}
        <button type="submit" class="btn primary" disabled={!canSend}>
          {state.step === 'sending' ? 'Отправляю…' : 'Отправить'}
        </button>
      </form>
    </Sheet>
  )
}
