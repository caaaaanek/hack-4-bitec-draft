/** Синтетичні демо-дані. Жодних реальних людей чи закладів. */
import {
  COMPONENT_IDS,
  creditedOf,
  deltaOf,
  indexOf,
  levelOf,
  levelToScore,
  weightedMean,
  COMPONENT_LABELS,
  fmt,
  type ComponentId,
  K_MIN_GROUP,
  type Credited,
} from '@/lib/scoring/methodology'
import { trustGrade, type TrustFlag, type TrustGrade } from '@/lib/scoring/trust'

const COMPONENT_LOCATIVE: Record<ComponentId, string> = {
  culture: 'Культурі',
  system: 'Системі',
  accountability: 'Підзвітності',
}

export const INSTITUTION = 'Умовний військовий інститут «Альфа»'
export const CYCLE = '2026-11'
export const CYCLE_DATE = '16.11.2026'

/** Джерело оцінки питання або індикатора. */
export type ItemSource = 'wg' | 'os' | 'experts' | 'facts'

export interface IndicatorItem {
  id: string
  component: ComponentId
  label: string
  /** Частка в компоненті, у відсотках (у межах компонента й виду сума 100). */
  weight: number
  /** Значення 0-100. */
  value: number
  source: ItemSource
  /** Що це таке, простими словами. */
  hint: string
  /** Для фактів-відсотків: скільки з скількох (без імен). */
  count?: FactCount
}

export interface FactCount {
  numerator: number
  denominator: number
  percent: number
}

/** «87 з 100 (87%)». */
export const countText = (c: FactCount): string =>
  `${c.numerator} з ${c.denominator} (${fmt(c.percent)}%)`

const mkCount = (numerator: number, denominator: number): FactCount => ({
  numerator,
  denominator,
  percent: Math.round((numerator / denominator) * 1000) / 10,
})

/** Кількості для фактів-відсотків (синтетичні). */
export const FACT_COUNTS: Record<string, FactCount> = {
  'cu-f1': mkCount(11, 20),
  'sy-f1': mkCount(36, 60),
  'ac-f1': mkCount(45, 100),
  'ac-f2': mkCount(6, 20),
}

const WG_HINT = 'Середня оцінка відповідей робочої групи, 0-100.'
const OS_HINT = 'Середня оцінка відповідей особового складу, 0-100.'
const EX_HINT = 'Середня оцінка експертів, 0-100.'

type P = [string, ComponentId, string, number, number, ItemSource]
const P_ROWS: P[] = [
  ['cu-p1', 'culture', 'Відкритість до обговорення етичних питань', 30, 70, 'wg'],
  ['cu-p2', 'culture', 'Особистий приклад керівників', 30, 50, 'os'],
  ['cu-p3', 'culture', 'Готовність повідомляти про проблеми без страху наслідків', 20, 45, 'os'],
  ['cu-p4', 'culture', 'Розуміння правил доброчесності', 20, 62.5, 'experts'],
  ['sy-p1', 'system', 'Зрозумілість процедур', 30, 40, 'os'],
  ['sy-p2', 'system', 'Доступність каналів звернень', 30, 50, 'wg'],
  ['sy-p3', 'system', 'Захищеність тих, хто повідомляє про проблеми', 20, 40, 'os'],
  ['sy-p4', 'system', 'Якість внутрішніх документів', 20, 50, 'experts'],
  ['ac-p1', 'accountability', 'Прозорість рішень керівництва', 30, 85, 'wg'],
  ['ac-p2', 'accountability', 'Оприлюднення результатів перевірок', 30, 80, 'wg'],
  ['ac-p3', 'accountability', 'Відповідальність за виконання заходів', 20, 75, 'os'],
  ['ac-p4', 'accountability', 'Контроль виконання рішень', 20, 77.5, 'experts'],
]

/** Питання анкет: сприйняття. Значення 0-100, ваги в межах компонента дають 100. */
export const perceptionItems: IndicatorItem[] = P_ROWS.map(
  ([id, component, label, weight, value, source]) => ({
    id,
    component,
    label,
    weight,
    value,
    source,
    hint: source === 'wg' ? WG_HINT : source === 'os' ? OS_HINT : EX_HINT,
  }),
)

const PERCENT_HINT = 'Відсоток за даними реєстрів і чек-листа, 0-100.'
const levelHint = (l: number) =>
  `Рівень ${l} з 5 за анкетою, переведений у шкалу 0-100 (рівень 1 це 0, рівень 5 це 100).`

type F = [string, ComponentId, string, number, 'percent' | number, number?]
const F_ROWS: F[] = [
  [
    'cu-f1',
    'culture',
    'Прапорці, за якими прийнято рішення або захід протягом 30 днів',
    50,
    'percent',
    55,
  ],
  ['cu-f2', 'culture', 'Рівень за анкетою «Етичні практики»', 25, 2],
  ['cu-f3', 'culture', 'Рівень за анкетою «Навчання з доброчесності»', 25, 2],
  ['sy-f1', 'system', 'Скарги й звернення, розглянуті в строк', 50, 'percent', 60],
  ['sy-f2', 'system', 'Рівень за анкетою «Процедури та інструкції»', 25, 3],
  ['sy-f3', 'system', 'Рівень за анкетою «Захист заявників»', 25, 3],
  ['ac-f1', 'accountability', 'Подано декларацій вчасно серед зобовʼязаних', 40, 'percent', 45],
  [
    'ac-f2',
    'accountability',
    'Потенційні конфлікти інтересів, за якими уповноважений дав висновок у строк',
    40,
    'percent',
    30,
  ],
  ['ac-f3', 'accountability', 'Рівень за анкетою «Звітність і оприлюднення»', 20, 2],
]

/** Факти: чотири відсотки та рівні 1-5 з анкет (у шкалі 0-100). */
export const factItems: IndicatorItem[] = F_ROWS.map(
  ([id, component, label, weight, kind, pct]) => ({
    id,
    component,
    label,
    weight,
    value: kind === 'percent' ? pct! : levelToScore(kind),
    source: 'facts' as const,
    hint: kind === 'percent' ? PERCENT_HINT : levelHint(kind),
    count: kind === 'percent' ? FACT_COUNTS[id] : undefined,
  }),
)

const valueOf = (items: IndicatorItem[], id: ComponentId) =>
  weightedMean(items.filter((i) => i.component === id))

const RAW = Object.fromEntries(
  COMPONENT_IDS.map((id) => [
    id,
    { perception: valueOf(perceptionItems, id), facts: valueOf(factItems, id) },
  ]),
) as Record<ComponentId, { perception: number; facts: number }>

export interface ComponentResult {
  id: ComponentId
  perception: number
  facts: number
  credited: Credited
}

export const components: ComponentResult[] = COMPONENT_IDS.map((id) => ({
  id,
  ...RAW[id],
  credited: creditedOf(RAW[id].perception, RAW[id].facts),
}))

export const currentCredited = Object.fromEntries(
  components.map((c) => [c.id, c.credited.value]),
) as Record<ComponentId, number>

export const currentIndex = indexOf(currentCredited)
export const currentLevel = levelOf(currentIndex)

/** Попередні цикли: лише зараховані значення компонентів. */
export const history: { cycle: string; credited: Record<ComponentId, number> }[] = [
  { cycle: '2025-06', credited: { culture: 38, system: 30, accountability: 36 } },
  { cycle: '2025-12', credited: { culture: 44, system: 36, accountability: 43 } },
  { cycle: '2026-06', credited: { culture: 50, system: 41, accountability: 50 } },
]

export const previous = history[history.length - 1]!
export const previousIndex = indexOf(previous.credited)
export const indexDelta = deltaOf(currentIndex, previousIndex)

export const trend = [
  ...history.map((h) => ({ cycle: h.cycle, index: indexOf(h.credited) })),
  { cycle: CYCLE, index: currentIndex },
]

/** Кількість відповідей у групі закладу (для перевірки k). */
export const RESPONSES = 48

const limitedComponent = components.find((c) => c.credited.limited)

/** Прапорці достовірності: так/ні з вагою та поясненням простою мовою. */
export const trustFlags: TrustFlag[] = [
  {
    id: 'tf-gap',
    weight: 'major',
    raised: limitedComponent !== undefined,
    title: limitedComponent
      ? `Розбіжність сприйняття й фактів у ${COMPONENT_LOCATIVE[limitedComponent.id]} (${fmt(limitedComponent.perception)} проти ${fmt(limitedComponent.facts)})`
      : 'Розбіжність сприйняття й фактів',
    explanation:
      'Сприйняття значно вище за факти, тому зараховано з обмеженням. Варто звірити з чек-листом.',
  },
  {
    id: 'tf-same',
    weight: 'minor',
    raised: true,
    title: 'Однакові відповіді в частині анкет особового складу',
    explanation:
      'У частині анкет усі відповіді однакові. Це може означати, що анкету заповнювали поспіхом. Варто перевірити додатково.',
  },
  {
    id: 'tf-jump',
    weight: 'major',
    raised: false,
    title: 'Різка зміна індексу між циклами без пояснення',
    explanation: 'Індекс змінився помірно, різкого стрибка немає.',
  },
  {
    id: 'tf-experts',
    weight: 'minor',
    raised: false,
    title: 'Замало відповідей від експертів',
    explanation: 'Отримано всі очікувані експертні анкети.',
  },
]

export const trustSummary: { grade: TrustGrade; raised: TrustFlag[] } = {
  grade: trustGrade(trustFlags, RESPONSES, K_MIN_GROUP),
  raised: trustFlags.filter((f) => f.raised),
}

/** Причина простою мовою для рядка-підсумку. */
export const summaryReason = limitedComponent
  ? `${COMPONENT_LABELS[limitedComponent.id]}: самооцінку не підтверджують факти`
  : 'Суттєвих розбіжностей між сприйняттям і фактами немає'

export const strengths = [
  {
    id: 's1',
    title: 'Відкритість до етичних питань',
    component: 'culture' as ComponentId,
    value: 57.5,
    hint: 'Зараховане значення компонента Культура, 0-100.',
  },
  {
    id: 's2',
    title: 'Зростання індексу два цикли поспіль',
    value: 13.2,
    hint: 'Сумарне зростання індексу з циклу 2025-12, у пунктах.',
  },
]

export const attention = [
  {
    id: 'a1',
    title: 'Підтвердити факти',
    component: 'accountability' as ComponentId,
    value: 35,
    hint: 'Факти за компонентом Підзвітність, 0-100.',
  },
  {
    id: 'a2',
    title: 'Зробити процедури помітнішими',
    component: 'system' as ComponentId,
    value: 45,
    hint: 'Зараховане значення компонента Система, 0-100.',
  },
  {
    id: 'a3',
    title: 'Більше практичних прикладів',
    component: 'culture' as ComponentId,
    value: 40,
    hint: 'Факти за компонентом Культура, 0-100.',
  },
]
