import { PageTitle } from '@/components/layout/PageTitle'
import { ArrowRight, Check, HeartHandshake } from 'lucide-react'
import {
  BigNumber,
  Card,
  HiddenGroupState,
  IconCircle,
  MaturityBadge,
  MATURITY,
  SegmentedBar,
} from '@/components/ui'
import { fmt, fmtIndex, K_MIN_GROUP } from '@/lib/scoring/methodology'
import { useDemo } from '@/demo/demoContext'
import { getMyResults, type MyComponent } from '@/demo/me'

const VALUE_HINT = 'Значення компонента від 0 до 100: чим більше, тим системніше працює напрям.'

function Tile({ c }: { c: MyComponent }) {
  return (
    <li className="flex flex-col gap-2 rounded-[14px] bg-surface-muted p-4">
      <span className="text-caption text-text-muted">{c.label}</span>
      <BigNumber value={fmt(c.value)} />
      <SegmentedBar
        meter
        tone={c.id}
        segments={24}
        className="h-1.5"
        value={c.value}
        label={`${c.label}: ${fmt(c.value)} з 100, рівень ${c.level} ${MATURITY[c.level].name}`}
      />
      <MaturityBadge level={c.level} className="self-start" />
    </li>
  )
}

/** Екран учасника: лише узагальнені результати підрозділу, коли група не менша за k. */
export function Me() {
  const { unitId } = useDemo()
  const r = getMyResults(unitId)
  const { resolved } = r
  const text = r.components
    .map((c) => `${c.label}: ${fmt(c.value)} з 100, рівень ${c.level} (${MATURITY[c.level].name})`)
    .join('; ')

  return (
    <div data-ready="true" className="space-y-5">
      <div>
        <PageTitle>Мої результати</PageTitle>
        <p className="mt-1 flex items-center gap-2 text-body-lg text-text-muted">
          <HeartHandshake aria-hidden className="size-5 shrink-0 text-accent" />
          Дякуємо, ось що ви допомогли побачити.
        </p>
      </div>

      {resolved.hidden ? (
        <section aria-labelledby="hidden-h" className="space-y-3">
          <h2 id="hidden-h" className="sr-only">
            {resolved.requested.name}: результати приховано
          </h2>
          <p className="m-0 text-card">{resolved.requested.name}</p>
          <HiddenGroupState parentName={resolved.unit.name} />
          <p className="m-0 text-body text-text-muted">
            Нижче дані підрозділу «{resolved.unit.name}». Це рівень вище, а не ваш підрозділ.
          </p>
        </section>
      ) : (
        <p className="m-0 text-body text-text-muted">
          {resolved.unit.name}: відповіли {resolved.responses} осіб (потрібно не менше {K_MIN_GROUP}
          ).
        </p>
      )}

      <Card as="section" aria-labelledby="level-h" className="flex flex-col gap-4">
        <h2 id="level-h" className="card-title">
          Рівень зрілості: {resolved.unit.name}
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
          <li className="flex flex-col gap-2 rounded-[14px] bg-primary-soft p-4">
            <span className="text-caption text-text-muted">Індекс</span>
            <BigNumber value={fmtIndex(r.index)} size="display" />
            <MaturityBadge level={r.level} className="self-start" />
          </li>
          {r.components.map((c) => (
            <Tile key={c.id} c={c} />
          ))}
        </ul>
        <p className="m-0 text-caption text-text-muted">
          Що це: індекс доброчесності від 0 до 100, середнє трьох компонентів. Шкала рівнів від 1 до
          5. {VALUE_HINT}
        </p>
        <p className="m-0 text-caption text-text-muted">Текстом: {text}.</p>
        <details>
          <summary className="touch-target inline-flex cursor-pointer items-center text-accent underline underline-offset-4">
            Показати як таблицю
          </summary>
          <table className="mt-2 w-full border-collapse text-body">
            <caption className="sr-only">Значення компонентів підрозділу</caption>
            <thead>
              <tr className="bg-surface-muted text-left">
                <th scope="col" className="p-2">
                  Компонент
                </th>
                <th scope="col" className="p-2">
                  Значення, з 100
                </th>
                <th scope="col" className="p-2">
                  Рівень
                </th>
              </tr>
            </thead>
            <tbody>
              {r.components.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <th scope="row" className="p-2 text-left font-normal">
                    {c.label}
                  </th>
                  <td className="tabular p-2">{fmt(c.value)}</td>
                  <td className="p-2">
                    {c.level} {MATURITY[c.level].name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card as="section" aria-labelledby="done-h">
          <h2 id="done-h" className="card-title">
            Що зроблено з минулого циклу
          </h2>
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-border p-0">
            {r.done.map((t) => (
              <li key={t} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <IconCircle tone="accent" size={28}>
                  <Check className="size-4" />
                </IconCircle>
                <span className="text-body">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card as="section" aria-labelledby="next-h">
          <h2 id="next-h" className="card-title">
            Що буде далі
          </h2>
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-border p-0">
            {r.next.map((t) => (
              <li key={t} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <IconCircle tone="accountability" size={28}>
                  <ArrowRight className="size-4" />
                </IconCircle>
                <span className="text-body">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="m-0 border-t border-border pt-3 text-caption text-text-muted">
        Тут лише узагальнені дані групи. Окремих відповідей, імен і порівнянь підрозділів немає.
      </p>
    </div>
  )
}
