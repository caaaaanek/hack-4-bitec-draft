import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTE,
  KNOWN_ROUTES,
  ROLES,
  ROLE_LABELS,
  canAccess,
  defaultRoute,
  defaultScope,
  isKnownRoute,
} from './access'

describe('access', () => {
  it('кожна роль має підпис і доступний маршрут за замовчуванням', () => {
    for (const r of ROLES) {
      expect(ROLE_LABELS[r].length).toBeGreaterThan(0)
      expect(canAccess(r, defaultRoute(r))).toBe(true)
      expect(DEFAULT_ROUTE[r]).toBeTruthy()
    }
  })
  it('leader, observer, auditor бачать / і /explain', () => {
    for (const r of ['leader', 'observer', 'auditor'] as const) {
      expect(canAccess(r, '/')).toBe(true)
      expect(canAccess(r, '/explain')).toBe(true)
    }
  })
  it('нові маршрути: трекер для керівника й аудиту, заклади лише для спостерігача', () => {
    for (const r of ['leader', 'auditor'] as const) expect(canAccess(r, '/tracker')).toBe(true)
    expect(canAccess('observer', '/tracker')).toBe(false)
    expect(canAccess('leader', '/recommendations')).toBe(true)
    expect(canAccess('auditor', '/recommendations')).toBe(false)
    expect(canAccess('observer', '/recommendations')).toBe(false)
    expect(canAccess('observer', '/institutions')).toBe(true)
    expect(canAccess('leader', '/institutions')).toBe(false)
    expect(defaultRoute('observer')).toBe('/institutions')
    for (const r of ['leader', 'observer', 'auditor'] as const) {
      expect(canAccess(r, '/compare')).toBe(true)
      expect(canAccess(r, '/trends')).toBe(true)
      expect(canAccess(r, '/integrations')).toBe(true)
    }
    expect(canAccess('auditor', '/reports')).toBe(false)
    expect(canAccess('respondent', '/tracker')).toBe(false)
  })
  it('респондент лише /s/:token і /me', () => {
    expect(canAccess('respondent', '/s/demo')).toBe(true)
    expect(canAccess('respondent', '/me')).toBe(true)
    for (const p of ['/', '/explain', '/manage', '/surveys', '/reports'])
      expect(canAccess('respondent', p)).toBe(false)
  })
  it('admin і commissioner не мають доступу до відповідей (дашборд, розклад, /me)', () => {
    for (const r of ['admin', 'commissioner'] as const)
      for (const p of ['/', '/explain', '/me']) expect(canAccess(r, p)).toBe(false)
    expect(canAccess('admin', '/manage')).toBe(true)
    expect(canAccess('commissioner', '/surveys')).toBe(true)
    expect(canAccess('commissioner', '/manage')).toBe(false)
  })
  it('прямий доступ: чек-лист лише для редактора й підтверджувача', () => {
    expect(canAccess('checklist_editor', '/checklist')).toBe(true)
    expect(canAccess('checklist_approver', '/checklist')).toBe(true)
    expect(canAccess('leader', '/checklist')).toBe(false)
    expect(canAccess('checklist_editor', '/')).toBe(false)
  })
  it('/design відкрита всім, невідомий маршрут не вважається забороненим', () => {
    for (const r of ROLES) expect(canAccess(r, '/design')).toBe(true)
    expect(isKnownRoute('/nope')).toBe(false)
    expect(KNOWN_ROUTES.every((p) => isKnownRoute(p.replace(':token', 'x')))).toBe(true)
  })
  it('скидання scope при зміні ролі: респондент свій підрозділ, інші корінь', () => {
    expect(defaultScope('respondent', 'unit-b')).toBe('unit-b')
    expect(defaultScope('leader', 'unit-b')).toBe('alpha')
  })
})
