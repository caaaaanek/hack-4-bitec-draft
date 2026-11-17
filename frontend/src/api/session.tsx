/* eslint-disable react-refresh/only-export-components */
/** Сесія користувача: конфіг бекенду, поточний профіль, вхід і вихід. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Role } from '@/lib/access'
import {
  api,
  session as tokenStore,
  setUnauthorizedHandler,
  type Me,
  type PublicConfig,
} from './client'

export type SessionStatus = 'loading' | 'anonymous' | 'ready'

export interface SessionState {
  status: SessionStatus
  user: Me | null
  config: PublicConfig | null
  /** Роль інтерфейсу, виведена з ролі й категорії облікового запису. */
  role: Role
  login: (login: string, password: string) => Promise<Me>
  loginViaProxy: () => Promise<Me>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

/** Роль бекенду → роль інтерфейсу. Член робочої групи ще й вносить чек-лист. */
export function frontRole(user: Pick<Me, 'role' | 'category'> | null): Role {
  if (!user) return 'respondent'
  switch (user.role) {
    case 'admin':
      return 'admin'
    case 'commissioner':
      return 'commissioner'
    case 'leader':
      return 'leader'
    case 'auditor':
      return 'auditor'
    default:
      return user.category === 'working_group' ? 'checklist_editor' : 'respondent'
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [user, setUser] = useState<Me | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)

  const reset = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    setUnauthorizedHandler(reset)
    let alive = true
    void (async () => {
      const cfg = await api.config().catch(() => null)
      if (!alive) return
      setConfig(cfg)
      if (tokenStore.get()) {
        const me = await api.me().catch(() => null)
        if (!alive) return
        if (me) {
          setUser(me)
          setStatus('ready')
          return
        }
      }
      if (cfg?.auth.proxy && !cfg.auth.password) {
        const s = await api.loginViaProxy().catch(() => null)
        if (!alive) return
        if (s) {
          setUser(s.user)
          setStatus('ready')
          return
        }
      }
      setStatus('anonymous')
    })()
    return () => {
      alive = false
      setUnauthorizedHandler(null)
    }
  }, [reset])

  const login = useCallback(
    async (login: string, password: string) => {
      const s = await api.login(login, password)
      queryClient.clear()
      setUser(s.user)
      setStatus('ready')
      return s.user
    },
    [queryClient],
  )
  const loginViaProxy = useCallback(async () => {
    const s = await api.loginViaProxy()
    queryClient.clear()
    setUser(s.user)
    setStatus('ready')
    return s.user
  }, [queryClient])
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    reset()
  }, [reset])

  const value = useMemo<SessionState>(
    () => ({ status, user, config, role: frontRole(user), login, loginViaProxy, logout }),
    [status, user, config, login, loginViaProxy, logout],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession потребує SessionProvider')
  return v
}

/** Сесія або null поза провайдером (демо-режим і тести окремих екранів). */
export const useSessionOptional = (): SessionState | null => useContext(SessionContext)
