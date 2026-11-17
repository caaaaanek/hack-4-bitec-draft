import { describe, expect, it } from 'vitest'
import { COMPONENT_IDS, K_MIN_GROUP, creditedOf, indexOf, levelOf } from '@/lib/scoring/methodology'
import { buildTree, sumCheck, treeIsConsistent, type ExplainMode } from '@/lib/scoring/explain'
import { trustGrade } from '@/lib/scoring/trust'
import { INSTITUTIONS, ALPHA_ID, institutionById, rng } from './institutions'
import { DATA_SOURCES, SOURCE_MODE_LABEL } from './dataSources'

describe('заклади для спостерігача', () => {
  it('чотири вигадані заклади в алфавітному порядку за назвою', () => {
    expect(INSTITUTIONS).toHaveLength(4)
    const names = INSTITUTIONS.map((i) => i.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'uk')))
    expect(names).toContain('Умовний військовий інститут «Альфа»')
    expect(names.every((n) => n.startsWith('Умовн'))).toBe(true)
  })

  it('генератор детермінований', () => {
    const a = rng(5)
    const b = rng(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  for (const inst of INSTITUTIONS) {
    describe(inst.name, () => {
      it('індекс, рівень і зараховане збігаються з функціями методики', () => {
        const credited = Object.fromEntries(
          inst.components.map((c) => [c.id, c.credited.value]),
        ) as Record<(typeof COMPONENT_IDS)[number], number>
        expect(inst.index).toBe(indexOf(credited))
        expect(inst.level).toBe(levelOf(inst.index))
        for (const c of inst.components) {
          expect(c.credited).toEqual(creditedOf(c.perception, c.facts))
          expect(c.credited.value).toBeLessThanOrEqual(c.perception)
        }
      })

      it('динаміка: 4 цикли, останній поточний, дельта узгоджена', () => {
        expect(inst.series.map((p) => p.cycle)).toEqual([
          '2025-06',
          '2025-12',
          '2026-06',
          '2026-11',
        ])
        expect(inst.series[3]!.index).toBe(inst.index)
        expect(inst.series[2]!.index).toBe(inst.previousIndex)
        expect(inst.delta).toBeCloseTo(inst.index - inst.previousIndex, 1)
      })

      it('достовірність відповідає прапорцям і k', () => {
        expect(inst.trust.grade).toBe(trustGrade(inst.flags, inst.responses, K_MIN_GROUP))
        expect(inst.trust.raised).toEqual(inst.flags.filter((f) => f.raised))
      })

      it('розклад консистентний у всіх режимах, сума внесків дорівнює індексу', () => {
        for (const mode of ['perception', 'facts', 'credited'] as ExplainMode[]) {
          const tree = buildTree(mode, inst.components, inst.perceptionItems, inst.factItems)
          expect(treeIsConsistent(tree)).toBe(true)
          if (mode === 'credited') expect(sumCheck(tree)).toBeCloseTo(inst.index, 1)
        }
      })

      it('ваги питань у межах компонента дають 100', () => {
        for (const id of COMPONENT_IDS)
          for (const items of [inst.perceptionItems, inst.factItems])
            expect(items.filter((i) => i.component === id).reduce((s, i) => s + i.weight, 0)).toBe(
              100,
            )
      })

      it('участь за категоріями дає суму відповідей, відповіли не більше за запрошених', () => {
        expect(inst.participation.reduce((s, p) => s + p.answered, 0)).toBe(inst.responses)
        for (const p of inst.participation) expect(p.answered).toBeLessThanOrEqual(p.invited)
      })

      it('є що показати: напрями, сильні сторони, події', () => {
        expect(inst.attention.length).toBeGreaterThanOrEqual(3)
        expect(inst.strengths.length).toBeGreaterThanOrEqual(2)
        expect(inst.events.length).toBeGreaterThan(0)
      })
    })
  }

  it('Альфа має повні демо-дані з індексом 54,2', () => {
    expect(institutionById(ALPHA_ID).index).toBe(54.2)
    expect(institutionById('unknown').id).toBe(ALPHA_ID)
  })
})

describe('джерела даних', () => {
  it('сім метрик, чотири чесні режими', () => {
    expect(DATA_SOURCES).toHaveLength(7)
    expect(Object.values(SOURCE_MODE_LABEL)).toEqual([
      'Автоматично',
      'Ручний ввід',
      'Планується',
      'Потребує погодження',
    ])
  })
})
