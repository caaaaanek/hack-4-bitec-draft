/** Невеликий стор рішень з localStorage (усе в try/catch). «Скинути демо-дані» очищає його. */
import { useSyncExternalStore } from 'react'
import { EMPTY_DECISIONS, type DecisionsState } from '@/lib/decisions'

const KEY = 'demo.decisions'
const listeners = new Set<() => void>()

function load(): DecisionsState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_DECISIONS
    const v = JSON.parse(raw) as Partial<DecisionsState>
    return {
      recommendations: v.recommendations ?? {},
      measureStatus: v.measureStatus ?? {},
      added: Array.isArray(v.added) ? v.added : [],
    }
  } catch {
    return EMPTY_DECISIONS
  }
}

let state: DecisionsState = load()

export const getDecisions = (): DecisionsState => state

export function setDecisions(next: DecisionsState): void {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* без збереження: рішення діють до перезавантаження */
  }
  listeners.forEach((l) => l())
}

export function resetDecisions(): void {
  state = EMPTY_DECISIONS
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ігноруємо */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useDecisions = (): DecisionsState => useSyncExternalStore(subscribe, getDecisions)
