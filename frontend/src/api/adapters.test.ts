/** Адаптери на справжніх відповідях бекенду (зняті з демо-seed, src/api/__fixtures__). */
import { describe, expect, it } from 'vitest'
import { indexOf, weightedMean, COMPONENT_IDS } from '@/lib/scoring/methodology'
import type { Schemas } from './client'
import {
  cycleLabels,
  toInstitution,
  toMeasure,
  toRecommendation,
  toSurvey,
  trustGradeOf,
} from './adapters'
import results from './__fixtures__/results.json'
import history from './__fixtures__/history.json'
import recs from './__fixtures__/recommendations.json'

const R = results as unknown as Schemas['CampaignResultsOut']
const H = history as unknown as Schemas['HistoryOut']

describe('toInstitution', () => {
  const inst = toInstitution(R, H)

  it('бере індекс і компоненти з бекенду без перерахунку', () => {
    expect(inst.index).toBe(R.index.score)
    for (const c of R.components) {
      const mine = inst.components.find((x) => x.id === c.code)!
      expect(mine.credited.value).toBe(c.score)
      expect(mine.perception).toBe(c.self_score)
      expect(mine.credited.limited).toBe(c.cut_by_facts)
    }
  })

  it('методика збігається: середнє зарахованих = індекс бекенду', () => {
    const credited = Object.fromEntries(inst.components.map((c) => [c.id, c.credited.value]))
    expect(Math.abs(indexOf(credited as never) - inst.index)).toBeLessThanOrEqual(0.1)
  })

  it('джерела сприйняття складаються в самооцінку компонента', () => {
    for (const id of COMPONENT_IDS) {
      const items = inst.perceptionItems.filter((i) => i.component === id)
      const c = inst.components.find((x) => x.id === id)!
      expect(Math.abs(weightedMean(items) - c.perception)).toBeLessThanOrEqual(0.2)
    }
  })

  it('факти мають «X з Y»', () => {
    const withCount = inst.factItems.filter((f) => f.count)
    expect(withCount.length).toBeGreaterThan(0)
    for (const f of withCount) expect(f.count!.denominator).toBeGreaterThan(0)
  })

  it('динаміка з історії, участь за категоріями, достовірність', () => {
    expect(inst.series.map((p) => p.cycle)).toEqual(['2026-05', '2026-11'])
    expect(inst.delta).toBeCloseTo(inst.index - inst.series[0]!.index, 1)
    expect(inst.participation.map((p) => p.id)).toEqual(['wg', 'os', 'experts'])
    expect(inst.participation.every((p) => p.answered <= p.invited)).toBe(true)
    expect(inst.trust.grade).toBe(trustGradeOf(R.index.reliability))
    expect(inst.cycleDate).toMatch(/^\d\d\.\d\d\.\d{4}$/)
  })

  it('одна хвиля: попередня = поточна, зміна 0', () => {
    const one = toInstitution(R, { ...H, points: H.points.slice(-1) })
    expect(one.series).toHaveLength(2)
    expect(one.delta).toBe(0)
  })
})

describe('інші адаптери', () => {
  it('рекомендації: код, пріоритет, статус рішення, дії з каталогу', () => {
    const list = (recs as unknown as Schemas['RecommendationsOut']).items.map(toRecommendation)
    expect(list[0]!.id).toBe('cut:accountability')
    expect(list[0]!.priority).toBe('high')
    expect(list.every((r) => r.actions.length > 0)).toBe(true)
    const decided = toRecommendation({
      ...(recs as unknown as Schemas['RecommendationsOut']).items[0]!,
      decision: {
        decision: 'rejected',
        comment: 'Немає ресурсу',
        decided_at: '2026-11-17T10:00:00Z',
      },
    })
    expect(decided.status).toBe('rejected')
    expect(decided.note).toBe('Причина відхилення: Немає ресурсу')
  })

  it('заходи: статуси бекенду → статуси трекера', () => {
    const base = {
      id: 'm1',
      unit_id: 'u',
      campaign_id: null,
      recommendation_code: 'gap:culture',
      component: null,
      catalog_number: null,
      title: 'Захід',
      description: '',
      owner: 'Начальник штабу',
      due_date: '2026-12-01',
      done_on: null,
      evidence: '',
      overdue: false,
      overdue_days: null,
      external_id: null,
      external_source: null,
      created_at: '',
      updated_at: '',
    }
    expect(toMeasure({ ...base, status: 'planned' }).status).toBe('accepted')
    expect(toMeasure({ ...base, status: 'in_progress' }).status).toBe('inprogress')
    expect(toMeasure({ ...base, status: 'done' }).responsiblePosition).toBe('Начальник штабу')
  })

  it('анкета: розділи за назвою, варіанти без балів', () => {
    const s = toSurvey(
      {
        campaign_id: 'c',
        questionnaire_id: 'q',
        title: 'Анкета 2',
        description: '',
        sections: [
          {
            id: 's1',
            title: 'Підзвітність',
            questions: [
              {
                id: 'q1',
                text: 'Питання',
                help_text: '',
                type: 'single_choice',
                required: true,
                scale_min: null,
                scale_max: null,
                options: [
                  { id: 'o1', text: 'A' },
                  { id: 'o2', text: 'B' },
                ],
              },
            ],
          },
        ],
      },
      'staff',
    )
    expect(s.category).toBe('Особовий склад')
    expect(s.sections[0]!.id).toBe('accountability')
    expect(s.sections[0]!.questions[0]!.options.map((o) => o.level)).toEqual([1, 2])
  })

  it('мітки циклів не повторюються', () => {
    expect(
      cycleLabels([
        { closed_on: '2026-11-01', campaign_title: 'A' },
        { closed_on: '2026-11-20', campaign_title: 'B' },
      ]),
    ).toEqual(['2026-11', '2026-11 (2)'])
  })
})
