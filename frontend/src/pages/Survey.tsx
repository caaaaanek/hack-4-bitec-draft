import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, EyeOff, LinkIcon, ShieldCheck, UserRoundX, UsersRound } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, IconCircle } from '@/components/ui'
import { cn } from '@/lib/cn'
import { K_MIN_GROUP } from '@/lib/scoring/methodology'
import { defaultRoute } from '@/lib/access'
import { useDemo } from '@/demo/demoContext'
import { DEMO_SURVEY, checkToken, type Survey as SurveyModel } from '@/demo/survey'
import {
  answeredCount,
  clearDraft,
  loadDraft,
  missingQuestions,
  questionCount,
  saveDraft,
  type Answers,
  type MissingQuestion,
} from '@/lib/survey'

type Phase = 'guarantees' | 'steps' | 'thanks'

const GUARANTEES = [
  {
    icon: UserRoundX,
    title: 'Анонімно',
    text: 'Ваші відповіді не повʼязані з вами і не містять імен.',
  },
  {
    icon: EyeOff,
    title: 'Без доступу до відповідей',
    text: 'Адміністратор бачить лише кількість відповідей, а не те, що ви відповіли.',
  },
  {
    icon: UsersRound,
    title: `Групи від ${K_MIN_GROUP} осіб`,
    text: `Результати показують лише для груп не менше ${K_MIN_GROUP} осіб.`,
  },
]

function Frame({
  children,
  progress,
  onClose,
  footer,
}: {
  children: ReactNode
  /** Номер розділу й кількість: показує смугу прогресу в липкій верхній смузі. */
  progress?: { step: number; total: number }
  /** Якщо задано, «Закрити» це кнопка (із підтвердженням), інакше посилання. */
  onClose?: () => void
  /** Липка нижня панель (кнопки «Назад» і «Далі»). */
  footer?: ReactNode
}) {
  const { role } = useDemo()
  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-ready="true">
      <header className="sticky top-0 z-20 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-caption font-semibold text-text">
              <ShieldCheck aria-hidden className="size-5 text-accent" />
              Анонімне опитування
            </p>
            {progress && (
              <p className="m-0 text-caption text-text-muted">
                Розділ {progress.step + 1} з {progress.total}
              </p>
            )}
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="touch-target inline-flex items-center rounded-md px-2 text-caption text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Закрити
            </button>
          ) : (
            <Link
              to={defaultRoute(role)}
              className="touch-target inline-flex items-center text-caption text-accent underline underline-offset-4"
            >
              Закрити
            </Link>
          )}
        </div>
        {progress && (
          <div
            role="progressbar"
            aria-label="Прогрес анкети"
            aria-valuemin={1}
            aria-valuemax={progress.total}
            aria-valuenow={progress.step + 1}
            aria-valuetext={`Розділ ${progress.step + 1} з ${progress.total}`}
            className="h-1.5 bg-surface-muted"
          >
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${((progress.step + 1) / progress.total) * 100}%` }}
            />
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {children}
      </main>
      {footer}
    </div>
  )
}

function TokenState({ state }: { state: 'used' | 'invalid' }) {
  const { role } = useDemo()
  return (
    <Frame>
      <h1 className="sr-only">Опитування</h1>
      {state === 'used' ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="Цю анкету вже заповнено"
          description="Повторно відповісти за цим посиланням не можна: так ми захищаємо анонімність і не допускаємо подвоєних відповідей. Дякуємо за участь."
          action={
            <Link to={defaultRoute(role)} className="text-accent underline underline-offset-4">
              Закрити
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={<LinkIcon className="size-8" />}
          title="Посилання недійсне або застаріле"
          description="Перевірте, чи адресу скопійовано повністю. Якщо не допомогло, попросіть нове посилання в тієї особи, яка надіслала вам анкету."
          action={
            <Link to={defaultRoute(role)} className="text-accent underline underline-offset-4">
              Закрити
            </Link>
          }
        />
      )}
    </Frame>
  )
}

export function Survey() {
  const { token } = useParams()
  const state = checkToken(token)
  if (state !== 'valid') return <TokenState state={state} />
  return <SurveyFlow survey={DEMO_SURVEY} token={token!} />
}

export function SurveyFlow({ survey, token }: { survey: SurveyModel; token: string }) {
  const { role, setRole } = useDemo()
  const navigate = useNavigate()
  const [confirmClose, setConfirmClose] = useState(false)
  const [phase, setPhase] = useState<Phase>('guarantees')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>(() => loadDraft(survey, token))
  const [missing, setMissing] = useState<MissingQuestion[] | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const moved = useRef(false)

  const total = survey.sections.length
  const section = survey.sections[step]!
  const done = answeredCount(survey, answers)
  const all = questionCount(survey)
  const sectionDone = section.questions.filter((x) => answers[x.id]).length

  useEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }
    if (pendingFocus.current) {
      const el = document.getElementById(pendingFocus.current)
      pendingFocus.current = null
      el?.focus()
      el?.scrollIntoView?.({ block: 'center' })
    } else headingRef.current?.focus()
  }, [step, phase])

  const choose = (qid: string, oid: string) => {
    const next = { ...answers, [qid]: oid }
    setAnswers(next)
    saveDraft(token, next)
    if (missing) setMissing(missingQuestions(survey, next))
    // Плавна прокрутка до наступного питання розділу без відповіді (без анімації при reduced-motion).
    const qs = section.questions
    const from = qs.findIndex((x) => x.id === qid)
    const nextQ = qs.slice(from + 1).find((x) => !next[x.id])
    if (nextQ) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      document
        .getElementById(nextQ.id)
        ?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    }
  }

  const submit = () => {
    const m = missingQuestions(survey, answers)
    if (m.length > 0) {
      setMissing(m)
      return
    }
    clearDraft(token)
    setMissing(null)
    setPhase('thanks')
  }

  if (phase === 'guarantees') {
    return (
      <Frame>
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="m-0 flex items-center gap-2 text-caption text-text-muted">
            <IconCircle tone="accent" size={24}>
              <ShieldCheck className="size-3.5" />
            </IconCircle>
            Анонімне опитування · {survey.category}
          </p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-title outline-none">
            Перш ніж почати
          </h1>
          <p className="mt-1 text-body-lg text-text-muted">
            {survey.category}. Анкета займе кілька хвилин. Ось що ми гарантуємо.
          </p>
          <ul className="m-0 mt-5 grid list-none gap-3 p-0 md:grid-cols-3">
            {GUARANTEES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-1.5 rounded-[14px] bg-surface-muted p-4">
                <Icon aria-hidden className="size-5 text-accent" />
                <span className="text-body font-semibold">{title}</span>
                <span className="text-caption text-text-muted">{text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-caption text-text-muted">{all} питань</p>
            <Button size="lg" onClick={() => setPhase('steps')} className="w-full md:w-auto">
              Розумію, почати
            </Button>
          </div>
          {done > 0 && (
            <p className="mt-3 text-caption text-text-muted">
              Збережені раніше відповіді на цьому пристрої буде підставлено ({done} з {all}).
            </p>
          )}
        </div>
      </Frame>
    )
  }

  if (phase === 'thanks') {
    return (
      <Frame>
        <div role="status" className="rounded-lg border border-border bg-surface p-5">
          <CheckCircle2 aria-hidden className="size-8 text-strength-solid" />
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-title outline-none">
            Дякуємо. Ваші відповіді збережено анонімно.
          </h1>
          <p className="mt-3 text-body-lg text-text-muted">
            Що далі: коли відповість достатньо людей (не менше {K_MIN_GROUP}), ви зможете побачити
            узагальнені результати свого підрозділу. Окремих відповідей і імен там не буде.
          </p>
        </div>
        <Button size="lg" className="mt-5 w-full" onClick={() => setRole('respondent')}>
          Переглянути результати підрозділу
        </Button>
      </Frame>
    )
  }

  const last = step === total - 1
  const n = section.questions.length
  const word = n % 10 >= 5 || n % 10 === 0 || (n >= 11 && n <= 14) ? 'питань' : 'питання'
  const closeNow = () => navigate(defaultRoute(role))
  const footer = (
    <div className="sticky bottom-0 z-20 border-t border-border bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto flex max-w-3xl gap-3 px-4">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => (step === 0 ? setPhase('guarantees') : setStep(step - 1))}
        >
          Назад
        </Button>
        {last ? (
          <Button size="lg" className="flex-1" onClick={submit}>
            Надіслати
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => setStep(step + 1)}>
            Далі
          </Button>
        )}
      </div>
    </div>
  )
  return (
    <Frame
      progress={{ step, total }}
      footer={footer}
      onClose={() => (done > 0 ? setConfirmClose(true) : closeNow())}
    >
      <ConfirmDialog
        open={confirmClose}
        title="Закрити опитування?"
        description="Дані вже введених відповідей лишаються на цьому пристрої, ви зможете продовжити пізніше. Відповіді ще не надіслано."
        confirmLabel="Закрити"
        cancelLabel="Продовжити заповнення"
        onConfirm={closeNow}
        onCancel={() => setConfirmClose(false)}
      />
      <h1 ref={headingRef} tabIndex={-1} className="m-0 text-title outline-none">
        {section.title}
      </h1>
      <p className="mt-1 text-body-lg text-text-muted">
        {section.title}: {n} {word} {section.about}
      </p>
      <p aria-live="polite" className="mt-1 text-caption font-semibold text-text">
        Відповіли на {sectionDone} з {n}
      </p>
      <p className="mt-0.5 text-caption text-text-muted">
        Відповіді зберігаються на цьому пристрої, поки ви заповнюєте.
      </p>

      <div className="mt-4 flex flex-col gap-6">
        {section.questions.map((qq, qi) => (
          <fieldset
            key={qq.id}
            id={qq.id}
            tabIndex={-1}
            className="m-0 min-w-0 border-0 p-0 outline-none"
          >
            <legend className="mb-2 text-card text-text">
              {qi + 1}. {qq.text}
            </legend>
            <div className="flex flex-col gap-2">
              {qq.options.map((o) => {
                const selected = answers[qq.id] === o.id
                return (
                  <label
                    key={o.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-body-lg',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                      selected
                        ? 'border-accent bg-accent-soft font-medium'
                        : 'border-border-strong bg-surface hover:bg-surface-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name={qq.id}
                      value={o.id}
                      checked={selected}
                      onChange={() => choose(qq.id, o.id)}
                      className="mt-1 size-5 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">{o.text}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div aria-live="polite" className="mt-6">
        {missing && missing.length > 0 && (
          <div className="rounded-lg border border-attention-solid bg-attention-bg p-4 text-attention-text">
            <p className="m-0 text-card">
              Залишилось відповісти на {missing.length}. Натисніть на питання, щоб перейти до нього.
            </p>
            <ul className="mt-2 mb-0 list-disc pl-5 text-body-lg">
              {missing.map((m) => (
                <li key={m.questionId}>
                  <a
                    href={`#${m.questionId}`}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                    onClick={(e) => {
                      e.preventDefault()
                      pendingFocus.current = m.questionId
                      if (m.sectionIndex !== step) setStep(m.sectionIndex)
                      else {
                        const el = document.getElementById(m.questionId)
                        pendingFocus.current = null
                        el?.focus()
                        el?.scrollIntoView?.({ block: 'center' })
                      }
                    }}
                  >
                    {m.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Frame>
  )
}
