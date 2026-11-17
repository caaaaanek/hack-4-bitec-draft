import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, request, session, setUnauthorizedHandler } from './client'

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  session.set(null)
  setUnauthorizedHandler(null)
})

describe('клієнт API', () => {
  it('розбирає помилку бекенду в ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(
        422,
        {
          code: 'incomplete',
          message: 'Дані не пройшли перевірку',
          hint: 'Дайте відповідь на позначені питання.',
          detail: [],
          errors: [{ path: 'q1', message: 'Немає відповіді' }],
          missing_question_ids: ['q1'],
          request_id: 'r1',
        },
        { 'X-Request-ID': 'r1' },
      ),
    )
    const err = await request('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ApiError
    expect([e.status, e.code, e.hint, e.requestId]).toEqual([
      422,
      'incomplete',
      'Дайте відповідь на позначені питання.',
      'r1',
    ])
    expect(e.missingQuestionIds).toEqual(['q1'])
  })

  it('мережева помилка має код network', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const e = (await request('/x').catch((x: unknown) => x)) as ApiError
    expect(e.code).toBe('network')
  })

  it('вхід зберігає токен і додає його до запитів', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        reply(200, { access_token: 't1', token_type: 'bearer', user: { login: 'leader' } }),
      )
      .mockResolvedValueOnce(reply(200, { login: 'leader' }))
    await api.login('leader', 'pass-1234')
    await api.me()
    const [, init] = fetchMock.mock.calls[1]!
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t1')
  })

  it('401 з токеном скидає сесію', async () => {
    session.set('old')
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(401, { code: 'unauthorized', message: 'x', hint: 'y' }),
    )
    await request('/x').catch(() => undefined)
    expect(session.get()).toBeNull()
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('токен посилання йде лише в заголовку, без Authorization', async () => {
    session.set('staff-session')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { sections: [] }))
    await api.tokenForm('abc')
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('/api/v1/respond/form')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Response-Token']).toBe('abc')
    expect(headers.Authorization).toBeUndefined()
  })
})
