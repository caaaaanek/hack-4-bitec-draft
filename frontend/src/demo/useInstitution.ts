import { useDemoOptional } from './demoContext'
import { institutionById, type Institution } from './institutions'

/** Заклад, дані якого зараз показано (за вибором спостерігача; для решти ролей Альфа). */
export function useInstitution(): Institution {
  return institutionById(useDemoOptional().institutionId)
}
