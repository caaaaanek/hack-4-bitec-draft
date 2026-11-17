import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { defaultRoute, defaultScope, type Role } from '@/lib/access'
import { DemoContext, type DemoState } from './demoContext'
import { ALPHA_ID } from './institutions'
import {
  DEFAULT_DEMO_ROLE,
  DEFAULT_DEMO_UNIT,
  clearDemoStorage,
  loadRole,
  loadUnit,
  saveRole,
  saveUnit,
} from './demoStorage'

/** Роль, підрозділ і scope демо. Зміна ролі веде на маршрут за замовчуванням і скидає scope. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [role, setRoleState] = useState<Role>(loadRole)
  const [unitId, setUnitState] = useState<string>(loadUnit)
  const [institutionId, setInstitutionState] = useState<string>(ALPHA_ID)
  const [scope, setScope] = useState<string>(() => defaultScope(loadRole(), loadUnit()))

  const setRole = useCallback(
    (next: Role) => {
      setRoleState(next)
      saveRole(next)
      setScope(defaultScope(next, unitId))
      setInstitutionState(ALPHA_ID)
      navigate(defaultRoute(next))
    },
    [navigate, unitId],
  )
  const setUnitId = useCallback(
    (next: string) => {
      setUnitState(next)
      saveUnit(next)
      if (role === 'respondent') setScope(next)
    },
    [role],
  )
  const resetDemo = useCallback(() => {
    clearDemoStorage()
    setRoleState(DEFAULT_DEMO_ROLE)
    setUnitState(DEFAULT_DEMO_UNIT)
    setScope(defaultScope(DEFAULT_DEMO_ROLE, DEFAULT_DEMO_UNIT))
    setInstitutionState(ALPHA_ID)
    navigate(defaultRoute(DEFAULT_DEMO_ROLE))
  }, [navigate])

  const value = useMemo<DemoState>(
    () => ({
      role,
      unitId,
      scope,
      setRole,
      setUnitId,
      resetDemo,
      institutionId,
      setInstitutionId: setInstitutionState,
    }),
    [role, unitId, scope, setRole, setUnitId, resetDemo, institutionId],
  )
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}
