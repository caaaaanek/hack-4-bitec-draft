/** Узагальнені результати підрозділу для екрана учасника (синтетичні). Лише агрегати, без відповідей. */
import {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  K_MIN_GROUP,
  indexOf,
  levelOf,
  type ComponentId,
} from '@/lib/scoring/methodology'
import type { MaturityLevel } from '@/components/ui/config'
import { currentCredited } from './data'
import { ROOT_UNIT_ID, resolveScope, unitResponses, type ResolvedScope } from './units'

/** Зараховані значення компонентів за підрозділами (0-100). Підрозділ без власних даних бере дані закладу. */
const UNIT_CREDITED: Record<string, Record<ComponentId, number>> = {
  [ROOT_UNIT_ID]: currentCredited,
  'unit-a': { culture: 58, system: 47, accountability: 52 },
}

const DONE = [
  'Спростили процедуру звернень: тепер подати звернення можна за кілька хвилин.',
  'Провели два практичних заняття з прикладами з роботи закладу.',
  'Оприлюднили підсумки минулої перевірки разом із кроками, що робитимуть далі.',
]
const NEXT = [
  'Опублікуємо короткий посібник про те, куди й як повідомляти про проблеми.',
  'У наступному циклі окремо запитаємо, чи стало зрозуміліше, що відбувається після звернення.',
]

export interface MyComponent {
  id: ComponentId
  label: string
  value: number
  level: MaturityLevel
}

export interface MyResultsView {
  resolved: ResolvedScope
  index: number
  level: MaturityLevel
  components: MyComponent[]
  done: string[]
  next: string[]
}

export function getMyResults(
  unitId: string,
  responses: Record<string, number> = unitResponses,
  k: number = K_MIN_GROUP,
): MyResultsView {
  const resolved = resolveScope(unitId, responses, k)
  const credited = UNIT_CREDITED[resolved.unit.id] ?? currentCredited
  const index = indexOf(credited)
  return {
    resolved,
    index,
    level: levelOf(index),
    components: COMPONENT_IDS.map((id) => ({
      id,
      label: COMPONENT_LABELS[id],
      value: credited[id],
      level: levelOf(credited[id]),
    })),
    done: DONE,
    next: NEXT,
  }
}
