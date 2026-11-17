import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react'
import { Button, Card, FormField, Input, Logo, ThemeToggle } from '@/components/ui'
import { ApiError } from '@/api/client'
import { frontRole, useSession } from '@/api/session'
import { canAccess, defaultRoute } from '@/lib/access'

/** Демо-облікові записи з seed бекенду (пароль у всіх — DEMO_PASSWORD з .env). */
const DEMO_LOGINS: [string, string][] = [
  ['leader', 'Керівник: дашборд, рекомендації, заходи'],
  ['admin', 'Адміністратор: хвилі, посилання, журнал'],
  ['commissioner', 'Укладач анкет: анкети, підтвердження чек-листа'],
  ['auditor', 'Аудитор: лише перегляд і журнал'],
  ['wg1', 'Робоча група: анкета 1 і чек-лист'],
  ['staff01', 'Особовий склад: анкета 2 і мої результати'],
  ['expert1', 'Експерт: анкета 3'],
]

export function Login() {
  const { login, loginViaProxy, config } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const go = (role: ReturnType<typeof frontRole>) =>
    navigate(from && from !== '/login' && canAccess(role, from) ? from : defaultRoute(role), {
      replace: true,
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !password) {
      setError('Введіть логін і пароль.')
      return
    }
    setBusy(true)
    setError('')
    try {
      go(frontRole(await login(name.trim(), password)))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}. ${err.hint}`
          : 'Сервер недоступний. Перевірте, що бекенд запущено.',
      )
    } finally {
      setBusy(false)
    }
  }

  const proxy = async () => {
    setBusy(true)
    setError('')
    try {
      go(frontRole(await loginViaProxy()))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}. ${err.hint}`
          : 'Не вдалося увійти через систему організації.',
      )
    } finally {
      setBusy(false)
    }
  }

  const passwordOn = config?.auth.password ?? true
  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-ready="true">
      <header className="flex items-center justify-between px-4 py-3 md:px-7">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-section leading-none tracking-tight text-text">
            <span className="font-bold">Integrity</span>{' '}
            <span className="font-medium text-text-muted">Index</span>
          </span>
        </div>
        <ThemeToggle />
      </header>
      <main
        id="main"
        className="mx-auto grid w-full max-w-5xl flex-1 gap-5 px-4 py-6 md:grid-cols-2 md:py-12"
      >
        <Card as="section" aria-labelledby="login-h" className="flex flex-col gap-4 p-6">
          <h1 id="login-h" className="m-0 flex items-center gap-2 text-title">
            <KeyRound aria-hidden className="size-6 text-accent" />
            Вхід
          </h1>
          {passwordOn && (
            <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
              <FormField label="Логін" required>
                {({ id }) => (
                  <Input
                    id={id}
                    autoComplete="username"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                )}
              </FormField>
              <FormField label="Пароль" required error={error}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </FormField>
              <Button
                type="submit"
                size="lg"
                loading={busy}
                leftIcon={<LogIn aria-hidden className="size-4" />}
              >
                Увійти
              </Button>
            </form>
          )}
          {config?.auth.proxy && (
            <Button variant="secondary" onClick={() => void proxy()} loading={busy}>
              Увійти через систему організації
            </Button>
          )}
          {!passwordOn && error && <p className="m-0 text-body text-critical-text">{error}</p>}
          <p className="m-0 flex items-start gap-2 text-caption text-text-muted">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            Анонімні анкети за одноразовим посиланням відкриваються без входу.
          </p>
        </Card>

        {passwordOn && (
          <Card as="section" aria-labelledby="demo-h" className="flex flex-col gap-3 p-6">
            <h2 id="demo-h" className="m-0 text-card">
              Демо-облікові записи
            </h2>
            <p className="m-0 text-caption text-text-muted">
              Пароль у всіх однаковий: значення DEMO_PASSWORD з файлу .env. Дані синтетичні.
            </p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {DEMO_LOGINS.map(([l, what]) => (
                <li key={l}>
                  <button
                    type="button"
                    onClick={() => setName(l)}
                    className="flex w-full items-baseline gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <code className="text-body font-semibold text-accent">{l}</code>
                    <span className="text-caption text-text-muted">{what}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </main>
    </div>
  )
}
