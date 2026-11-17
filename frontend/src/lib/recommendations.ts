/**
 * Рекомендації: формуються з даних (слабкі показники, розбіжність сприйняття й фактів, прапорці).
 * Це пропозиція системи, рішення приймає керівник. Статус рішення зберігається окремо (src/demo/decisionsStore.ts).
 */
import type { ComponentId } from './scoring/methodology'
import type { TrustFlag } from './scoring/trust'
import { fmt } from './scoring/methodology'

export type RecommendationStatus = 'proposed' | 'accepted' | 'clarified' | 'rejected'
export type Priority = 'high' | 'medium' | 'low'

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'Високий',
  medium: 'Середній',
  low: 'Низький',
}

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  proposed: 'Запропоновано',
  accepted: 'Прийнято',
  clarified: 'Уточнено',
  rejected: 'Відхилено',
}

/** Допустимі переходи: прийняте й відхилене рішення остаточні в межах циклу. */
export const RECOMMENDATION_TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  proposed: ['accepted', 'clarified', 'rejected'],
  clarified: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
}

export const canRecommendationMove = (from: RecommendationStatus, to: RecommendationStatus) =>
  RECOMMENDATION_TRANSITIONS[from].includes(to)

/** Показник або прапорець, на підставі якого з'явилась рекомендація. */
export interface Evidence {
  id: string
  kind: 'item' | 'flag'
  label: string
  /** Значення простою мовою, наприклад «30 зі 100» або «Спрацював». */
  valueText: string
  /** Посилання на розклад із розкритим вузлом. */
  href: string
}

export interface Recommendation {
  id: string
  title: string
  priority: Priority
  component: ComponentId
  evidence: Evidence[]
  why: string
  actions: string[]
  status: RecommendationStatus
}

/** Мінімальний набір даних для формування (не залежить від конкретного закладу). */
export interface RecommendationInput {
  items: { id: string; component: ComponentId; label: string; value: number }[]
  flags: Pick<TrustFlag, 'id' | 'raised' | 'title'>[]
}

interface Template {
  id: string
  title: string
  component: ComponentId
  items: string[]
  flags: string[]
  why: string
  actions: string[]
}

/** Шаблони: рекомендація з'являється, коли пов'язаний показник нижчий за поріг або спрацював прапорець. */
export const TEMPLATES: Template[] = [
  {
    id: 'rec-procurement',
    title: 'Розібрати закупівлі, що потребують додаткової перевірки',
    component: 'accountability',
    items: ['ac-p1', 'ac-f1'],
    flags: ['tf-gap'],
    why: 'Працівники оцінюють прозорість рішень високо, а факти це не підтверджують. Розбір закупівель допоможе звірити сприйняття з документами.',
    actions: [
      'Скласти перелік закупівель за останній цикл, що потребують перевірки',
      'Звірити умови закупівель із чек-листом',
      'Оприлюднити короткий підсумок розбору',
    ],
  },
  {
    id: 'rec-conflicts',
    title: 'Скоротити строки перевірки конфліктів інтересів',
    component: 'accountability',
    items: ['ac-f2'],
    flags: [],
    why: 'Лише частина випадків потенційних конфліктів інтересів розглянута в строк. Чіткі строки допоможуть закрити цю прогалину.',
    actions: [
      'Затвердити граничний строк розгляду повідомлення',
      'Призначити відповідальну особу за облік строків',
      'Щомісяця переглядати перелік нерозглянутих випадків',
    ],
  },
  {
    id: 'rec-complaints',
    title: 'Дотримуватися строків розгляду скарг і звернень',
    component: 'accountability',
    items: ['sy-f1', 'ac-p3'],
    flags: [],
    why: 'Частина скарг і звернень розглянута з порушенням строків. Прозорий облік строків підвищує довіру до каналів звернень.',
    actions: [
      'Запровадити облік строків розгляду в єдиному журналі',
      'Нагадувати виконавцям за три дні до граничного строку',
      'Повідомляти заявникам про результат розгляду',
    ],
  },
  {
    id: 'rec-procedures',
    title: 'Зробити внутрішні процедури зрозумілішими',
    component: 'system',
    items: ['sy-p1', 'sy-p3'],
    flags: [],
    why: 'Працівники вважають процедури недостатньо зрозумілими. Коротка пам’ятка зі схемою дій зменшує кількість помилок.',
    actions: [
      'Підготувати пам’ятку зі схемою дій для типових ситуацій',
      'Провести короткі роз’яснення в підрозділах',
      'Зібрати питання працівників і оновити пам’ятку',
    ],
  },
  {
    id: 'rec-culture',
    title: 'Додати практичні приклади до навчання з доброчесності',
    component: 'culture',
    items: ['cu-p3', 'cu-f1'],
    flags: [],
    why: 'Навчання проводять за планом, але працівники рідко бачать практичні приклади. Приклади допомагають вчасно повідомляти про проблеми.',
    actions: [
      'Підібрати три-чотири типові ситуації для обговорення',
      'Додати розбір ситуацій у плани занять',
      'Зібрати відгуки учасників після занять',
    ],
  },
]

/** Поріг: показник нижчий за нього вважається слабким. */
export const WEAK_THRESHOLD = 65

export function priorityOf(values: number[], flagRaised: boolean): Priority {
  const min = values.length ? Math.min(...values) : 100
  if (min < 40 || (flagRaised && min < WEAK_THRESHOLD)) return 'high'
  if (min < WEAK_THRESHOLD || flagRaised) return 'medium'
  return 'low'
}

export const explainLink = (component: ComponentId, nodeId: string): string =>
  `/explain?c=${component}&n=${nodeId}`

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const out: Recommendation[] = []
  for (const t of TEMPLATES) {
    const items = input.items.filter((i) => t.items.includes(i.id))
    const flags = input.flags.filter((f) => t.flags.includes(f.id) && f.raised)
    const weak = items.filter((i) => i.value < WEAK_THRESHOLD)
    if (weak.length === 0 && flags.length === 0) continue
    out.push({
      id: t.id,
      title: t.title,
      priority: priorityOf(
        items.map((i) => i.value),
        flags.length > 0,
      ),
      component: t.component,
      evidence: [
        ...items.map((i): Evidence => ({
          id: i.id,
          kind: 'item',
          label: i.label,
          valueText: `${fmt(i.value)} зі 100`,
          href: explainLink(i.component, i.id),
        })),
        ...flags.map((f): Evidence => ({
          id: f.id,
          kind: 'flag',
          label: f.title,
          valueText: 'Прапорець спрацював',
          href: explainLink(t.component, f.id),
        })),
      ],
      why: t.why,
      actions: t.actions,
      status: 'proposed',
    })
  }
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority])
}
