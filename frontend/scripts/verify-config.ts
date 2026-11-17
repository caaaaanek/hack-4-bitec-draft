// Конфіг перевірки екранів: матриця «роль x екран». Маршрути ролей беруться з моделі доступу src/lib/access.ts.
import type { Page } from 'playwright'
import {
  KNOWN_ROUTES,
  ROLES as ALL_ROLES,
  ROLE_ROUTES,
  canAccess,
  type Role,
} from '../src/lib/access.ts'

export interface VerifyRoute {
  path: string
  /** Селектор «готовності»; за замовчуванням [data-ready="true"]. */
  ready?: string
  /** Очікується стан ForbiddenState (прямий перехід на недоступний маршрут). */
  forbidden?: boolean
  /** На екрані є демонстрація ForbiddenState (сторінка дизайн-системи), це не помилка доступу. */
  showsForbiddenDemo?: boolean
  /** Текст, який має бути на екрані. */
  contains?: string
}

export interface VerifyRole {
  id: string
  /** Підготовка ролі (запис у sessionStorage) до відкриття маршрутів. */
  setup?: (page: Page) => Promise<void>
  routes: VerifyRoute[]
}

export const WIDTHS = [360, 768, 1280, 1920] as const
export const FORBIDDEN_FRAGMENT = 'Ця сторінка недоступна для вашої ролі'

const asRole =
  (role: Role, unit = 'unit-a') =>
  async (page: Page) => {
    await page.evaluate(
      ([r, u]) => {
        sessionStorage.setItem('demo.role', r!)
        sessionStorage.setItem('demo.unit', u!)
      },
      [role, unit],
    )
  }

const concrete = (p: string) => p.replace(':token', 'demo')

function routesFor(role: Role): VerifyRoute[] {
  const own = ROLE_ROUTES[role].map((p) => ({ path: concrete(p) }))
  const denied = KNOWN_ROUTES.filter((p) => p !== '/design' && !canAccess(role, concrete(p)))
  // один прямий перехід на недоступний маршрут (перший за порядком)
  const probe = denied[0] ? [{ path: concrete(denied[0]), forbidden: true }] : []
  return [...own, ...probe]
}

export const ROLES: VerifyRole[] = [
  ...ALL_ROLES.map((role): VerifyRole => {
    const routes = routesFor(role)
    if (role === 'leader') {
      routes.push(
        { path: '/explain?c=accountability' },
        { path: '/design', showsForbiddenDemo: true },
      )
    }
    if (role === 'respondent') {
      routes.push(
        { path: '/s/used', contains: 'Цю анкету вже заповнено' },
        { path: '/s/bad', contains: 'Посилання недійсне або застаріле' },
      )
    }
    return { id: role, setup: asRole(role), routes }
  }),
  {
    id: 'respondent-b',
    setup: asRole('respondent', 'unit-b'),
    routes: [
      { path: '/me', contains: 'Недостатньо відповідей, щоб показати результати цієї групи' },
    ],
  },
]
