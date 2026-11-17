/** Синтетичні заходи (посади, не імена). Дата демо: див. TODAY. */
import type { Measure } from '@/lib/measures'

/** Дата демо-даних: збігається з датою оцінювання. */
export const TODAY = '2026-11-16'

/** Рекомендації попередніх циклів, з яких виникли заходи. */
export const PAST_RECOMMENDATIONS: Record<string, string> = {
  'rec-2025-06-a': 'Запровадити канал анонімних звернень',
  'rec-2025-12-a': 'Підготувати пам’ятку з правил доброчесності',
  'rec-2026-06-a': 'Провести навчання для кураторів груп',
  'rec-2026-06-b': 'Оновити порядок розгляду скарг',
  'rec-2026-06-c': 'Скласти календар обов’язкових декларацій',
}

export const DEMO_MEASURES: Measure[] = [
  {
    id: 'm-1',
    recommendationId: 'rec-2025-06-a',
    title: 'Запровадити канал анонімних звернень',
    responsiblePosition: 'Заступник начальника з виховної роботи',
    dueDate: '2026-03-31',
    status: 'confirmed',
    verification: 'Підтверджено наступним оцінюванням',
  },
  {
    id: 'm-2',
    recommendationId: 'rec-2026-06-a',
    title: 'Провести навчання для кураторів груп',
    responsiblePosition: 'Начальник навчального відділу',
    dueDate: '2026-10-15',
    status: 'done',
    verification: null,
  },
  {
    id: 'm-3',
    recommendationId: 'rec-2026-06-b',
    title: 'Оновити порядок розгляду скарг і звернень',
    responsiblePosition: 'Начальник юридичного відділу',
    dueDate: '2026-11-05',
    status: 'inprogress',
    verification: null,
  },
  {
    id: 'm-4',
    recommendationId: 'rec-2026-06-c',
    title: 'Скласти календар подання декларацій',
    responsiblePosition: 'Уповноважений з доброчесності',
    dueDate: '2026-12-15',
    status: 'inprogress',
    verification: null,
  },
  {
    id: 'm-5',
    recommendationId: 'rec-2025-12-a',
    title: 'Підготувати пам’ятку з правил доброчесності',
    responsiblePosition: 'Заступник начальника з виховної роботи',
    dueDate: '2026-12-20',
    status: 'inprogress',
    verification: null,
  },
  {
    id: 'm-6',
    recommendationId: 'rec-2026-06-b',
    title: 'Призначити відповідальну особу за облік звернень',
    responsiblePosition: 'Начальник штабу',
    dueDate: '2027-01-31',
    status: 'accepted',
    verification: null,
  },
]

/** Посади, з яких обирають відповідальну (синтетичні). */
export const POSITIONS = [
  'Заступник начальника з виховної роботи',
  'Начальник навчального відділу',
  'Начальник юридичного відділу',
  'Уповноважений з доброчесності',
  'Начальник штабу',
] as const
