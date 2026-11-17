/**
 * [ПРОПОЗИЦІЯ] Достовірність результату: літера A / B / C або «недостатньо даних».
 * Правило (рішення команди):
 *  - менше k відповідей у групі: «недостатньо даних» (індекс для групи не показується);
 *  - A: жоден прапорець не спрацював;
 *  - B: лише 1-2 незначних прапорці;
 *  - C: хоча б один серйозний або 3 і більше незначних.
 * Прапорець це так/ні з вагою та поясненням простою мовою.
 */
import { K_MIN_GROUP } from './methodology'

export type TrustGrade = 'A' | 'B' | 'C' | 'insufficient'

export type FlagWeight = 'minor' | 'major'

/** Скільки незначних прапорців дорівнює серйозному. */
export const MINOR_FLAGS_FOR_C = 3

export interface TrustFlag {
  id: string
  weight: FlagWeight
  /** Так (спрацював) або ні. */
  raised: boolean
  title: string
  /** Пояснення простою мовою. */
  explanation: string
}

export function trustGrade(
  flags: readonly Pick<TrustFlag, 'weight' | 'raised'>[],
  responses: number,
  k: number = K_MIN_GROUP,
): TrustGrade {
  if (responses < k) return 'insufficient'
  const raised = flags.filter((f) => f.raised)
  const major = raised.filter((f) => f.weight === 'major').length
  const minor = raised.length - major
  if (major >= 1 || minor >= MINOR_FLAGS_FOR_C) return 'C'
  if (minor >= 1) return 'B'
  return 'A'
}
