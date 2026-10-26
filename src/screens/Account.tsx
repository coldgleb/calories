import { useEffect, useState } from 'preact/hooks'
import { currentAccount, describeError, detectServer, pb, register, resolveFirstSync, signIn, signOut, syncNow } from '../server'
import { getSyncStatus, onSyncStatus, pendingChanges, type SyncStatus } from '../sync'

function useAccount() {
  const [account, setAccount] = useState(currentAccount)
  useEffect(() => pb.authStore.onChange(() => setAccount(currentAccount())), [])
  return account
}

function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus)
  useEffect(() => {
    const off = onSyncStatus(setStatus)
    return () => {
      off()
    }
  }, [])
  return status
}

function statusText(s: SyncStatus): string {
  const time = s.lastSyncAt
    ? new Date(s.lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : undefined
  switch (s.state) {
    case 'syncing':
      return 'Синхронизация…'
    case 'offline':
      return `Нет связи с сервером${s.pending ? ` — изменений ждут отправки: ${s.pending}` : ''}`
    case 'error':
      return `Ошибка: ${s.error}`
    case 'idle':
      return s.pending ? `Изменений ждут отправки: ${s.pending}` : `Всё синхронизировано${time ? ` в ${time}` : ''}`
    default:
      return 'Синхронизация выключена'
  }
}

/** Sign-in, registration and sync status; hidden where there is no server (GitHub Pages). */
export function Account() {
  const [server, setServer] = useState<boolean>()
  const account = useAccount()
  const status = useSyncStatus()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    detectServer().then(setServer)
  }, [])

  if (!server) return null

  async function run(action: () => Promise<'ready' | 'ask'>) {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      setAsking(result === 'ask')
      if (result === 'ready') {
        setPassword('')
        setPassword2('')
      }
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: Event) {
    e.preventDefault()
    if (mode === 'register') {
      if (password !== password2) return setError('Пароли не совпадают.')
      if (password.length < 8) return setError('Пароль — минимум 8 символов.')
      run(() => register(name, email, password))
    } else {
      run(() => signIn(email, password))
    }
  }

  async function logout() {
    const pending = await pendingChanges()
    const warn = pending
      ? `Изменения (${pending}) ещё не отправлены на сервер и пропадут. Всё равно выйти?`
      : 'Выйти? Данные удалятся с этого устройства, на сервере они сохранятся.'
    if (!confirm(warn)) return
    await signOut()
    location.reload()
  }

  if (account && asking) {
    return (
      <section class="form">
        <h2 class="section-title">Аккаунт</h2>
        <p>
          И на этом устройстве, и в аккаунте <b>{account.email}</b> уже есть данные. Что сделать?
        </p>
        <button class="btn primary" disabled={busy} onClick={() => run(() => resolveFirstSync('merge'))}>
          Объединить
        </button>
        <p class="muted small">Записи с устройства добавятся в аккаунт, ничего не удалится.</p>
        <button class="btn" disabled={busy} onClick={() => run(() => resolveFirstSync('server'))}>
          Взять данные из аккаунта
        </button>
        <p class="muted small">Данные на этом устройстве заменятся данными из аккаунта.</p>
        {error && <p class="error">{error}</p>}
      </section>
    )
  }

  if (account) {
    return (
      <section class="form">
        <h2 class="section-title">Аккаунт</h2>
        <div class="card account-card">
          <div>
            <strong>{account.name || account.email}</strong>
            {account.name && <span class="muted small"> · {account.email}</span>}
            {account.role === 'admin' && <span class="badge">админ</span>}
          </div>
          <p class={status.state === 'error' ? 'error' : 'muted small'}>{statusText(status)}</p>
          <div class="row">
            <button class="btn grow" disabled={status.state === 'syncing'} onClick={() => syncNow()}>
              Синхронизировать
            </button>
            <button class="btn danger" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section class="form">
      <h2 class="section-title">Аккаунт</h2>
      <p class="muted small">
        С аккаунтом дневник, рецепты и вес хранятся на сервере и доступны с любого устройства, а продукты и готовая
        еда — общие для всех пользователей.
      </p>
      <div class="segmented" role="tablist">
        <button type="button" class={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
          Вход
        </button>
        <button type="button" class={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Регистрация
        </button>
      </div>
      <form class="form flush" onSubmit={submit}>
        {mode === 'register' && (
          <label class="field">
            <span class="field-label">Имя</span>
            <input autoComplete="name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        )}
        <label class="field">
          <span class="field-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="field-label">Пароль</span>
          <input
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>
        {mode === 'register' && (
          <label class="field">
            <span class="field-label">Пароль ещё раз</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password2}
              onInput={(e) => setPassword2(e.currentTarget.value)}
            />
          </label>
        )}
        {error && <p class="error">{error}</p>}
        <button class="btn primary" disabled={busy}>
          {busy ? 'Подождите…' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}
        </button>
        <p class="muted small">
          {mode === 'register'
            ? 'Данные с этого устройства перенесутся в новый аккаунт.'
            : 'Забыли пароль? Попросите администратора сервера сбросить его.'}
        </p>
      </form>
    </section>
  )
}
