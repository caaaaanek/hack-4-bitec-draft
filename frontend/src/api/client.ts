/**
 * Клієнт API бекенду (`docs/api/openapi.json`, типи: `src/api/backend.d.ts`).
 *
 * Домовленості:
 * - база `/api/v1` (у dev Vite проксіює її на бекенд, у Docker це робить nginx), тож CORS не потрібен;
 *   інша адреса: `VITE_API_URL`;
 * - поля в `snake_case`, як у бекенді, без перетворень: ключі-словники (категорії, коди) лишаються як є;
 * - помилки: `{code, message, hint, errors?, request_id}` → `ApiError`;
 * - токен сесії в sessionStorage (закривається разом із вкладкою), заголовок `Authorization: Bearer`;
 * - анонімне проходження: токен посилання лише в заголовку `X-Response-Token`, не в адресі запиту.
 */
import type { components } from './backend'

export type Schemas = components['schemas']
export type PublicConfig = Schemas['PublicConfig']
export type Session = Schemas['SessionOut']
export type Me = Schemas['MeOut']
export type TokenForm = Schemas['TokenFormOut']
export type SubmissionIn = Schemas['SubmissionIn']

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'
const TOKEN_KEY = 'imd.session'

export interface ErrorItem {
  path: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly hint: string
  readonly errors: ErrorItem[]
  readonly missingQuestionIds: string[]
  readonly requestId: string | null

  constructor(status: number, body: Partial<Schemas['ErrorOut']> | null, requestId: string | null) {
    super(body?.message ?? 'Не вдалося виконати запит')
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code ?? (status === 0 ? 'network' : 'error')
    this.hint = body?.hint ?? 'Спробуйте ще раз.'
    this.errors = (body?.errors as ErrorItem[] | null | undefined) ?? []
    this.missingQuestionIds = body?.missing_question_ids ?? []
    this.requestId = body?.request_id ?? requestId
  }
}

export const session = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string | null) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* приватний режим: живемо без збереження */
    }
  },
}

type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  method?: string
  query?: Query
  body?: unknown
  headers?: Record<string, string>
  /** false: не додавати Authorization (вхід, анонімне проходження). */
  auth?: boolean
  signal?: AbortSignal
}

/** Викликається при 401 з токеном: сесія закінчилась, застосунок веде на вхід. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

function url(path: string, query?: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {}))
    if (v !== undefined && v !== null) q.set(k, String(v))
  const qs = q.toString()
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  const token = opts.auth === false ? null : session.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(url(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(
      0,
      { message: 'Немає зв’язку із сервером', hint: 'Перевірте мережу й спробуйте ще раз.' },
      null,
    )
  }
  const requestId = res.headers.get('X-Request-ID')
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as Partial<Schemas['ErrorOut']> | null
    if (res.status === 401 && token) {
      session.set(null)
      onUnauthorized?.()
    }
    throw new ApiError(res.status, payload, requestId)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('Content-Type') ?? ''
  return (type.includes('json') ? await res.json() : await res.text()) as T
}

// ---------- Готові виклики ----------

export const api = {
  config: () => request<PublicConfig>('/config', { auth: false }),

  async login(login: string, password: string): Promise<Session> {
    const s = await request<Session>('/auth/session', {
      method: 'POST',
      body: { login, password },
      auth: false,
    })
    session.set(s.access_token)
    return s
  },
  /** Вхід через SSO організації (довірений проксі), якщо `config.auth.proxy`. */
  async loginViaProxy(): Promise<Session> {
    const s = await request<Session>('/auth/proxy', { method: 'POST', auth: false })
    session.set(s.access_token)
    return s
  },
  async logout(): Promise<void> {
    try {
      await request<void>('/auth/session', { method: 'DELETE' })
    } finally {
      session.set(null)
    }
  },
  me: () => request<Me>('/auth/session'),

  /** Анонімне проходження за одноразовим посиланням `/s/:token`. */
  tokenForm: (token: string) =>
    request<TokenForm>('/respond/form', { auth: false, headers: { 'X-Response-Token': token } }),
  tokenSubmit: (token: string, body: SubmissionIn) =>
    request<Schemas['SubmissionOut']>('/respond/responses', {
      method: 'POST',
      body,
      auth: false,
      headers: { 'X-Response-Token': token },
    }),
}
