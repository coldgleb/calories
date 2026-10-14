import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { round1, type Nutrition } from './calc'

export function fmt(n: number): string {
  return String(Math.round(n))
}

export function fmt1(n: number): string {
  return String(round1(n)).replace('.', ',')
}

/** Parses user input, accepting both "1,5" and "1.5". */
export function parseNum(s: string): number | undefined {
  const t = s.trim().replace(',', '.')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function Macros({ n, compact }: { n: Nutrition; compact?: boolean }) {
  return (
    <span class={compact ? 'macros compact' : 'macros'}>
      <span>Б {fmt1(n.protein)}</span>
      <span>Ж {fmt1(n.fat)}</span>
      <span>У {fmt1(n.carbs)}</span>
    </span>
  )
}

/** `autofocus` is ignored for elements inserted after page load, so focus manually. */
export function useAutoFocus<T extends HTMLElement>(enabled = false) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (enabled) ref.current?.focus()
  }, [])
  return ref
}

export function NumField(props: {
  label: string
  value: string
  onInput: (v: string) => void
  suffix?: string
  autoFocus?: boolean
  placeholder?: string
}) {
  const ref = useAutoFocus<HTMLInputElement>(props.autoFocus)
  const invalid = props.value.trim() !== '' && parseNum(props.value) === undefined
  return (
    <label class={invalid ? 'field invalid' : 'field'}>
      <span class="field-label">{props.label}</span>
      <span class="field-input">
        <input
          ref={ref}
          inputMode="decimal"
          enterKeyHint="done"
          value={props.value}
          placeholder={props.placeholder ?? '0'}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {props.suffix && <span class="suffix">{props.suffix}</span>}
      </span>
    </label>
  )
}

export function Header(props: { title: string; onBack?: () => void; action?: ComponentChildren }) {
  return (
    <header class="header">
      {props.onBack ? (
        <button class="icon-btn" onClick={props.onBack} aria-label="Назад">
          ←
        </button>
      ) : (
        <span class="icon-spacer" />
      )}
      <h1>{props.title}</h1>
      {props.action ?? <span class="icon-spacer" />}
    </header>
  )
}

export function Sheet(props: { onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true">
        {props.children}
      </div>
    </div>
  )
}

export function Bar(props: { value: number; max: number; label: string; unit: string; big?: boolean }) {
  const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0
  const over = props.max > 0 && props.value > props.max
  return (
    <div class={props.big ? 'bar big' : 'bar'}>
      <div class="bar-head">
        <span>{props.label}</span>
        <span class={over ? 'over' : ''}>
          {fmt(props.value)}
          {props.max > 0 && <span class="muted"> / {fmt(props.max)}</span>} {props.unit}
        </span>
      </div>
      <div class="bar-track">
        <div class={over ? 'bar-fill over' : 'bar-fill'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
