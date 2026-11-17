/**
 * Розклад індексу: дерево Індекс, Компонент, Питання або індикатор.
 * Використовує ті самі функції методики (methodology.ts), нічого не дублює.
 */
import {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  COMPONENT_WEIGHT,
  contributionOf,
  indexOf,
  round1,
  type ComponentId,
} from './methodology'

export type ExplainMode = 'perception' | 'facts' | 'credited'
export type NodeSource = 'wg' | 'os' | 'experts' | 'facts'

export interface ExplainItem {
  id: string
  component: ComponentId
  label: string
  /** Частка в компоненті, %. */
  weight: number
  /** Значення 0-100. */
  value: number
  source: NodeSource
  hint: string
  count?: { numerator: number; denominator: number; percent: number }
}

export interface ExplainComponent {
  id: ComponentId
  perception: number
  facts: number
  credited: { value: number; limited: boolean; reason?: string }
}

export interface TreeNode {
  id: string
  kind: 'index' | 'component' | 'item'
  label: string
  /** Вага у батьківському вузлі, %. */
  weight: number
  value: number
  /** Внесок в індекс, пункти (без округлення). */
  contribution: number
  source?: NodeSource
  /** Обмежувач спрацював (для компонента й його питань у режимі «Зараховано»). */
  limited?: boolean
  reason?: string
  hint: string
  /** Факт-відсоток: «87 з 100 (87%)». */
  count?: { numerator: number; denominator: number; percent: number }
  children?: TreeNode[]
}

export const MODE_LABELS: Record<ExplainMode, string> = {
  perception: 'Сприйняття',
  facts: 'Факти',
  credited: 'Зараховано',
}

/**
 * Режим «Зараховано»: обмежувач діє на рівні компонента. Значення його питань показано
 * пропорційно (значення питання, помножене на зараховане/сприйняття компонента),
 * тож їхні внески в сумі дають внесок компонента.
 */
export function buildTree(
  mode: ExplainMode,
  comps: readonly ExplainComponent[],
  perceptionItems: readonly ExplainItem[],
  factItems: readonly ExplainItem[],
): TreeNode {
  const children: TreeNode[] = COMPONENT_IDS.map((id) => {
    const c = comps.find((x) => x.id === id)!
    const value =
      mode === 'perception' ? c.perception : mode === 'facts' ? c.facts : c.credited.value
    const limited = mode === 'credited' && c.credited.limited
    const src = mode === 'facts' ? factItems : perceptionItems
    const factor = mode === 'credited' && c.perception > 0 ? c.credited.value / c.perception : 1
    const items: TreeNode[] = src
      .filter((i) => i.component === id)
      .map((i) => {
        const v = i.value * factor
        return {
          id: i.id,
          kind: 'item' as const,
          label: i.label,
          weight: i.weight,
          value: v,
          contribution: contributionOf(v) * (i.weight / 100),
          source: i.source,
          limited: limited || undefined,
          hint: i.hint,
          count: mode === 'facts' ? i.count : undefined,
        }
      })
    return {
      id,
      kind: 'component' as const,
      label: COMPONENT_LABELS[id],
      weight: round1(COMPONENT_WEIGHT * 100),
      value,
      contribution: contributionOf(value),
      limited: limited || undefined,
      reason: limited ? c.credited.reason : undefined,
      hint: 'Значення компонента за обраним режимом, 0-100. Усі компоненти мають однакову вагу.',
      children: items,
    }
  })
  const value = indexOf0(children)
  return {
    id: 'index',
    kind: 'index',
    label: 'Індекс доброчесності',
    weight: 100,
    value,
    contribution: children.reduce((s, c) => s + c.contribution, 0),
    hint: 'Сума внесків трьох компонентів, 0-100.',
    children,
  }
}

const indexOf0 = (cs: TreeNode[]): number =>
  indexOf(Object.fromEntries(cs.map((c) => [c.id, c.value])) as Record<ComponentId, number>)

/** Перевірка: сума внесків дочірніх вузлів дорівнює внеску батька на кожному рівні (з похибкою). */
export function treeIsConsistent(node: TreeNode, eps = 1e-9): boolean {
  if (!node.children) return true
  const sum = node.children.reduce((s, c) => s + c.contribution, 0)
  return (
    Math.abs(sum - node.contribution) < eps && node.children.every((c) => treeIsConsistent(c, eps))
  )
}

/** Сума внесків компонентів, округлена до 0,1. */
export const sumCheck = (root: TreeNode): number =>
  round1((root.children ?? []).reduce((s, c) => s + c.contribution, 0))

/** Видимі вузли (плоский список з рівнем) за набором розкритих id. */
export function visibleNodes(
  root: TreeNode,
  expanded: ReadonlySet<string>,
): { node: TreeNode; level: number; parentId?: string; pos: number; size: number }[] {
  const out: ReturnType<typeof visibleNodes> = []
  const walk = (
    n: TreeNode,
    level: number,
    parentId: string | undefined,
    pos: number,
    size: number,
  ) => {
    out.push({ node: n, level, parentId, pos, size })
    if (n.children && expanded.has(n.id))
      n.children.forEach((c, i) => walk(c, level + 1, n.id, i + 1, n.children!.length))
  }
  walk(root, 1, undefined, 1, 1)
  return out
}
