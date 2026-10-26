import { useState } from 'preact/hooks'
import { buildCsv, downloadFile, EXPORT_KINDS, type ExportKind } from '../csv'
import { exportData, importData, shiftDate, todayISO } from '../db'

type Period = 7 | 30 | 'all' | 'custom'

const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: 'Неделя' },
  { value: 30, label: 'Месяц' },
  { value: 'all', label: 'Всё' },
  { value: 'custom', label: 'Даты' },
]

export function DataExport() {
  const [kind, setKind] = useState<ExportKind>('diary')
  const [period, setPeriod] = useState<Period>(30)
  const [from, setFrom] = useState(shiftDate(todayISO(), -29))
  const [to, setTo] = useState(todayISO())
  const [status, setStatus] = useState('')

  const today = todayISO()
  const range: [string, string] =
    period === 'custom' ? [from, to] : period === 'all' ? ['', today] : [shiftDate(today, -(period - 1)), today]
  const badRange = period === 'custom' && (!from || !to || from > to)

  async function downloadCsv() {
    const { csv, rows } = await buildCsv(kind, ...range)
    if (!rows) {
      setStatus('За этот период данных нет')
      return
    }
    const meta = EXPORT_KINDS.find((k) => k.value === kind)!
    const suffix = kind === 'products' ? today : `${range[0] || 'начало'}_${range[1]}`
    downloadFile(csv, `калории-${meta.file}-${suffix}.csv`, 'text/csv;charset=utf-8')
    setStatus(`Выгружено строк: ${rows}`)
  }

  async function backup() {
    downloadFile(JSON.stringify(await exportData(), null, 2), `calories-${today}.json`, 'application/json')
  }

  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!confirm('Импорт заменит все текущие данные содержимым файла. Продолжить?')) return
    try {
      await importData(JSON.parse(await file.text()))
      alert('Данные восстановлены')
      location.reload()
    } catch (err) {
      alert(`Не удалось импортировать: ${(err as Error).message}`)
    }
  }

  return (
    <>
      <section class="form">
        <h2 class="section-title">Выгрузка в таблицу</h2>
        <label class="field">
          <span class="field-label">Что выгрузить</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.currentTarget.value as ExportKind)
              setStatus('')
            }}
          >
            {EXPORT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'products' && (
          <>
            <div class="segmented" role="radiogroup">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  class={period === p.value ? 'active' : ''}
                  onClick={() => {
                    setPeriod(p.value)
                    setStatus('')
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div class="grid2">
                <label class="field">
                  <span class="field-label">С</span>
                  <input type="date" value={from} max={to || today} onInput={(e) => setFrom(e.currentTarget.value)} />
                </label>
                <label class="field">
                  <span class="field-label">По</span>
                  <input type="date" value={to} min={from} max={today} onInput={(e) => setTo(e.currentTarget.value)} />
                </label>
              </div>
            )}
          </>
        )}
        <button type="button" class="btn primary" disabled={badRange} onClick={downloadCsv}>
          Скачать CSV
        </button>
        <p class="muted small">{status || 'Файл открывается в Excel, Numbers и Google Таблицах.'}</p>
      </section>

      <section class="form">
        <h2 class="section-title">Резервная копия</h2>
        <p class="muted small">
          Без аккаунта всё хранится только в этом браузере: делайте резервную копию время от времени — при очистке
          данных сайта она пропадёт. Через неё же можно перенести данные на другое устройство.
        </p>
        <div class="row">
          <button type="button" class="btn grow" onClick={backup}>
            Сохранить копию
          </button>
          <label class="btn grow">
            Восстановить
            <input type="file" accept="application/json,.json" hidden onChange={restore} />
          </label>
        </div>
      </section>
    </>
  )
}
