import { describe, expect, it } from 'vitest'
import { components, currentIndex, factItems, perceptionItems } from '@/demo/data'
import { buildTree, sumCheck, treeIsConsistent, visibleNodes, type ExplainMode } from './explain'

const modes: ExplainMode[] = ['perception', 'facts', 'credited']
const tree = (m: ExplainMode) => buildTree(m, components, perceptionItems, factItems)

describe('розклад індексу', () => {
  it('сума внесків дорівнює внеску батька на кожному рівні в усіх режимах', () => {
    for (const m of modes) expect(treeIsConsistent(tree(m))).toBe(true)
  })
  it('режим «Зараховано»: сума внесків дорівнює індексу 54,2', () => {
    expect(sumCheck(tree('credited'))).toBe(currentIndex)
    expect(tree('credited').value).toBe(54.2)
  })
  it('інші режими: середнє за компонентами', () => {
    expect(sumCheck(tree('perception'))).toBe(60.8)
    expect(sumCheck(tree('facts'))).toBe(43.3)
  })
  it('ваги питань у компоненті дають 100, обмежувач позначено на Підзвітності', () => {
    const t = tree('credited')
    for (const c of t.children!) expect(c.children!.reduce((s, i) => s + i.weight, 0)).toBe(100)
    expect(t.children!.filter((c) => c.limited).map((c) => c.id)).toEqual(['accountability'])
    expect(t.children!.find((c) => c.id === 'accountability')!.value).toBe(60)
  })
  it('видимі вузли залежать від розкритих', () => {
    const t = tree('credited')
    expect(visibleNodes(t, new Set(['index'])).length).toBe(4)
    expect(visibleNodes(t, new Set(['index', 'culture'])).length).toBe(8)
  })
})
