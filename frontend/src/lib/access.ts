/** Модель доступу: для кожної ролі список доступних маршрутів і маршрут за замовчуванням. */
import { matchPath } from 'react-router-dom'
import { ROOT_UNIT_ID } from '../demo/units'

export const ROLES = [
  'admin',
  'commissioner',
  'respondent',
  'leader',
  'observer',
  'checklist_editor',
  'checklist_approver',
  'auditor',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Уповноважений (адміністратор)',
  commissioner: 'Укладач анкет',
  respondent: 'Респондент',
  leader: 'Керівник закладу',
  observer: 'Спостерігач Департаменту',
  checklist_editor: 'Вносить дані чек-листа',
  checklist_approver: 'Підтверджує дані чек-листа',
  auditor: 'Внутрішній аудит',
}

/** Усі маршрути застосунку (шаблони react-router). */
export const KNOWN_ROUTES = [
  '/',
  '/explain',
  '/compare',
  '/recommendations',
  '/tracker',
  '/trends',
  '/integrations',
  '/institutions',
  '/reports',
  '/manage',
  '/surveys',
  '/checklist',
  '/audit',
  '/me',
  '/s/:token',
  '/design',
] as const

/** Службова сторінка дизайн-системи доступна всім ролям, у меню її немає. */
const OPEN_ROUTES: readonly string[] = ['/design']

export const ROLE_ROUTES: Record<Role, readonly string[]> = {
  admin: ['/manage', '/audit'],
  commissioner: ['/surveys'],
  respondent: ['/me', '/s/:token'],
  leader: [
    '/',
    '/explain',
    '/compare',
    '/recommendations',
    '/tracker',
    '/trends',
    '/integrations',
    '/reports',
  ],
  observer: ['/institutions', '/', '/explain', '/compare', '/trends', '/integrations', '/reports'],
  checklist_editor: ['/checklist'],
  checklist_approver: ['/checklist'],
  auditor: ['/', '/explain', '/compare', '/tracker', '/trends', '/integrations', '/audit'],
}

export const DEFAULT_ROUTE: Record<Role, string> = {
  admin: '/manage',
  commissioner: '/surveys',
  respondent: '/me',
  leader: '/',
  observer: '/institutions',
  checklist_editor: '/checklist',
  checklist_approver: '/checklist',
  auditor: '/',
}

const matches = (patterns: readonly string[], pathname: string) =>
  patterns.some((p) => matchPath({ path: p, end: true }, pathname) !== null)

export const isKnownRoute = (pathname: string): boolean => matches(KNOWN_ROUTES, pathname)

export const canAccess = (role: Role, pathname: string): boolean =>
  matches(OPEN_ROUTES, pathname) || matches(ROLE_ROUTES[role], pathname)

export const defaultRoute = (role: Role): string => DEFAULT_ROUTE[role]

/** Підрозділ за замовчуванням: респондент бачить свій, решта ролей корінь. */
export const defaultScope = (role: Role, respondentUnitId: string): string =>
  role === 'respondent' ? respondentUnitId : ROOT_UNIT_ID

export const isRole = (v: unknown): v is Role =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v)
