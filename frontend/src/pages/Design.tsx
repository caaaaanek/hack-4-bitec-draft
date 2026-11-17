import { PageTitle } from '@/components/layout/PageTitle'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Layers, Plus, Scale, Trash2, Users } from 'lucide-react'
import {
  Badge,
  BigNumber,
  Button,
  Card,
  IconCircle,
  SegmentedBar,
  SegmentedControl,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  ForbiddenState,
  FlagNote,
  FormField,
  LoadingState,
  HiddenGroupState,
  IconButton,
  Input,
  KpiTile,
  MATURITY,
  MaturityBadge,
  Radio,
  Select,
  Skeleton,
  SkeletonText,
  SourceLabel,
  STATUSES,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  TrustBadge,
  useToast,
  type BadgeTone,
  type MaturityLevel,
  type SourceId,
  type StatusId,
} from '@/components/ui'
import { contrastRatio, normalizeHex } from '@/lib/contrast'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-section">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-caption text-text-muted">{label}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Зразок кольору з реальним контрастом, прочитаним з CSS-змінних. */
function Swatch({
  name,
  fg,
  bg,
  min = 4.5,
}: {
  name: string
  fg: string
  bg: string
  min?: number
}) {
  const [ratio] = useState<number | null>(() => {
    const cs = getComputedStyle(document.documentElement)
    const f = normalizeHex(cs.getPropertyValue(`--color-${fg}`))
    const b = normalizeHex(cs.getPropertyValue(`--color-${bg}`))
    return f && b ? contrastRatio(f, b) : null
  })
  const ok = ratio !== null && ratio >= min
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div
        className="px-3 py-3 text-body"
        style={{ background: `var(--color-${bg})`, color: `var(--color-${fg})` }}
      >
        Аа {name}
      </div>
      <div className="bg-surface text-caption tabular px-3 py-1.5">
        {ratio === null ? '...' : `${ratio.toFixed(2)}:1`} (мін. {min}:1){' '}
        <span className={ok ? 'text-strength-text' : 'text-critical-text'}>
          {ok ? 'так' : 'ні'}
        </span>
      </div>
    </div>
  )
}

const BASE: Array<[string, string, string]> = [
  ['text на bg', 'text', 'bg'],
  ['text на surface', 'text', 'surface'],
  ['text-muted на surface', 'text-muted', 'surface'],
  ['text-muted на surface-muted', 'text-muted', 'surface-muted'],
  ['on-accent на accent', 'on-accent', 'accent'],
  ['accent на accent-soft', 'accent', 'accent-soft'],
]
const SEMANTIC = [
  ['strength', 'Сильна сторона'],
  ['attention', 'Потребує уваги'],
  ['critical', 'Критична зона'],
  ['neutral', 'Нейтрально'],
] as const
const TONE_OF: Record<string, BadgeTone> = {
  strength: 'strength',
  attention: 'attention',
  critical: 'critical',
  neutral: 'neutral',
}
const LEVELS: MaturityLevel[] = [1, 2, 3, 4, 5]
const SOURCES: SourceId[] = ['wg', 'os', 'experts', 'facts']

const TYPE_SCALE: Array<[string, string, string]> = [
  ['text-display 52/52', 'text-display tabular', '3,8'],
  ['text-numeral 30/33', 'text-numeral tabular', '63,2'],
  ['text-title 22/28', 'text-title', 'Заголовок екрана'],
  ['text-section 18/26', 'text-section', 'Заголовок секції'],
  ['text-card 16/24', 'text-card', 'Заголовок картки'],
  ['text-body-lg 16/24', 'text-body-lg', 'Основний текст для довгих описів і пояснень.'],
  ['text-body 14/20', 'text-body', 'Текст за замовчуванням у таблицях і формах.'],
  ['text-caption 13/18', 'text-caption text-text-muted', 'Підпис до значення'],
  ['text-fine 12/16 medium', 'text-fine', 'Дрібний службовий текст'],
]
const SPACING = [4, 8, 12, 16, 24, 32, 48, 64]

interface Demo {
  id: string
  name: string
  level: number
  trust: string
}
const DEMO_ROWS: Demo[] = [
  { id: 'a', name: 'Прозорість рішень', level: 4, trust: 'A' },
  { id: 'b', name: 'Конфлікт інтересів', level: 2, trust: 'B' },
  { id: 'c', name: 'Академічна культура', level: 3, trust: 'A' },
  { id: 'd', name: 'Обізнаність щодо правил', level: 5, trust: 'C' },
]

export function Design() {
  const toast = useToast()
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [confirmDanger, setConfirmDanger] = useState(false)

  return (
    <div data-ready="true" className="space-y-12">
      <header className="space-y-2">
        <p className="text-caption">
          <Link className="text-accent underline underline-offset-4" to="/">
            На головну
          </Link>
        </p>
        <PageTitle>Дизайн-система</PageTitle>
        <p className="text-body-lg text-text-muted max-w-(--prose-max)">
          Токени й базові компоненти. Наведення, фокус і натискання перевіряйте взаємодією з
          елементами нижче: фокус видно на кожному з них.
        </p>
      </header>

      <Section id="colors" title="Кольори">
        <Row label="База й текст (контраст з токенів)">
          <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {BASE.map(([n, f, b]) => (
              <Swatch key={n} name={n} fg={f} bg={b} />
            ))}
          </div>
        </Row>
        <Row label="Шкала зрілості: цифра, назва, колір, візерунок (для друку)">
          <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {LEVELS.map((l) => (
              <div key={l} className="space-y-2">
                <MaturityBadge level={l} />
                <Swatch name={`текст ${l}`} fg={`maturity-${l}-text`} bg={`maturity-${l}-bg`} />
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-6 w-12 rounded-sm"
                    style={{ background: `var(--color-maturity-${l}-chart)` }}
                  />
                  <span
                    aria-hidden
                    className="border-border-strong inline-block h-6 w-12 rounded-sm border bg-white"
                    style={{ backgroundImage: `var(--pattern-maturity-${l})` }}
                  />
                  <span className="text-caption">{MATURITY[l].name}</span>
                </div>
                <Swatch name="графік на surface" fg={`maturity-${l}-chart`} bg="surface" min={3} />
              </div>
            ))}
          </div>
        </Row>
        <Row label="Семантика">
          {SEMANTIC.map(([id, label]) => (
            <Badge key={id} tone={TONE_OF[id]}>
              {label}
            </Badge>
          ))}
        </Row>
        <Row label="Джерела даних: колір і форма маркера">
          {SOURCES.map((s) => (
            <SourceLabel key={s} source={s} />
          ))}
        </Row>
      </Section>

      <Section id="typography" title="Типографіка">
        <Card className="space-y-4">
          {TYPE_SCALE.map(([label, cls, sample]) => (
            <div
              key={label}
              className="border-border flex flex-col gap-1 border-b pb-3 last:border-0 md:flex-row md:items-baseline md:gap-6"
            >
              <span className="text-caption text-text-muted shrink-0 md:w-52">{label}</span>
              <span className={cls}>{sample}</span>
            </div>
          ))}
          <p className="text-caption text-text-muted tabular">
            Числа вирівняно: 1 111, 8 888, 12,50
          </p>
        </Card>
      </Section>

      <Section id="spacing" title="Відступи, радіуси, тіні">
        <Row label="Сітка 4/8 (px)">
          {SPACING.map((s) => (
            <div key={s} className="text-caption tabular flex flex-col items-start gap-1">
              <span className="bg-accent block h-3" style={{ width: s }} />
              {s}
            </div>
          ))}
        </Row>
        <Row label="Радіуси 8 / 12 / 16">
          {['rounded-sm', 'rounded-md', 'rounded-lg'].map((r) => (
            <div
              key={r}
              className={`bg-surface border-border-strong text-caption border px-4 py-3 ${r}`}
            >
              {r}
            </div>
          ))}
        </Row>
        <Row label="Тіні">
          {['shadow-sm', 'shadow-md', 'shadow-lg'].map((s) => (
            <div key={s} className={`bg-surface text-caption rounded-md px-4 py-3 ${s}`}>
              {s}
            </div>
          ))}
        </Row>
      </Section>

      <Section id="buttons" title="Кнопки">
        <Row label="Варіанти">
          <Button>Зберегти</Button>
          <Button variant="secondary">Скасувати</Button>
          <Button variant="ghost">Докладніше</Button>
          <Button variant="danger" leftIcon={<Trash2 className="size-4" aria-hidden />}>
            Видалити
          </Button>
        </Row>
        <Row label="Розміри">
          <Button size="sm">Малий</Button>
          <Button size="md">Середній</Button>
          <Button size="lg">Великий</Button>
        </Row>
        <Row label="Стани: завантаження, недоступна">
          <Button loading>Зберігаємо</Button>
          <Button disabled>Недоступна</Button>
          <Button variant="secondary" disabled>
            Недоступна
          </Button>
        </Row>
        <Row label="Кнопка-іконка">
          <IconButton label="Додати" icon={<Plus className="size-5" />} />
          <IconButton label="Видалити" variant="secondary" icon={<Trash2 className="size-5" />} />
          <IconButton label="Недоступно" disabled icon={<Plus className="size-5" />} />
        </Row>
      </Section>

      <Section id="forms" title="Поля форм">
        <div className="grid gap-6 md:grid-cols-2">
          <FormField label="Назва групи" hint="Коротка назва, яку побачать учасники.">
            {(p) => (
              <Input id={p.id} aria-describedby={p.describedBy} placeholder="Наприклад, кафедра" />
            )}
          </FormField>
          <FormField
            label="Електронна пошта"
            error="Вкажіть адресу у форматі name@example.org."
            required
          >
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                defaultValue="name"
              />
            )}
          </FormField>
          <FormField label="Поле недоступне">
            {(p) => <Input id={p.id} disabled defaultValue="Лише для читання" />}
          </FormField>
          <FormField label="Роль" hint="Оберіть одну.">
            {(p) => (
              <Select id={p.id} aria-describedby={p.describedBy} defaultValue="">
                <option value="" disabled>
                  Оберіть значення
                </option>
                <option>Робоча група (РГ)</option>
                <option>Особовий склад</option>
                <option>Експерт</option>
              </Select>
            )}
          </FormField>
          <div className="md:col-span-2">
            <FormField
              label="Причина відхилення"
              hint="Обов'язкове поле. Не вказуйте персональних даних."
            >
              {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} />}
            </FormField>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-caption text-text-muted mb-1">Прапорці</legend>
            <Checkbox label="Згода на обробку відповідей" defaultChecked />
            <Checkbox label="Отримувати нагадування" hint="Не частіше ніж раз на тиждень." />
            <Checkbox label="Недоступний пункт" disabled />
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-caption text-text-muted mb-1">Перемикачі</legend>
            <Radio name="period" label="Цей рік" defaultChecked />
            <Radio name="period" label="Попередній рік" />
            <Radio name="period" label="Недоступний пункт" disabled />
          </fieldset>
        </div>
      </Section>

      <Section id="badges" title="Мітки">
        <Row label="Статуси (іконка і текст)">
          {(Object.keys(STATUSES) as StatusId[]).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </Row>
        <Row label="Рівні зрілості">
          {LEVELS.map((l) => (
            <MaturityBadge key={l} level={l} />
          ))}
        </Row>
        <Row label="Достовірність">
          <TrustBadge grade="A" />
          <TrustBadge grade="B" />
          <TrustBadge grade="C" />
          <TrustBadge grade="insufficient" />
        </Row>
      </Section>

      <Section id="data" title="Таблиця, вкладки, картки">
        <Table
          caption="Приклад таблиці з сортуванням (змініть ширину вікна: до 768 px рядки стають картками)"
          captionVisible
          rowKey={(r: Demo) => r.id}
          defaultSort={{ key: 'level', dir: 'desc' }}
          rows={DEMO_ROWS}
          columns={[
            { key: 'name', header: 'Показник', sortable: true },
            {
              key: 'level',
              header: 'Рівень',
              sortable: true,
              numeric: true,
              render: (r: Demo) => <MaturityBadge level={r.level as MaturityLevel} />,
            },
            { key: 'trust', header: 'Достовірність', sortable: true },
          ]}
        />
        <Tabs
          aria-label="Приклад вкладок"
          items={[
            {
              id: 't1',
              label: 'Огляд',
              content: (
                <Card>
                  <CardTitle>Огляд</CardTitle>
                  <p className="mt-2">Зміст першої вкладки.</p>
                </Card>
              ),
            },
            {
              id: 't2',
              label: 'Розклад',
              content: (
                <Card>
                  <CardTitle>Розклад</CardTitle>
                  <p className="mt-2">Зміст другої вкладки.</p>
                </Card>
              ),
            },
            {
              id: 't3',
              label: 'Історія',
              content: (
                <Card>
                  <CardTitle>Історія</CardTitle>
                  <p className="mt-2">Зміст третьої вкладки.</p>
                </Card>
              ),
            },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle>Звичайна картка</CardTitle>
            <p className="text-text-muted mt-2">Статичний блок із даними.</p>
          </Card>
          <Card interactive tabIndex={0}>
            <CardTitle>Інтерактивна картка</CardTitle>
            <p className="text-text-muted mt-2">
              Поверхня піднімається при наведенні, фокус видно.
            </p>
          </Card>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <KpiTile label="Індекс доброчесності" value="62" unit="з 100" delta={4.5} />
          <KpiTile label="Культура" value="58" delta={-2} />
          <KpiTile label="Система" value="64" delta={0} />
          <KpiTile label="Підзвітність" value="66" delta={3} />
        </div>
      </Section>

      <Section id="new-components" title="Число, іконка в колі, сегментована смуга, перемикач">
        <Row label="Велике число (дробова частина приглушена)">
          <BigNumber value="54,2" size="display" />
          <BigNumber value="63,2" />
        </Row>
        <Row label="Іконка в тонованому колі за категорією">
          <span className="inline-flex items-center gap-2">
            <IconCircle tone="culture">
              <Users className="size-4" />
            </IconCircle>
            Культура
          </span>
          <span className="inline-flex items-center gap-2">
            <IconCircle tone="system">
              <Layers className="size-4" />
            </IconCircle>
            Система
          </span>
          <span className="inline-flex items-center gap-2">
            <IconCircle tone="accountability">
              <Scale className="size-4" />
            </IconCircle>
            Підзвітність
          </span>
        </Row>
        <Row label="Сегментована смуга">
          <div className="w-full max-w-md space-y-2">
            <SegmentedBar value={58} label="Культура: 58 зі 100" />
            <SegmentedBar value={35} label="Підзвітність: 35 зі 100" />
          </div>
        </Row>
        <Row label="Сегмент-перемикач">
          <SegmentedControl
            label="Приклад перемикача"
            value="all"
            onChange={() => {}}
            options={[
              { value: 'all', label: 'Усі' },
              { value: 'work', label: 'В роботі' },
              { value: 'done', label: 'Виконані' },
            ]}
          />
        </Row>
      </Section>

      <Section id="overlays" title="Діалоги, сповіщення, підказки">
        <Row label="Дії">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Відкрити діалог
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Підтвердження
          </Button>
          <Button variant="secondary" onClick={() => setConfirmDanger(true)}>
            Незворотна дія
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.push({ title: 'Зміни збережено', tone: 'success' })}
          >
            Показати сповіщення
          </Button>
          <Tooltip content="Підказка доступна з клавіатури та по дотику. Суттєва інформація завжди є і в тексті поруч.">
            <button
              type="button"
              className="border-border-strong touch-h rounded-md border px-3 text-body"
            >
              Підказка
            </button>
          </Tooltip>
        </Row>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Приклад діалогу"
          description="Фокус залишається всередині, Esc закриває."
          footer={<Button onClick={() => setDialog(false)}>Закрити</Button>}
        >
          <p>Зміст діалогу.</p>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          title="Надіслати відповіді?"
          description="Після надсилання зміни буде неможливо."
          onConfirm={() => setConfirm(false)}
          onCancel={() => setConfirm(false)}
        />
        <ConfirmDialog
          open={confirmDanger}
          danger
          title="Видалити чернетку?"
          description="Чернетку буде видалено без можливості відновлення."
          confirmLabel="Видалити"
          onConfirm={() => setConfirmDanger(false)}
          onCancel={() => setConfirmDanger(false)}
        />
      </Section>

      <Section id="states" title="Стани сторінки">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <p className="text-caption text-text-muted mb-3">Завантаження</p>
            <LoadingState>
              <Skeleton className="mb-3 h-8 w-1/2" />
              <SkeletonText lines={3} />
            </LoadingState>
          </Card>
          <EmptyState
            icon={<Inbox className="size-8" aria-hidden />}
            title="Поки немає даних"
            description="Результати зʼявляться тут, щойно цикл оцінювання збере достатньо відповідей. Оновлення відбувається автоматично."
            action={<Button variant="secondary">Оновити</Button>}
          />
          <div data-demo>
            <ErrorState
              description="Сервер не відповів вчасно."
              whatToDo="Перевірте з'єднання і спробуйте ще раз. Якщо помилка повторюється, зверніться до адміністратора."
              onRetry={() => undefined}
            />
          </div>
          <HiddenGroupState />
          <ForbiddenState />
          <FlagNote title="Розбіжність між сприйняттям і фактами">
            Сприйняття ОС помітно вище за факти в компоненті «Підзвітність».
          </FlagNote>
        </div>
      </Section>
    </div>
  )
}
