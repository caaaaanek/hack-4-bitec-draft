import { PageTitle } from '@/components/layout/PageTitle'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoadingState, ToastProvider } from '@/components/ui'
import { canAccess, defaultRoute, setApiAccess } from '@/lib/access'
import { SessionProvider, useSession } from '@/api/session'
import { SessionDemoBridge } from '@/api/SessionDemoBridge'
import { AppDataProvider, ResultsGate } from '@/api/AppData'
import { Login } from '@/pages/Login'
import { ApiMe } from '@/pages/ApiMe'
import { AccountSurvey, TokenSurvey } from '@/pages/ApiSurvey'
import { Manage } from '@/pages/Manage'
import { Surveys } from '@/pages/Surveys'
import { Checklist } from '@/pages/Checklist'
import { Audit } from '@/pages/Audit'
import { AppShell } from '@/components/layout/AppShell'
import { Home } from '@/pages/Home'
import { Explain } from '@/pages/Explain'
import { Compare } from '@/pages/Compare'
import { Report } from '@/pages/Report'
import { Recommendations } from '@/pages/Recommendations'
import { Tracker } from '@/pages/Tracker'
import { Trends } from '@/pages/Trends'
import { Integrations } from '@/pages/Integrations'
import { Institutions } from '@/pages/Institutions'
import { Me } from '@/pages/Me'
import { Survey } from '@/pages/Survey'
import { Design } from '@/pages/Design'
import { Placeholder } from '@/pages/Placeholder'
import { DemoProvider } from '@/demo/DemoProvider'

/** VITE_DEMO=true — лише синтетичні дані в браузері, без бекенду (як на Vercel). Інакше — дані з API. */
export const DEMO_MODE = import.meta.env.VITE_DEMO === 'true'
if (!DEMO_MODE) setApiAccess(true)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

const notFound = (
  <div data-ready="true">
    <PageTitle>Сторінку не знайдено</PageTitle>
    <p className="mt-2 text-body-lg text-text-muted">
      Перевірте адресу або поверніться на{' '}
      <Link className="text-accent underline" to="/">
        головну
      </Link>
      .
    </p>
  </div>
)

function FullPageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg" aria-busy="true">
      <LoadingState>Підключаємося до сервера</LoadingState>
    </div>
  )
}

/** Без входу — на сторінку входу (з поверненням назад після входу). */
function RequireAuth() {
  const { status } = useSession()
  const location = useLocation()
  if (status !== 'ready')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function DataShell() {
  const { user } = useSession()
  return (
    <AppDataProvider backendRole={user?.role ?? 'respondent'}>
      <AppShell />
    </AppDataProvider>
  )
}

function HomeOrDefault() {
  const { role } = useSession()
  return canAccess(role, '/') ? (
    <ResultsGate>
      <Home />
    </ResultsGate>
  ) : (
    <Navigate to={defaultRoute(role)} replace />
  )
}

const gate = (el: React.ReactNode) => <ResultsGate>{el}</ResultsGate>

function ApiRoutes() {
  const { status, role } = useSession()
  if (status === 'loading') return <FullPageLoading />
  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'ready' ? <Navigate to={defaultRoute(role)} replace /> : <Login />}
      />
      <Route path="/s/:token" element={<TokenSurvey />} />
      <Route element={<RequireAuth />}>
        <Route path="/answer/:campaignId/:questionnaireId" element={<AccountSurvey />} />
        <Route element={<DataShell />}>
          <Route path="/" element={<HomeOrDefault />} />
          <Route path="/explain" element={gate(<Explain />)} />
          <Route path="/compare" element={gate(<Compare />)} />
          <Route path="/trends" element={gate(<Trends />)} />
          <Route path="/reports" element={gate(<Report />)} />
          <Route path="/recommendations" element={gate(<Recommendations />)} />
          <Route path="/tracker" element={gate(<Tracker />)} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/manage" element={<Manage />} />
          <Route path="/surveys" element={<Surveys />} />
          <Route path="/checklist" element={<Checklist />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/me" element={<ApiMe />} />
          <Route path="/design" element={<Design />} />
          <Route path="*" element={notFound} />
        </Route>
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          {DEMO_MODE ? (
            <DemoRoutes />
          ) : (
            <SessionProvider>
              <SessionDemoBridge>
                <ApiRoutes />
              </SessionDemoBridge>
            </SessionProvider>
          )}
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

/** Демо-режим: синтетичні дані в браузері, перемикач ролей. */
function DemoRoutes() {
  return (
    <DemoProvider>
      <Routes>
        <Route path="/s/:token" element={<Survey />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/explain" element={<Explain />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/recommendations" element={<Recommendations />} />
          <Route path="/reports" element={<Report />} />
          <Route
            path="/manage"
            element={
              <Placeholder
                title="Керування циклом"
                description="Тут уповноважений налаштує цикл оцінювання, мінімальну групу k, розсилку жетонів і побачить лише кількість виданих та використаних жетонів."
                note="Ця роль не має доступу до відповідей респондентів, навіть узагальнених. Результати бачать лише ті ролі, яким вони потрібні для рішень."
              />
            }
          />
          <Route
            path="/surveys"
            element={
              <Placeholder
                title="Анкети"
                description="Тут укладач створюватиме анкети, питання з варіантами відповідей і версії, а потім публікуватиме їх у цикл."
                note="Ця роль не має доступу до відповідей респондентів і не бачить, хто та скільки людей пройшли анкету."
              />
            }
          />
          <Route
            path="/checklist"
            element={
              <Placeholder
                title="Чек-лист"
                description="Тут зʼявляться пункти чек-листа: один працівник вносить дані, інший підтверджує їх. Кожен пункт матиме джерело й дату."
              />
            }
          />
          <Route
            path="/audit"
            element={
              <Placeholder
                title="Журнал"
                description="Тут буде журнал дій із перевіркою цілісності: хто, коли й що змінив у налаштуваннях та даних. Відповідей респондентів у журналі немає."
              />
            }
          />
          <Route path="/tracker" element={<Tracker />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/institutions" element={<Institutions />} />
          <Route path="/me" element={<Me />} />
          <Route path="/design" element={<Design />} />
          <Route path="*" element={notFound} />
        </Route>
      </Routes>
    </DemoProvider>
  )
}
