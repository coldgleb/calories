import PocketBase, { ClientResponseError } from 'pocketbase'
import { isNetworkError, prepareAccount, startSync, stopSync, syncNow, wipeLocal, type Collection, type FirstSync, type Remote, type RemoteRecord } from './sync'

/**
 * The app talks to PocketBase on its own origin: on the home server PocketBase serves both
 * the app and the API. On GitHub Pages there is no API and the app stays local-only.
 */
const base = typeof document !== 'undefined' ? new URL('.', document.baseURI).href.replace(/\/$/, '') : ''

export const pb = new PocketBase(base)
pb.autoCancellation(false)

let serverAvailable: Promise<boolean> | undefined

/** Whether this copy of the app is served by our PocketBase. */
export function detectServer(): Promise<boolean> {
  serverAvailable ??= (async () => {
    try {
      const res = await fetch(`${base}/api/health`, { cache: 'no-store' })
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false
      return (await res.json())?.code === 200
    } catch {
      // Offline: assume the server exists if we have signed in on this device before.
      return pb.authStore.isValid
    }
  })()
  return serverAvailable
}

export interface Account {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

export function currentAccount(): Account | undefined {
  const r = pb.authStore.record
  if (!r || !pb.authStore.isValid) return undefined
  return { id: r.id, email: r.email, name: r.name, role: r.role === 'admin' ? 'admin' : 'user' }
}

class PocketBaseRemote implements Remote {
  get userId() {
    return pb.authStore.record!.id
  }

  get isAdmin() {
    return pb.authStore.record?.role === 'admin'
  }

  async pull(collection: Collection, since: string) {
    return pb.collection(collection).getFullList<RemoteRecord>({
      filter: since ? pb.filter('updated >= {:since}', { since }) : '',
      sort: 'updated',
      batch: 500,
    })
  }

  async upsert(collection: Collection, records: Record<string, unknown>[]) {
    const batch = pb.createBatch()
    for (const r of records) batch.collection(collection).upsert(r)
    await batch.send()
  }

  async markDeleted(collection: Collection, id: string) {
    try {
      await pb.collection(collection).update(id, { deleted: true, clientUpdatedAt: Date.now() })
      return 'ok' as const
    } catch (e) {
      if ((e as ClientResponseError).status === 404) return 'missing' as const
      throw e
    }
  }

  async hasPersonalData() {
    for (const c of ['entries', 'recipes', 'weights', 'settings'] as const) {
      const page = await pb.collection(c).getList(1, 1, { filter: 'deleted = false', skipTotal: false })
      if (page.totalItems > 0) return true
    }
    return false
  }
}

const remote = new PocketBaseRemote()

/** PocketBase errors in plain Russian. */
export function describeError(e: unknown): string {
  if (isNetworkError(e)) return 'Нет связи с сервером.'
  const err = e as ClientResponseError
  const fields = (err.response?.data ?? {}) as Record<string, { code?: string }>
  if (fields.email?.code === 'validation_not_unique') return 'Этот email уже зарегистрирован. Попробуйте войти.'
  if (fields.email?.code === 'validation_is_email') return 'Проверьте email.'
  if (fields.password?.code?.startsWith('validation_min') || fields.password?.code === 'validation_length_out_of_range') {
    return 'Пароль — минимум 8 символов.'
  }
  if (fields.passwordConfirm) return 'Пароли не совпадают.'
  if (err.status === 429) return 'Слишком много попыток. Подождите немного.'
  if (err.status === 401 || err.status === 403) return 'Сессия истекла — войдите снова.'
  if (err.status === 400 && err.url?.includes('auth-with-password')) return 'Неверный email или пароль.'
  return err.message || 'Ошибка сервера.'
}

async function afterSignIn(choice?: 'merge' | 'server'): Promise<FirstSync> {
  const result = await prepareAccount(remote, choice)
  if (result === 'ready') startSync(remote, describeError)
  return result
}

export async function signIn(email: string, password: string): Promise<FirstSync> {
  await pb.collection('users').authWithPassword(email.trim(), password)
  return afterSignIn()
}

export async function register(name: string, email: string, password: string): Promise<FirstSync> {
  await pb.collection('users').create({ name: name.trim(), email: email.trim(), password, passwordConfirm: password })
  return signIn(email, password)
}

/** Answers the "both the device and the account have data" question. */
export function resolveFirstSync(choice: 'merge' | 'server') {
  return afterSignIn(choice)
}

export async function signOut() {
  await stopSync()
  pb.authStore.clear()
  await wipeLocal()
}

/** On start-up: refresh the session and resume syncing. */
export async function resumeSession() {
  if (!pb.authStore.isValid || !(await detectServer())) return
  try {
    await pb.collection('users').authRefresh()
  } catch (e) {
    // Offline: keep the stored session and sync once the network is back.
    if (!isNetworkError(e)) {
      pb.authStore.clear()
      return
    }
  }
  if ((await prepareAccount(remote)) === 'ready') startSync(remote, describeError)
}

export { syncNow }
