import { useEffect, useState } from 'preact/hooks'
import { ACTIVITY_LEVELS, bmr, tdee, targets, type Nutrition, type Profile, type Sex } from '../calc'
import { db, effectiveTargets, exportData, getSettings, importData, todayISO, useLive } from '../db'
import { fmt, Header, NumField, parseNum } from '../ui'

const DEFICITS = [
  { value: 0, label: 'Поддержание веса' },
  { value: 0.1, label: '−10% (мягко)' },
  { value: 0.15, label: '−15%' },
  { value: 0.2, label: '−20% (рекомендуется)' },
  { value: 0.25, label: '−25% (быстро)' },
]

const str = (n: number | undefined) => (n == null ? '' : String(n))

export function Settings() {
  const [sex, setSex] = useState<Sex>('male')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState(1.375)
  const [deficit, setDeficit] = useState(0.2)
  const [override, setOverride] = useState({ kcal: '', protein: '', fat: '', carbs: '' })
  const [status, setStatus] = useState('')

  const settings = useLive(() => db.settings.get('main'))

  useEffect(() => {
    getSettings().then((s) => {
      if (s.profile) {
        setSex(s.profile.sex)
        setAge(str(s.profile.age))
        setHeight(str(s.profile.heightCm))
        setWeight(str(s.profile.weightKg))
        setActivity(s.profile.activity)
        setDeficit(s.profile.deficit)
      }
      const o = s.override ?? {}
      setOverride({ kcal: str(o.kcal), protein: str(o.protein), fat: str(o.fat), carbs: str(o.carbs) })
    })
  }, [])

  const a = parseNum(age)
  const h = parseNum(height)
  const w = parseNum(weight)
  const profile: Profile | undefined =
    a && h && w ? { sex, age: a, heightCm: h, weightKg: w, activity, deficit } : undefined
  const computed = profile ? targets(profile) : undefined

  async function save(e: Event) {
    e.preventDefault()
    const o: Partial<Nutrition> = {}
    for (const k of ['kcal', 'protein', 'fat', 'carbs'] as const) {
      const v = parseNum(override[k])
      if (v) o[k] = v
    }
    await db.transaction('rw', db.settings, db.weights, async () => {
      await db.settings.put({ key: 'main', profile, override: o })
      const last = await db.weights.orderBy('date').last()
      if (w && last?.weightKg !== w) await db.weights.put({ date: todayISO(), weightKg: w })
    })
    setStatus('Сохранено')
    setTimeout(() => setStatus(''), 2000)
  }

  async function doExport() {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `calories-${todayISO()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(e: Event) {
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

  const current = effectiveTargets(settings)

  return (
    <div class="screen">
      <Header title="Цель" />
      <form class="form" onSubmit={save}>
        <div class="segmented" role="radiogroup">
          <button type="button" class={sex === 'male' ? 'active' : ''} onClick={() => setSex('male')}>
            Мужчина
          </button>
          <button type="button" class={sex === 'female' ? 'active' : ''} onClick={() => setSex('female')}>
            Женщина
          </button>
        </div>
        <div class="grid3">
          <NumField label="Возраст" value={age} onInput={setAge} suffix="лет" />
          <NumField label="Рост" value={height} onInput={setHeight} suffix="см" />
          <NumField label="Вес" value={weight} onInput={setWeight} suffix="кг" />
        </div>
        <label class="field">
          <span class="field-label">Активность</span>
          <select value={activity} onChange={(e) => setActivity(Number(e.currentTarget.value))}>
            {ACTIVITY_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Темп</span>
          <select value={deficit} onChange={(e) => setDeficit(Number(e.currentTarget.value))}>
            {DEFICITS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        {profile && computed && (
          <div class="card result">
            <div>
              <span class="muted small">Обмен в покое</span>
              <strong>{fmt(bmr(profile))} ккал</strong>
            </div>
            <div>
              <span class="muted small">С учётом активности</span>
              <strong>{fmt(tdee(profile))} ккал</strong>
            </div>
            <div>
              <span class="muted small">Цель в день</span>
              <strong>{fmt(computed.kcal)} ккал</strong>
              <span class="small">
                Б {computed.protein} · Ж {computed.fat} · У {computed.carbs} г
              </span>
            </div>
          </div>
        )}
        {computed?.clamped && (
          <p class="warn">Цель поднята до безопасного минимума. Слишком большой дефицит обычно приводит к срывам.</p>
        )}

        <details class="details">
          <summary>Задать цели вручную</summary>
          <p class="muted small">Пустое поле — значение из расчёта.</p>
          <NumField
            label="Калории"
            value={override.kcal}
            onInput={(v) => setOverride({ ...override, kcal: v })}
            suffix="ккал"
            placeholder={computed ? String(computed.kcal) : ''}
          />
          <div class="grid3">
            <NumField
              label="Белки"
              value={override.protein}
              onInput={(v) => setOverride({ ...override, protein: v })}
              suffix="г"
              placeholder={computed ? String(computed.protein) : ''}
            />
            <NumField
              label="Жиры"
              value={override.fat}
              onInput={(v) => setOverride({ ...override, fat: v })}
              suffix="г"
              placeholder={computed ? String(computed.fat) : ''}
            />
            <NumField
              label="Углеводы"
              value={override.carbs}
              onInput={(v) => setOverride({ ...override, carbs: v })}
              suffix="г"
              placeholder={computed ? String(computed.carbs) : ''}
            />
          </div>
        </details>

        <div class="row">
          <button type="submit" class="btn primary grow">
            {status || 'Сохранить'}
          </button>
        </div>
        {current && (
          <p class="muted small center">
            Сейчас в дневнике: {fmt(current.kcal)} ккал · Б {fmt(current.protein)} · Ж {fmt(current.fat)} · У{' '}
            {fmt(current.carbs)}
          </p>
        )}
      </form>

      <section class="form">
        <h2 class="section-title">Данные</h2>
        <p class="muted small">
          Всё хранится только в этом браузере. Делайте резервную копию время от времени — при очистке данных сайта она
          пропадёт.
        </p>
        <div class="row">
          <button type="button" class="btn grow" onClick={doExport}>
            Экспорт
          </button>
          <label class="btn grow">
            Импорт
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
        </div>
      </section>
    </div>
  )
}
