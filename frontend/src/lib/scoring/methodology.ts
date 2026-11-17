/**
 * [ПРОПОЗИЦІЯ] Припущення методики. Уся логіка розрахунку живе лише тут, щоб її можна було замінити
 * без змін в інтерфейсі. Див. docs/DESIGN_SYSTEM.md, розділ «Припущення методики».
 */
import type { MaturityLevel } from '../../components/ui/config'

export type ComponentId = 'culture' | 'system' | 'accountability'

export const COMPONENT_IDS: readonly ComponentId[] = ['culture', 'system', 'accountability']

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  culture: 'Культура',
  system: 'Система',
  accountability: 'Підзвітність',
}

/**
 * Мінімальний розмір групи (k): менші групи не показуються, їхні дані додаються до батьківського підрозділу.
 * Налаштовується адміністратором циклу, за замовчуванням 10.
 */
export const K_MIN_GROUP = 10

/** Рівні ваг компонентів: рівні, 1/3. */
export const COMPONENT_WEIGHT = 1 / 3

/** Верхні межі рівнів 1-4 (включно). Усе, що вище останньої межі, це рівень 5. */
export const LEVEL_UPPER_BOUNDS = [12.5, 37.5, 62.5, 87.5] as const

/** Обмежувач: зараховане не перевищує факти більш ніж на цю кількість пунктів. */
export const LIMITER_MARGIN = 25

export const round1 = (n: number): number => Math.round(n * 10) / 10

export function levelOf(index: number): MaturityLevel {
  const i = LEVEL_UPPER_BOUNDS.findIndex((b) => index <= b)
  return (i === -1 ? 5 : i + 1) as MaturityLevel
}

export interface Credited {
  /** Зараховане значення. */
  value: number
  /** Чи спрацював обмежувач. */
  limited: boolean
  /** Причина обмеження (лише коли limited). */
  reason?: string
}

export function creditedOf(perception: number, facts: number): Credited {
  const cap = facts + LIMITER_MARGIN
  if (perception <= cap) return { value: perception, limited: false }
  return {
    value: cap,
    limited: true,
    reason: `Сприйняття (${fmt(perception)}) перевищує факти (${fmt(facts)}) більш ніж на ${LIMITER_MARGIN} пунктів, тому зараховано ${fmt(cap)}.`,
  }
}

/** Внесок компонента в індекс (зараховане, помножене на вагу). */
export const contributionOf = (credited: number): number => credited * COMPONENT_WEIGHT

/** Індекс: сума внесків, округлена до 0,1. */
export function indexOf(credited: Record<ComponentId, number>): number {
  return round1(COMPONENT_IDS.reduce((sum, id) => sum + contributionOf(credited[id]), 0))
}

/** Зміна відносно попереднього циклу, у пунктах (округлено до 0,1). */
export const deltaOf = (current: number, previous: number): number => round1(current - previous)

/** Число українською: кома як десятковий роздільник, без зайвого «,0». */
export function fmt(n: number): string {
  return round1(n).toLocaleString('uk-UA', { maximumFractionDigits: 1 })
}

/** Індекс завжди з одним знаком після коми: 47,0. */
export const fmtIndex = (n: number): string =>
  round1(n).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** «7,2 пункта», «1 пункт», «3 пункти», «5 пунктів». */
export function pointsText(n: number): string {
  const abs = Math.abs(n)
  const word = !Number.isInteger(abs)
    ? 'пункта'
    : abs % 10 === 1 && abs % 100 !== 11
      ? 'пункт'
      : [2, 3, 4].includes(abs % 10) && ![12, 13, 14].includes(abs % 100)
        ? 'пункти'
        : 'пунктів'
  return `${fmt(abs)} ${word}`
}

/** Рівень анкети 1-5 переводиться в шкалу 0-100: 1 це 0, 5 це 100. */
export const levelToScore = (level: number): number => (level - 1) * 25

/** Зважене середнє. Ваги в частках від 100 (у сумі 100). */
export function weightedMean(items: readonly { weight: number; value: number }[]): number {
  const total = items.reduce((s, i) => s + i.weight, 0)
  return round1(items.reduce((s, i) => s + i.weight * i.value, 0) / total)
}

/** «54,2 бала», «1 бал», «3 бали», «5 балів». */
export function scoreText(n: number): string {
  const abs = Math.abs(n)
  const word = !Number.isInteger(abs)
    ? 'бала'
    : abs % 10 === 1 && abs % 100 !== 11
      ? 'бал'
      : [2, 3, 4].includes(abs % 10) && ![12, 13, 14].includes(abs % 100)
        ? 'бали'
        : 'балів'
  return `${fmt(abs)} ${word}`
}
