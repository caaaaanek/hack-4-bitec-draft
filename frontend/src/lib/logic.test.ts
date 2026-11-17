import { describe, expect, it } from 'vitest'
import { buildRecommendations, canRecommendationMove, priorityOf } from './recommendations'
import { components, factItems, perceptionItems, trustFlags } from '@/demo/data'
import { alphaEvents, alphaSeries } from '@/demo/trends'
import { DEMO_MEASURES, TODAY } from '@/demo/measures'
import {
  canMeasureMove,
  daysOverdue,
  effectiveStatus,
  measureSummary,
  overdueText,
} from './measures'
import {
  EMPTY_DECISIONS,
  accept,
  allMeasures,
  applyDecisions,
  clarify,
  reject,
  setMeasureStatus,
} from './decisions'
import { compareCycles, directionOf, eventsBetween, sliceSeries } from './trends'

const recs = () =>
  buildRecommendations({
    items: [...perceptionItems, ...factItems],
    flags: trustFlags,
  })

describe('рекомендації', () => {
  it('демо дає 5 рекомендацій: три з Підзвітності, по одній із Системи й Культури', () => {
    const list = recs()
    expect(list).toHaveLength(5)
    const count = (c: string) => list.filter((r) => r.component === c).length
    expect([count('accountability'), count('system'), count('culture')]).toEqual([3, 1, 1])
    for (const r of list) {
      expect(r.actions.length).toBeGreaterThanOrEqual(2)
      expect(r.actions.length).toBeLessThanOrEqual(3)
      expect(r.evidence.length).toBeGreaterThan(0)
      expect(r.evidence.every((e) => e.href.startsWith('/explain?c='))).toBe(true)
      expect(r.status).toBe('proposed')
    }
  })

  it('порожні дані без слабких показників не дають рекомендацій', () => {
    const strong = [...perceptionItems, ...factItems].map((i) => ({ ...i, value: 90 }))
    expect(buildRecommendations({ items: strong, flags: [] })).toEqual([])
  })

  it('пріоритет залежить від найслабшого показника й прапорця', () => {
    expect(priorityOf([30], false)).toBe('high')
    expect(priorityOf([45], true)).toBe('high')
    expect(priorityOf([60], false)).toBe('medium')
    expect(priorityOf([80], false)).toBe('low')
  })

  it('сортує від високого пріоритету', () => {
    const order = { high: 0, medium: 1, low: 2 }
    const p = recs().map((r) => order[r.priority])
    expect(p).toEqual([...p].sort())
  })

  it('переходи статусів: прийняте й відхилене остаточні', () => {
    expect(canRecommendationMove('proposed', 'accepted')).toBe(true)
    expect(canRecommendationMove('clarified', 'accepted')).toBe(true)
    expect(canRecommendationMove('accepted', 'rejected')).toBe(false)
    expect(canRecommendationMove('rejected', 'accepted')).toBe(false)
  })
})

describe('рішення', () => {
  const rec = recs()[0]!
  it('прийняття створює захід, повторне нічого не змінює', () => {
    const s = accept(EMPTY_DECISIONS, rec, {
      position: 'Начальник штабу',
      dueDate: '2027-02-01',
      measureId: 'm-new',
    })
    expect(applyDecisions([rec], s)[0]!.status).toBe('accepted')
    expect(s.added[0]).toMatchObject({ recommendationId: rec.id, status: 'accepted' })
    expect(accept(s, rec, { position: 'x', dueDate: '2027-02-01', measureId: 'm2' })).toBe(s)
  })
  it('відхилення без причини неможливе', () => {
    expect(reject(EMPTY_DECISIONS, rec.id, '   ')).toBe(EMPTY_DECISIONS)
    expect(reject(EMPTY_DECISIONS, rec.id, 'Вже робимо').recommendations[rec.id]).toMatchObject({
      status: 'rejected',
      reason: 'Вже робимо',
    })
  })
  it('уточнення зберігає коментар, потім можна прийняти', () => {
    const s = clarify(EMPTY_DECISIONS, rec.id, 'Потрібні деталі')
    expect(s.recommendations[rec.id]).toMatchObject({
      status: 'clarified',
      comment: 'Потрібні деталі',
    })
    const s2 = accept(s, rec, { position: 'a', dueDate: '2027-01-01', measureId: 'm3' })
    expect(s2.recommendations[rec.id]!.status).toBe('accepted')
  })
  it('ручна зміна статусу заходу дотримується переходів', () => {
    const list = allMeasures(DEMO_MEASURES, EMPTY_DECISIONS)
    const s = setMeasureStatus(EMPTY_DECISIONS, list, 'm-6', 'inprogress')
    expect(allMeasures(DEMO_MEASURES, s).find((m) => m.id === 'm-6')!.status).toBe('inprogress')
    expect(setMeasureStatus(EMPTY_DECISIONS, list, 'm-6', 'done')).toBe(EMPTY_DECISIONS)
    expect(canMeasureMove('confirmed', 'inprogress')).toBe(false)
  })
})

describe('заходи', () => {
  it('шість заходів, один прострочений, один підтверджений, один виконаний без підтвердження', () => {
    expect(DEMO_MEASURES).toHaveLength(6)
    expect(measureSummary(DEMO_MEASURES, TODAY)).toEqual({ total: 6, overdue: 1 })
    const confirmed = DEMO_MEASURES.filter((m) => m.status === 'confirmed')
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]!.verification).toBe('Підтверджено наступним оцінюванням')
    const done = DEMO_MEASURES.filter((m) => m.status === 'done')
    expect(done).toHaveLength(1)
    expect(done[0]!.verification).toBeNull()
  })
  it('«Прострочено» детерміновано залежить від дати', () => {
    const m = { dueDate: '2026-11-05', status: 'inprogress' as const }
    expect(effectiveStatus(m, '2026-11-05')).toBe('inprogress')
    expect(effectiveStatus(m, '2026-11-06')).toBe('overdue')
    expect(daysOverdue(m, '2026-11-16')).toBe(11)
    expect(effectiveStatus({ ...m, status: 'done' }, '2027-01-01')).toBe('done')
  })
  it('текст про прострочення має правильну форму слова', () => {
    expect(overdueText(1)).toBe('Прострочено на 1 день')
    expect(overdueText(3)).toBe('Прострочено на 3 дні')
    expect(overdueText(11)).toBe('Прострочено на 11 днів')
    expect(overdueText(21)).toBe('Прострочено на 21 день')
  })
  it('посади, а не імена', () => {
    for (const m of DEMO_MEASURES)
      expect(m.responsiblePosition).toMatch(/^(Заступник|Начальник|Уповноважений)/)
  })
})

describe('динаміка', () => {
  const series = alphaSeries()
  it('чотири цикли, зростання індексу, остання точка 54,2', () => {
    expect(series.map((p) => p.cycle)).toEqual(['2025-06', '2025-12', '2026-06', '2026-11'])
    expect(series[3]!.index).toBe(54.2)
    expect(series.every((p, i) => i === 0 || p.index > series[i - 1]!.index)).toBe(true)
  })
  it('зріз періоду й некоректні межі', () => {
    expect(sliceSeries(series, '2025-12', '2026-06').map((p) => p.cycle)).toEqual([
      '2025-12',
      '2026-06',
    ])
    expect(sliceSeries(series, '2026-06', '2025-12')).toEqual([])
  })
  it('порівняння двох циклів: дельта й напрям', () => {
    const rows = compareCycles(series[0]!, series[3]!)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({
      id: 'index',
      before: 34.7,
      after: 54.2,
      delta: 19.5,
      direction: 'up',
    })
    expect(directionOf(-0.1)).toBe('down')
    expect(directionOf(0)).toBe('same')
  })
  it('події між циклами', () => {
    expect(alphaEvents).toHaveLength(3)
    expect(
      eventsBetween(alphaEvents, series, '2025-12', '2026-11').map((e) => e.afterCycle),
    ).toEqual(['2025-12', '2026-06'])
  })
  it('компоненти з тестових даних: Підзвітність зараховано з обмеженням', () => {
    expect(components.find((c) => c.id === 'accountability')!.credited.limited).toBe(true)
  })
})
