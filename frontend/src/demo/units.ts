/** Синтетична ієрархія підрозділів. Назви нейтральні, глибина довільна (дерево за parentId). */
import { K_MIN_GROUP } from '../lib/scoring/methodology'

export interface Unit {
  id: string
  name: string
  parentId: string | null
}

export const ROOT_UNIT_ID = 'alpha'

export const units: Unit[] = [
  { id: ROOT_UNIT_ID, name: 'Умовний військовий інститут «Альфа»', parentId: null },
  { id: 'unit-a', name: 'Підрозділ А', parentId: ROOT_UNIT_ID },
  { id: 'unit-b', name: 'Підрозділ Б', parentId: ROOT_UNIT_ID },
  { id: 'unit-v', name: 'Підрозділ В', parentId: ROOT_UNIT_ID },
]

/** Кількість відповідей на цикл (синтетично). */
export const unitResponses: Record<string, number> = {
  [ROOT_UNIT_ID]: 48,
  'unit-a': 12,
  'unit-b': 3,
  'unit-v': 33,
}

export const unitById = (id: string, list: readonly Unit[] = units): Unit | undefined =>
  list.find((u) => u.id === id)

export const parentOf = (id: string, list: readonly Unit[] = units): Unit | undefined => {
  const u = unitById(id, list)
  return u?.parentId ? unitById(u.parentId, list) : undefined
}

export interface ResolvedScope {
  /** Підрозділ, дані якого показано. */
  unit: Unit
  /** Підрозділ, який запитували. */
  requested: Unit
  /** true, якщо запитаний підрозділ малий і показано дані рівня вище. */
  hidden: boolean
  responses: number
}

/**
 * Якщо в підрозділі менше k відповідей, його дані додаються до батьківського:
 * піднімаємося вгору, доки не знайдемо групу не менше k.
 */
export function resolveScope(
  id: string,
  responses: Record<string, number> = unitResponses,
  k: number = K_MIN_GROUP,
  list: readonly Unit[] = units,
): ResolvedScope {
  const requested = unitById(id, list) ?? list[0]!
  let cur: Unit = requested
  while ((responses[cur.id] ?? 0) < k && cur.parentId) {
    cur = unitById(cur.parentId, list) ?? cur
  }
  return {
    unit: cur,
    requested,
    hidden: cur.id !== requested.id,
    responses: responses[cur.id] ?? 0,
  }
}
