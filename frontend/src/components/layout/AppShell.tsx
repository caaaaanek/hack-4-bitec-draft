import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ForbiddenState, Logo, Select, SkipLink } from '@/components/ui'
import { useInstitution } from '@/demo/useInstitution'
import { useNavCounts } from '@/demo/navCounts'
import {
  ROLES,
  ROLE_LABELS,
  canAccess,
  defaultRoute,
  isKnownRoute,
  isRole,
  type Role,
} from '@/lib/access'
import { useDemo } from '@/demo/demoContext'
import { CommandPalette } from './CommandPalette'
import { HeaderActions } from './HeaderActions'
import { PAGE_TITLE_SLOT, PageTitle } from './PageTitle'
import { navFor } from './nav'

/** Назва продукту: «Integrity» жирним, «Index» приглушено. */
function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <Logo />
      <span className="text-section leading-none tracking-tight text-text">
        <span className="font-bold">Integrity</span>{' '}
        <span className="font-medium text-text-muted">Index</span>
      </span>
    </div>
  )
}

/** Картка «Роль» унизу бічної панелі: вибір ролі демо (зміна ролі веде на її головний екран). */
function RoleCard() {
  const { role, setRole } = useDemo()
  return (
    <div className="rounded-[14px] bg-surface-muted p-3">
      <label className="flex flex-col gap-2 text-fine text-text-muted">
        Роль
        <Select
          aria-label="Роль для демо"
          value={role}
          onChange={(e) => isRole(e.target.value) && setRole(e.target.value)}
          className="!h-9 !rounded-[10px] !py-0 !pl-2 !pr-6 !text-[11.5px] !text-text"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </label>
    </div>
  )
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const counts = useNavCounts()
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {navFor(role).map(({ to, label, icon: Icon, end }) => {
        const count = counts[to]
        return (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              aria-label={count ? `${label}. ${count.label}` : label}
              title={count ? `${label}. ${count.label}` : label}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 items-center gap-3 rounded-[12px] px-3 py-2.5 text-body font-medium no-underline',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  isActive
                    ? 'bg-surface-muted text-text'
                    : 'text-text-muted hover:bg-surface-muted hover:text-text',
                )
              }
            >
              <Icon aria-hidden className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1">{label}</span>
              {count && (
                <span
                  aria-hidden
                  className="rounded-full bg-attention-bg px-[7px] py-px text-[11px] font-semibold tabular-nums text-attention-text"
                >
                  {count.text}
                </span>
              )}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Пошук по сторінках"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-10 w-full items-center gap-2 rounded-[12px] bg-surface-muted px-3 text-body text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-left">Пошук</span>
      <kbd className="rounded-md bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold text-text-muted">
        ⌘K
      </kbd>
    </button>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const { pathname } = useLocation()
  const { role } = useDemo()
  const institution = useInstitution()
  const allowed = !isKnownRoute(pathname) || canAccess(role, pathname)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-screen xl:flex">
      <SkipLink />
      <nav
        aria-label="Основна навігація"
        data-print="hide"
        className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-border bg-surface px-4 pb-4 pt-[22px] xl:flex"
      >
        <Brand />
        <SearchButton onOpen={() => setPalette(true)} />
        <div className="flex flex-col gap-1.5">
          <p className="m-0 px-2.5 text-[11px] uppercase text-text-muted">Меню</p>
          <NavList role={role} />
        </div>
        <div className="mt-auto">
          <RoleCard />
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <header data-print="hide" className="sticky top-0 z-30 bg-bg/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 md:px-7 md:py-[18px]">
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex size-[38px] items-center justify-center rounded-[12px] border border-border bg-surface xl:hidden"
            >
              {open ? (
                <X aria-hidden className="size-5" />
              ) : (
                <Menu aria-hidden className="size-5" />
              )}
              <span className="sr-only">Меню</span>
            </button>
            <div id={PAGE_TITLE_SLOT} className="flex min-w-0 flex-1 items-center" />
            <HeaderActions />
          </div>
          {open && (
            <nav
              id="mobile-nav"
              aria-label="Основна навігація"
              className="flex flex-col gap-3 border-y border-border bg-surface px-4 py-3 xl:hidden"
            >
              <SearchButton
                onOpen={() => {
                  setOpen(false)
                  setPalette(true)
                }}
              />
              <NavList role={role} onNavigate={() => setOpen(false)} />
              <RoleCard />
            </nav>
          )}
        </header>

        <main id="main" tabIndex={-1} key={pathname} className="min-w-0 px-4 pb-7 pt-1 md:px-7">
          {allowed && role === 'observer' && pathname !== '/institutions' && (
            <nav aria-label="Хлібні крихти" className="mb-2 text-caption text-text-muted">
              <Link to="/institutions" className="text-accent underline underline-offset-2">
                Усі заклади
              </Link>
              <span aria-hidden> / </span>
              <span aria-current="page">{institution.name}</span>
            </nav>
          )}
          {allowed ? (
            <Outlet />
          ) : (
            <div data-ready="true" className="space-y-4">
              <PageTitle>Сторінка недоступна</PageTitle>
              <ForbiddenState homeHref={defaultRoute(role)} />
            </div>
          )}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} role={role} />
    </div>
  )
}
