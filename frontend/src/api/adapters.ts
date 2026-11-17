/**
 * Перетворення відповідей бекенду в моделі інтерфейсу. Чисті функції без мережі: їх перевіряють тести.
 *
 * Методика однакова на обох боках (три компоненти, обмежувач +25 від фактів, індекс — середнє), тому
 * числа беруться з бекенду як є, без перерахунку: зараховане значення = `score`, сприйняття = `self_score`,
 * факти = `facts_score`.
 */
import {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  deltaOf,
  levelOf,
  round1,
  type ComponentId,
} from '@/lib/scoring/methodology'
import type { TrustFlag, TrustGrade } from '@/lib/scoring/trust'
import type { CyclePoint, TrendEvent } from '@/lib/trends'
import type { Measure, MeasureStatus } from '@/lib/measures'
import type { Priority, Recommendation, RecommendationStatus } from '@/lib/recommendations'
import type { Survey, SurveySection } from '@/demo/survey'
import type { ComponentResult, IndicatorItem, ItemSource } from '@/demo/data'
import type { Institution, Insight, ParticipationRow } from '@/demo/institutions'
import type { MaturityLevel } from '@/components/ui/config'
import type { Schemas } from './client'

type S = Schemas

export const isComponentId = (v: unknown): v is ComponentId =>
  typeof v === 'string' && (COMPONENT_IDS as readonly string[]).includes(v)

const SOURCE_MAP: Record<string, { source: ItemSource; label: string; hint: string }> = {
  staff: {
    source: 'os',
    label: 'Особовий склад (анкета 2)',
    hint: 'Середня оцінка відповідей особового складу за питаннями компонента, 0-100.',
  },
  working_group: {
    source: 'wg',
    label: 'Робоча група (анкета 1)',
    hint: 'Середня оцінка відповідей робочої групи за питаннями компонента, 0-100.',
  },
  expert: {
    source: 'experts',
    label: 'Зовнішні експерти (анкета 3)',
    hint: 'Середня оцінка експертів за питаннями компонента, 0-100.',
  },
  checklist: {
    source: 'wg',
    label: 'Контрольний чек-лист (вносить робоча група)',
    hint: 'Бал пунктів чек-листа компонента: впроваджено 1, частково 0,5, ні 0. Непідтверджені рахуються з поправкою.',
  },
}

const CATEGORY_TO_PARTICIPATION: Record<string, ParticipationRow['id']> = {
  working_group: 'wg',
  staff: 'os',
  expert: 'experts',
}

const GRADE: Record<string, TrustGrade> = {
  A: 'A',
  B: 'B',
  C: 'C',
  insufficient_data: 'insufficient',
}
export const trustGradeOf = (v: string | null | undefined): TrustGrade =>
  GRADE[v ?? ''] ?? 'insufficient'

const clampLevel = (n: number | null | undefined, fallback: number): MaturityLevel =>
  Math.min(5, Math.max(1, Math.round(n ?? fallback))) as MaturityLevel

/** «2026-11» з дати закриття; якщо дві хвилі в одному місяці — додаємо номер. */
export function cycleLabels(
  points: { closed_on?: string | null; campaign_title: string }[],
): string[] {
  const used = new Map<string, number>()
  return points.map((p) => {
    const base = p.closed_on ? p.closed_on.slice(0, 7) : p.campaign_title
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** «17.11.2026». */
export const fmtDateUa = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

function perceptionItemsOf(components: S['ComponentOut'][]): IndicatorItem[] {
  return components.flatMap((c) => {
    if (!isComponentId(c.code)) return []
    const sources = (c.sources ?? []).filter(
      (s) => s.score !== null && s.score !== undefined && s.effective_weight > 0,
    )
    const total = sources.reduce((sum, s) => sum + s.effective_weight, 0) || 1
    return sources.map((s) => {
      const meta = SOURCE_MAP[s.source] ?? { source: 'wg' as ItemSource, label: s.title, hint: '' }
      return {
        id: `${c.code}-${s.source}`,
        component: c.code as ComponentId,
        label: meta.label,
        weight: round1((s.effective_weight / total) * 100),
        value: s.score ?? 0,
        source: meta.source,
        hint: meta.hint,
      }
    })
  })
}

function factItemsOf(components: S['ComponentOut'][]): IndicatorItem[] {
  return components.flatMap((c) => {
    if (!isComponentId(c.code)) return []
    const facts = (c.facts ?? []).filter((f) => f.score !== null && f.score !== undefined)
    return facts.map((f) => ({
      id: `${c.code}-f-${f.indicator}`,
      component: c.code as ComponentId,
      label: f.title,
      weight: round1(100 / facts.length),
      value: f.score ?? 0,
      source: 'facts' as const,
      hint: f.rule ?? '',
      count:
        f.numerator !== null && f.numerator !== undefined && f.denominator
          ? {
              numerator: f.numerator,
              denominator: f.denominator,
              percent: f.percent ?? round1((f.numerator / f.denominator) * 100),
            }
          : undefined,
    }))
  })
}

function componentsOf(components: S['ComponentOut'][]): ComponentResult[] {
  return COMPONENT_IDS.map((id) => {
    const c = components.find((x) => x.code === id)
    const value = c?.score ?? c?.self_score ?? 0
    const perception = c?.self_score ?? value
    const facts = c?.facts_score ?? perception
    return {
      id,
      perception,
      facts,
      credited: {
        value,
        limited: Boolean(c?.cut_by_facts),
        reason: c?.cut_by_facts ? (c.rule ?? undefined) : undefined,
      },
    }
  })
}

/** Прапорці групи респондентів (коди бекенду) простою мовою. */
const GROUP_FLAG: Record<string, [string, string]> = {
  low_participation: ['minor', 'Низька участь: відповіла менша частка запрошених'],
  suspiciously_perfect: ['serious', 'Підозріло однакові «ідеальні» відповіді'],
  insufficient_data: ['minor', 'Недостатньо відповідей для висновку'],
}

function flagsOf(r: S['CampaignResultsOut']): TrustFlag[] {
  const out: TrustFlag[] = []
  const seen = new Set<string>()
  const add = (f: S['Flag'], where: string) => {
    const id = `${f.code}:${where}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({
      id,
      weight: f.severity === 'serious' ? 'major' : 'minor',
      raised: true,
      title: where ? `${where}: ${f.title}` : f.title,
      explanation: f.title,
    })
  }
  for (const c of r.components) for (const f of c.flags ?? []) add(f, c.title)
  for (const g of r.groups)
    for (const code of g.flags ?? [])
      if (GROUP_FLAG[code])
        add({ code, severity: GROUP_FLAG[code]![0], title: GROUP_FLAG[code]![1] }, g.title)
  return out
}

function insightsOf(
  components: ComponentResult[],
  index: number,
  firstIndex: number,
): {
  attention: Insight[]
  strengths: Insight[]
} {
  const sorted = [...components].sort((a, b) => a.credited.value - b.credited.value)
  const attention: Insight[] = sorted.slice(0, 3).map((c) => ({
    id: `a-${c.id}`,
    title: c.credited.limited
      ? `${COMPONENT_LABELS[c.id]}: підтвердити фактами`
      : `${COMPONENT_LABELS[c.id]}: підсилити напрям`,
    component: c.id,
    value: c.credited.value,
    hint: `Зараховане значення компонента ${COMPONENT_LABELS[c.id]}, 0-100.`,
  }))
  const top = sorted[sorted.length - 1]!
  const strengths: Insight[] = [
    {
      id: 's1',
      title: `Найвищий результат у компоненті ${COMPONENT_LABELS[top.id]}`,
      component: top.id,
      value: top.credited.value,
      hint: `Зараховане значення компонента ${COMPONENT_LABELS[top.id]}, 0-100.`,
    },
  ]
  if (index !== firstIndex)
    strengths.push({
      id: 's2',
      title:
        index > firstIndex ? 'Зростання індексу з першої хвилі' : 'Зміна індексу з першої хвилі',
      value: round1(index - firstIndex),
      hint: 'Сумарна зміна індексу з першої закритої хвилі, у пунктах.',
    })
  return { attention, strengths }
}

export interface ApiInstitution extends Institution {
  campaignId: string
  unitId: string
  cycleLabel: string
  cycleDate: string
}

/** Знімок хвилі + історія підрозділу → модель екранів «Огляд», «Розклад», «Порівняння», «Динаміка», «Звіт». */
export function toInstitution(
  r: S['CampaignResultsOut'],
  h: S['HistoryOut'] | null,
): ApiInstitution {
  const components = componentsOf(r.components)
  const points = h?.points?.length ? h.points : []
  const labels = cycleLabels(points)
  let series: CyclePoint[] = points.map((p, i) => ({
    cycle: labels[i]!,
    index: p.index ?? 0,
    components: Object.fromEntries(
      COMPONENT_IDS.map((id) => [
        id,
        (p.components as Record<string, number | null> | undefined)?.[id] ?? 0,
      ]),
    ) as Record<ComponentId, number>,
  }))
  const current: CyclePoint = {
    cycle: r.closed_on ? r.closed_on.slice(0, 7) : r.campaign_title,
    index: r.index.score ?? 0,
    components: Object.fromEntries(components.map((c) => [c.id, c.credited.value])) as Record<
      ComponentId,
      number
    >,
  }
  const at = points.findIndex((p) => p.campaign_id === r.campaign_id)
  if (at >= 0) series = series.slice(0, at + 1)
  else series = [...series, current]
  // Екрани порівнюють з попередньою хвилею: якщо хвиля одна, попередня = поточна (зміна 0).
  if (series.length === 1) series = [series[0]!, series[0]!]
  const cur = series[series.length - 1]!
  const prev = series[series.length - 2]!

  const events: TrendEvent[] = points.flatMap((p, i) =>
    i > 0 && (p.measures_done ?? 0) > 0
      ? [
          {
            id: `ev-${p.campaign_id}`,
            afterCycle: labels[i - 1]!,
            title: `Виконано заходів між хвилями: ${p.measures_done}`,
          },
        ]
      : [],
  )

  const flags = flagsOf(r)
  const participation: ParticipationRow[] = (['wg', 'os', 'experts'] as const).map((id) => {
    const g = r.groups.filter((x) => CATEGORY_TO_PARTICIPATION[x.category] === id)
    return {
      id,
      answered: g.reduce((s, x) => s + (x.submitted ?? 0), 0),
      invited: g.reduce((s, x) => s + (x.eligible ?? 0), 0),
    }
  })
  const responses = participation.reduce((s, p) => s + p.answered, 0)
  const index = r.index.score ?? cur.index
  const { attention, strengths } = insightsOf(components, index, series[0]!.index)
  const limited = components.find((c) => c.credited.limited)

  return {
    id: r.unit_id,
    name: r.unit_name,
    components,
    perceptionItems: perceptionItemsOf(r.components),
    factItems: factItemsOf(r.components),
    series,
    events,
    flags,
    trust: { grade: trustGradeOf(r.index.reliability), raised: flags },
    responses,
    participation,
    index,
    level: clampLevel(r.index.level?.level, levelOf(index)),
    previousIndex: prev.index,
    delta: deltaOf(index, prev.index),
    summaryReason:
      r.index.reliability_reasons?.[0] ??
      (limited
        ? `${COMPONENT_LABELS[limited.id]}: самооцінку не підтверджують факти`
        : 'Суттєвих розбіжностей між сприйняттям і фактами немає'),
    attention,
    strengths,
    campaignId: r.campaign_id,
    unitId: r.unit_id,
    cycleLabel: cur.cycle,
    cycleDate: fmtDateUa(r.closed_on),
  }
}

// ---------- Рекомендації й заходи ----------

const DECISION_STATUS: Record<string, RecommendationStatus> = {
  accepted: 'accepted',
  clarify: 'clarified',
  rejected: 'rejected',
}

const PRIORITY: Record<string, Priority> = { high: 'high', medium: 'medium', low: 'low' }

export interface ApiRecommendation extends Recommendation {
  /** Коментар або причина з рішення керівника. */
  note?: string
}

const BASIS_LABEL: Record<string, string> = {
  self_score: 'Самооцінка',
  facts_score: 'Факти',
  score: 'Зараховано',
  percent: 'Відсоток',
  participation_percent: 'Участь, %',
  confirmed_share: 'Частка підтверджених пунктів',
  confirmed: 'Підтверджено пунктів',
  total: 'Усього',
  found: 'Знайдено',
  pending: 'Не розглянуто',
  change: 'Зміна',
  numerator: 'Виконано',
  denominator: 'Усього',
  level: 'Рівень',
  high: 'Високих',
  medium: 'Середніх',
  low: 'Низьких',
}

export function toRecommendation(r: S['RecommendationOut']): ApiRecommendation {
  const status = r.decision ? (DECISION_STATUS[r.decision.decision] ?? 'proposed') : 'proposed'
  const basis = Object.entries((r.basis ?? {}) as Record<string, unknown>)
    .filter(([k, v]) => typeof v === 'number' && k in BASIS_LABEL)
    .slice(0, 4)
  const comment = r.decision?.comment?.trim()
  return {
    id: r.code,
    title: r.title,
    priority: PRIORITY[r.priority] ?? 'medium',
    component: isComponentId(r.component) ? r.component : 'system',
    evidence: basis.map(([k, v]) => ({
      id: `${r.code}-${k}`,
      kind: 'item' as const,
      label: BASIS_LABEL[k] ?? k,
      valueText: String(round1(v as number)).replace('.', ','),
      href: isComponentId(r.component) ? `/explain?open=${r.component}` : '/explain',
    })),
    why: `${r.description} Правило: ${r.rule}`,
    actions: r.suggested_measures.length
      ? r.suggested_measures
          .slice(0, 4)
          .map((m) => (m.catalog_number ? `${m.catalog_number}. ${m.title}` : m.title))
      : ['Обговорити з робочою групою й визначити захід'],
    status,
    note:
      comment && status === 'rejected'
        ? `Причина відхилення: ${comment}`
        : comment && status === 'clarified'
          ? `Коментар до уточнення: ${comment}`
          : undefined,
  }
}

const MEASURE_STATUS: Record<string, MeasureStatus> = {
  planned: 'accepted',
  in_progress: 'inprogress',
  done: 'done',
  cancelled: 'notconfirmed',
}
export const BACKEND_MEASURE_STATUS: Partial<Record<MeasureStatus, string>> = {
  accepted: 'planned',
  inprogress: 'in_progress',
  done: 'done',
}

export function toMeasure(m: S['MeasureOut']): Measure {
  return {
    id: m.id,
    recommendationId: m.recommendation_code ?? '',
    title: m.title,
    responsiblePosition: m.owner,
    dueDate: m.due_date,
    status: MEASURE_STATUS[m.status] ?? 'accepted',
    verification: null,
  }
}

// ---------- Анкета ----------

const SECTION_ABOUT: Record<ComponentId, string> = {
  culture: 'про ставлення до доброчесності',
  system: 'про правила й процедури',
  accountability: 'про відповідальність і контроль',
}

const CATEGORY_LABEL: Record<string, string> = {
  working_group: 'Робоча група',
  staff: 'Особовий склад',
  expert: 'Зовнішні експерти',
}

const componentByTitle = (title: string): ComponentId | null =>
  /культур/i.test(title)
    ? 'culture'
    : /систем/i.test(title)
      ? 'system'
      : /підзвітн/i.test(title)
        ? 'accountability'
        : null

/** Форма бекенду → модель анкети інтерфейсу. Рівень варіанта — його порядок у питанні (бали не приходять). */
export function toSurvey(form: S['FormOut'], category?: string | null): Survey {
  const sections: SurveySection[] = form.sections.map((s, si) => {
    const guessed = componentByTitle(s.title)
    const comp: ComponentId = guessed ?? COMPONENT_IDS[si % 3]!
    return {
      id: comp,
      title: s.title,
      about: guessed ? SECTION_ABOUT[comp] : 'за темою розділу',
      questions: s.questions.map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options.map((o, oi) => ({
          id: o.id,
          text: o.text,
          level: Math.min(5, oi + 1) as 1 | 2 | 3 | 4 | 5,
        })),
      })),
    }
  })
  return {
    id: form.questionnaire_id,
    title: form.title,
    category: CATEGORY_LABEL[category ?? ''] ?? form.title,
    sections,
  }
}
