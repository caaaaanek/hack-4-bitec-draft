/** Подає роль і підрозділ з облікового запису в той самий контекст, що й демо, щоб екрани не змінювались. */
import { useMemo, type ReactNode } from 'react'
import { DemoContext, type DemoState } from '@/demo/demoContext'
import { ALPHA_ID } from '@/demo/institutions'
import { ROOT_UNIT_ID } from '@/demo/units'
import { useSession } from './session'

const noop = () => undefined

export function SessionDemoBridge({ children }: { children: ReactNode }) {
  const { role, user, logout } = useSession()
  const value = useMemo<DemoState>(
    () => ({
      role,
      unitId: user?.unit_id ?? ROOT_UNIT_ID,
      scope: user?.unit_id ?? ROOT_UNIT_ID,
      setRole: noop,
      setUnitId: noop,
      resetDemo: () => void logout(),
      institutionId: ALPHA_ID,
      setInstitutionId: noop,
    }),
    [role, user, logout],
  )
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}
