/** Звідки беруться дані: чесні статуси інтеграцій. Лише синтетичний опис. */

export type SourceMode = 'auto' | 'manual' | 'planned' | 'approval'

export const SOURCE_MODE_LABEL: Record<SourceMode, string> = {
  auto: 'Автоматично',
  manual: 'Ручний ввід',
  planned: 'Планується',
  approval: 'Потребує погодження',
}

export interface DataSource {
  id: string
  metric: string
  source: string
  mode: SourceMode
  /** Вік даних простою мовою. */
  age: string
  explanation: string
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'ds-surveys',
    metric: 'Результати анкет',
    source: 'Модуль анонімних опитувань платформи',
    mode: 'auto',
    age: 'Оновлюється після кожної відповіді',
    explanation: 'Відповіді респондентів агрегуються автоматично. Окремі відповіді не показуються.',
  },
  {
    id: 'ds-checklist',
    metric: 'Чек-лист',
    source: 'Чек-лист закладу',
    mode: 'manual',
    age: 'Внесено 10.11.2026',
    explanation:
      'Один працівник вносить дані, інший підтверджує їх. Кожен пункт має джерело й дату.',
  },
  {
    id: 'ds-declarations',
    metric: 'Декларації подані вчасно',
    source: 'Відкрита база декларацій',
    mode: 'planned',
    age: 'Немає даних: інтеграцію ще не підключено',
    explanation: 'Поки значення вносять вручну в чек-лист. Автоматичне отримання планується.',
  },
  {
    id: 'ds-conflicts',
    metric: 'Конфлікти інтересів',
    source: 'Рішення з попереднього хакатону',
    mode: 'approval',
    age: 'Немає даних: потрібне погодження власника рішення',
    explanation:
      'Рішення може підказувати випадки для перевірки. Використання потребує погодження.',
  },
  {
    id: 'ds-procurement',
    metric: 'Закупівлі',
    source: 'Інший проєкт команди з оцінки закупівель',
    mode: 'planned',
    age: 'Немає даних: інтеграцію ще не підключено',
    explanation: 'Результати оцінки закупівель можуть стати фактами для компонента Підзвітність.',
  },
  {
    id: 'ds-complaints',
    metric: 'Скарги й звернення',
    source: 'Журнал звернень закладу',
    mode: 'manual',
    age: 'Внесено 12.11.2026',
    explanation: 'Кількість звернень і розглянутих у строк вносить уповноважений.',
  },
  {
    id: 'ds-measures',
    metric: 'Звітування за заходами',
    source: 'Система суміжної команди',
    mode: 'approval',
    age: 'Немає даних: інтеграцію ще не погоджено',
    explanation:
      'Автоматичне оновлення статусів заходів планується. Поки статуси змінюють вручну в трекері.',
  },
]

export interface Integration {
  id: string
  system: string
  purpose: string
  method: string
  mode: SourceMode
}

/** Карта інтеграцій простими картками. */
export const INTEGRATIONS: Integration[] = [
  {
    id: 'in-surveys',
    system: 'Модуль опитувань',
    purpose: 'Зібрати сприйняття працівників без ідентифікації',
    method: 'Одноразові коди доступу, агрегація на сервері',
    mode: 'auto',
  },
  {
    id: 'in-checklist',
    system: 'Чек-лист закладу',
    purpose: 'Підтвердити сприйняття фактами',
    method: 'Ручний ввід і підтвердження другою особою',
    mode: 'manual',
  },
  {
    id: 'in-declarations',
    system: 'Відкрита база декларацій',
    purpose: 'Перевіряти вчасність подання декларацій',
    method: 'Отримання відкритих даних за розкладом',
    mode: 'planned',
  },
  {
    id: 'in-conflicts',
    system: 'Рішення з попереднього хакатону',
    purpose: 'Підказувати випадки конфліктів інтересів для перевірки',
    method: 'Передача знеособлених результатів',
    mode: 'approval',
  },
  {
    id: 'in-procurement',
    system: 'Проєкт оцінки закупівель',
    purpose: 'Додати факти про закупівлі до Підзвітності',
    method: 'Обмін агрегованими показниками',
    mode: 'planned',
  },
  {
    id: 'in-measures',
    system: 'Система суміжної команди',
    purpose: 'Отримувати звіти про виконання заходів',
    method: 'Обмін статусами заходів',
    mode: 'approval',
  },
]
