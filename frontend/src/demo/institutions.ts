/**
 * Заклади для спостерігача: вигадані, дані детерміновано генеруються за seed і проходять ті самі
 * функції методики. Альфа бере повні демо-дані з data.ts. Заклади не порівнюються й не ранжуються.
 */
import {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  creditedOf,
  deltaOf,
  indexOf,
  levelOf,
  levelToScore,
  weightedMean,
  round1,
  fmt,
  K_MIN_GROUP,
  type ComponentId,
} from '@/lib/scoring/methodology'
import { trustGrade, type TrustFlag, type TrustGrade } from '@/lib/scoring/trust'
import type { MaturityLevel } from '@/components/ui/config'
import type { CyclePoint, TrendEvent } from '@/lib/trends'
import * as alpha from './data'
import { alphaEvents, alphaSeries } from './trends'

export interface Insight {
  id: string
  title: string
  value: number
  hint: string
  component?: ComponentId
}

export type ParticipationId = 'wg' | 'os' | 'experts'

/** Участь за категоріями респондентів: відповіли з запрошених (без імен, лише кількості). */
export interface ParticipationRow {
  id: ParticipationId
  answered: number
  invited: number
}

/** Розбиває загальну кількість відповідей на категорії: РГ 25%, ОС 67%, експерти 8% (сума завжди дорівнює total). */
export function splitParticipation(
  total: number,
  spare: [number, number, number],
): ParticipationRow[] {
  const wg = Math.round(total * 0.25)
  const experts = Math.max(1, Math.round(total * 0.08))
  const os = total - wg - experts
  const ans = [wg, os, experts]
  const ids: ParticipationId[] = ['wg', 'os', 'experts']
  return ids.map((id, i) => ({ id, answered: ans[i]!, invited: ans[i]! + spare[i]! }))
}

export interface Institution {
  id: string
  name: string
  components: alpha.ComponentResult[]
  perceptionItems: alpha.IndicatorItem[]
  factItems: alpha.IndicatorItem[]
  /** Усі цикли від найстарішого до поточного. */
  series: CyclePoint[]
  events: TrendEvent[]
  flags: TrustFlag[]
  trust: { grade: TrustGrade; raised: TrustFlag[] }
  responses: number
  participation: ParticipationRow[]
  index: number
  level: MaturityLevel
  previousIndex: number
  /** Зміна до попереднього циклу, пункти. */
  delta: number
  summaryReason: string
  attention: Insight[]
  strengths: Insight[]
}

export const ALPHA_ID = 'alpha'

/** Детермінований генератор псевдовипадкових чисел (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
/** Значення на сітці 5: зважені середні лишаються точними до 0,1, тож розклад сходиться без похибок. */
const snap = (n: number) => Math.round(clamp(n) / 5) * 5

interface Profile {
  id: string
  name: string
  seed: number
  /** Базове сприйняття й факти за компонентами (культура, система, підзвітність). */
  perception: [number, number, number]
  facts: [number, number, number]
  /** Компонент, що знизився між циклами (щоб динаміка не була однобокою). */
  declining?: ComponentId
}

const PROFILES: Profile[] = [
  {
    id: 'beta',
    name: 'Умовний навчальний центр «Бета»',
    seed: 11,
    perception: [62, 58, 66],
    facts: [55, 50, 52],
  },
  {
    id: 'gamma',
    name: 'Умовна академія «Гамма»',
    seed: 23,
    perception: [72, 68, 70],
    facts: [70, 64, 66],
  },
  {
    id: 'omega',
    name: 'Умовний університет «Омега»',
    seed: 37,
    perception: [44, 40, 48],
    facts: [40, 36, 38],
    declining: 'system',
  },
]

const ATTENTION_TITLE: Record<ComponentId, string> = {
  culture: 'Більше практичних прикладів',
  system: 'Зробити процедури помітнішими',
  accountability: 'Підтвердити факти',
}

function generate(p: Profile): Institution {
  const r = rng(p.seed)
  const jitter = (amp: number) => (r() * 2 - 1) * amp
  const idx = (c: ComponentId) => COMPONENT_IDS.indexOf(c)

  const perceptionItems = alpha.perceptionItems.map((i) => ({
    ...i,
    value: snap(p.perception[idx(i.component)]! + jitter(8)),
  }))
  const levels = new Map<ComponentId, number>()
  const factItems = alpha.factItems.map((i) => {
    const target = p.facts[idx(i.component)]!
    if (i.count) {
      const den = i.count.denominator
      const num = Math.round((snap(target + jitter(10)) / 100) * den)
      const percent = round1((num / den) * 100)
      return { ...i, value: percent, count: { numerator: num, denominator: den, percent } }
    }
    // Один рівень на компонент: ваги 25 і 25 дають точне середнє лише для однакових значень.
    if (!levels.has(i.component))
      levels.set(
        i.component,
        Math.min(5, Math.max(1, Math.round(clamp(target + jitter(10)) / 25) + 1)),
      )
    return { ...i, value: levelToScore(levels.get(i.component)!) }
  })

  const components: alpha.ComponentResult[] = COMPONENT_IDS.map((id) => {
    const perception = weightedMean(perceptionItems.filter((i) => i.component === id))
    const facts = weightedMean(factItems.filter((i) => i.component === id))
    return { id, perception, facts, credited: creditedOf(perception, facts) }
  })
  const credited = Object.fromEntries(components.map((c) => [c.id, c.credited.value])) as Record<
    ComponentId,
    number
  >

  // Попередні цикли: кроки назад, зростання між циклами (для одного компонента може бути спад).
  const series: CyclePoint[] = [
    { cycle: alpha.CYCLE, index: indexOf(credited), components: credited },
  ]
  let cur = credited
  for (const cycle of ['2026-06', '2025-12', '2025-06']) {
    const prev = Object.fromEntries(
      COMPONENT_IDS.map((id) => {
        const step = 2 + r() * 5
        const signed = p.declining === id && cycle === '2026-06' ? -3 : step
        return [id, round1(clamp(cur[id] - signed))]
      }),
    ) as Record<ComponentId, number>
    series.unshift({ cycle, index: indexOf(prev), components: prev })
    cur = prev
  }

  const limited = components.find((c) => c.credited.limited)
  const LOCATIVE: Record<ComponentId, string> = {
    culture: 'Культурі',
    system: 'Системі',
    accountability: 'Підзвітності',
  }
  const flags: TrustFlag[] = alpha.trustFlags.map((f) => ({
    ...f,
    title:
      f.id === 'tf-gap' && limited
        ? `Розбіжність сприйняття й фактів у ${LOCATIVE[limited.id]} (${fmt(limited.perception)} проти ${fmt(limited.facts)})`
        : f.id === 'tf-gap'
          ? 'Розбіжність сприйняття й фактів'
          : f.title,
    raised: f.id === 'tf-gap' ? limited !== undefined : f.id === 'tf-jump' ? false : r() < 0.35,
  }))
  const responses = 40 + Math.floor(r() * 30)
  const trust = {
    grade: trustGrade(flags, responses, K_MIN_GROUP),
    raised: flags.filter((f) => f.raised),
  }
  const index = series[3]!.index
  const previousIndex = series[2]!.index

  const byCredited = [...components].sort((a, b) => a.credited.value - b.credited.value)
  const attention: Insight[] = byCredited.map((c) => ({
    id: `a-${c.id}`,
    title: ATTENTION_TITLE[c.id],
    component: c.id,
    value: c.credited.value,
    hint: `Зараховане значення компонента ${COMPONENT_LABELS[c.id]}, 0-100.`,
  }))
  const top = byCredited[byCredited.length - 1]!
  const strengths: Insight[] = [
    {
      id: 's1',
      title: `Найвищий результат у компоненті ${COMPONENT_LABELS[top.id]}`,
      component: top.id,
      value: top.credited.value,
      hint: `Зараховане значення компонента ${COMPONENT_LABELS[top.id]}, 0-100.`,
    },
    {
      id: 's2',
      title: 'Зростання індексу кілька циклів поспіль',
      value: round1(index - series[0]!.index),
      hint: 'Сумарне зростання індексу з першого циклу, у пунктах.',
    },
  ]

  return {
    id: p.id,
    name: p.name,
    components,
    perceptionItems,
    factItems,
    series,
    events: [
      { id: `${p.id}-e1`, afterCycle: '2025-12', title: 'Виконано захід: оновлено процедури' },
      { id: `${p.id}-e2`, afterCycle: '2026-06', title: 'Виконано захід: проведено навчання' },
    ],
    flags,
    trust,
    responses,
    participation: splitParticipation(responses, [
      1 + Math.floor(r() * 3),
      5 + Math.floor(r() * 8),
      1 + Math.floor(r() * 2),
    ]),
    index,
    level: levelOf(index),
    previousIndex,
    delta: deltaOf(index, previousIndex),
    summaryReason: limited
      ? `${COMPONENT_LABELS[limited.id]}: самооцінку не підтверджують факти`
      : 'Суттєвих розбіжностей між сприйняттям і фактами немає',
    attention,
    strengths,
  }
}

const ALPHA: Institution = {
  id: ALPHA_ID,
  name: alpha.INSTITUTION,
  components: alpha.components,
  perceptionItems: alpha.perceptionItems,
  factItems: alpha.factItems,
  series: alphaSeries(),
  events: alphaEvents,
  flags: alpha.trustFlags,
  trust: alpha.trustSummary,
  responses: alpha.RESPONSES,
  participation: [
    { id: 'wg', answered: 12, invited: 14 },
    { id: 'os', answered: 32, invited: 40 },
    { id: 'experts', answered: 4, invited: 6 },
  ],
  index: alpha.currentIndex,
  level: alpha.currentLevel,
  previousIndex: alpha.previousIndex,
  delta: alpha.indexDelta,
  summaryReason: alpha.summaryReason,
  attention: alpha.attention,
  strengths: alpha.strengths,
}

/** Єдине впорядкування: за назвою. Сортування за індексом заборонене. */
export const INSTITUTIONS: Institution[] = [ALPHA, ...PROFILES.map(generate)].sort((a, b) =>
  a.name.localeCompare(b.name, 'uk'),
)

export const institutionById = (id: string): Institution =>
  INSTITUTIONS.find((i) => i.id === id) ?? ALPHA
