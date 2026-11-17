/** Логіка анкети: повнота й автозбереження. У сховищі лише вибір варіантів, без жодних ідентифікаторів людини. */
import type { Survey } from '@/demo/survey'

export type Answers = Record<string, string>

export const DRAFT_PREFIX = 'survey-draft:'

export interface MissingQuestion {
  questionId: string
  sectionIndex: number
  /** Підпис для посилання: розділ і номер питання. */
  label: string
}

export function missingQuestions(survey: Survey, answers: Answers): MissingQuestion[] {
  const out: MissingQuestion[] = []
  survey.sections.forEach((s, si) =>
    s.questions.forEach((qq, qi) => {
      if (!answers[qq.id]) {
        out.push({
          questionId: qq.id,
          sectionIndex: si,
          label: `Розділ «${s.title}», питання ${qi + 1}`,
        })
      }
    }),
  )
  return out
}

export const answeredCount = (survey: Survey, answers: Answers): number =>
  survey.sections.reduce((n, s) => n + s.questions.filter((qq) => answers[qq.id]).length, 0)

export const questionCount = (survey: Survey): number =>
  survey.sections.reduce((n, s) => n + s.questions.length, 0)

/** Читає чернетку; приймає лише відомі питання й варіанти. */
export function loadDraft(survey: Survey, token: string): Answers {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + token)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Answers = {}
    for (const s of survey.sections)
      for (const qq of s.questions) {
        const v = (parsed as Record<string, unknown>)[qq.id]
        if (typeof v === 'string' && qq.options.some((o) => o.id === v)) out[qq.id] = v
      }
    return out
  } catch {
    return {}
  }
}

export function saveDraft(token: string, answers: Answers): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + token, JSON.stringify(answers))
  } catch {
    /* сховище недоступне: чернетка не зберігається */
  }
}

export function clearDraft(token: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + token)
  } catch {
    /* ігноруємо */
  }
}
