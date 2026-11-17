/** Збереження демо-стану в sessionStorage. Усі звернення в try/catch: сховище може бути недоступним. */
import { isRole, type Role } from '@/lib/access'
import { resetDecisions } from './decisionsStore'

const ROLE_KEY = 'demo.role'
const UNIT_KEY = 'demo.unit'
export const DEFAULT_DEMO_ROLE: Role = 'leader'
export const DEFAULT_DEMO_UNIT = 'unit-a'

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* сховище недоступне: працюємо без збереження */
  }
}

export function loadRole(): Role {
  const v = read(ROLE_KEY)
  return isRole(v) ? v : DEFAULT_DEMO_ROLE
}
export const saveRole = (r: Role) => write(ROLE_KEY, r)

export function loadUnit(): string {
  const v = read(UNIT_KEY)
  return v === 'unit-a' || v === 'unit-b' ? v : DEFAULT_DEMO_UNIT
}
export const saveUnit = (u: string) => write(UNIT_KEY, u)

/** Скидає демо-стан, рішення за рекомендаціями й чернетки анкет. */
export function clearDemoStorage() {
  resetDecisions()
  try {
    sessionStorage.removeItem(ROLE_KEY)
    sessionStorage.removeItem(UNIT_KEY)
  } catch {
    /* ігноруємо */
  }
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('survey-draft:')) localStorage.removeItem(k)
  } catch {
    /* ігноруємо */
  }
}
