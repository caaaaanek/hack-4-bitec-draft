import { useAppData } from '@/api/AppData'
import { useDemoOptional } from './demoContext'
import { institutionById, type Institution } from './institutions'

/** Заклад, дані якого зараз показано: з бекенду, якщо застосунок підключено, інакше демо (Альфа або обраний спостерігачем). */
export function useInstitution(): Institution {
  const data = useAppData()
  const demoId = useDemoOptional().institutionId
  return data?.institution ?? institutionById(demoId)
}
