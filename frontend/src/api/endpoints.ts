/** Виклики бекенду, згруповані за екранами. Типи — з `backend.d.ts` (npm run api:types:backend). */
import { API_BASE, request, session, type Schemas } from './client'

export type S = Schemas
type Q = Record<string, string | number | boolean | undefined | null>

const get = <T>(path: string, query?: Q) => request<T>(path, { query })
const post = <T>(path: string, body?: unknown, query?: Q) =>
  request<T>(path, { method: 'POST', body, query })
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body })
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export const endpoints = {
  // Результати
  dashboard: (q?: { campaign_id?: string; unit_id?: string }) =>
    get<S['DashboardOut']>('/dashboard', q),
  results: (campaignId: string, unitId?: string) =>
    get<S['CampaignResultsOut']>(`/campaigns/${campaignId}/results`, { unit_id: unitId }),
  history: (unitId: string) => get<S['HistoryOut']>(`/units/${unitId}/history`),
  recommendations: (campaignId: string, unitId?: string) =>
    get<S['RecommendationsOut']>(`/campaigns/${campaignId}/recommendations`, { unit_id: unitId }),
  decide: (campaignId: string, code: string, body: S['DecisionIn']) =>
    post<unknown>(
      `/campaigns/${campaignId}/recommendations/${encodeURIComponent(code)}/decision`,
      body,
    ),
  measures: (q?: { unit_id?: string }) => get<S['MeasureOut'][]>('/measures', q),
  updateMeasure: (id: string, body: S['MeasureUpdate']) =>
    patch<S['MeasureOut']>(`/measures/${id}`, body),
  reportUrl: (campaignId: string, unitId: string | undefined, format: 'csv' | 'json') =>
    `${API_BASE}/campaigns/${campaignId}/report?format=${format}${unitId ? `&unit_id=${unitId}` : ''}`,

  // Учасник
  assignments: () => get<S['AssignmentOut'][]>('/me/assignments'),
  myResults: () => get<S['ParticipantResultOut']>('/me/results'),
  form: (campaignId: string, questionnaireId: string) =>
    get<S['FormOut']>(`/campaigns/${campaignId}/questionnaires/${questionnaireId}/form`),
  submit: (campaignId: string, questionnaireId: string, body: S['SubmissionIn']) =>
    post<S['SubmissionOut']>(
      `/campaigns/${campaignId}/questionnaires/${questionnaireId}/responses`,
      body,
    ),

  // Хвилі (адміністратор)
  campaigns: () => get<S['CampaignOut'][]>('/campaigns'),
  createCampaign: (body: S['CampaignCreate']) => post<S['CampaignOut']>('/campaigns', body),
  updateCampaign: (id: string, body: S['CampaignUpdate']) =>
    patch<S['CampaignOut']>(`/campaigns/${id}`, body),
  openCampaign: (id: string) => post<S['CampaignOut']>(`/campaigns/${id}/open`),
  closeCampaign: (id: string) => post<S['CampaignOut']>(`/campaigns/${id}/close`),
  progress: (id: string) => get<S['CampaignProgress']>(`/campaigns/${id}/progress`),
  issueTokens: (id: string, body: S['TokensIn']) =>
    post<S['TokensOut']>(`/campaigns/${id}/tokens`, body),
  revokeTokens: (id: string, body: S['TokensRevokeIn']) =>
    post<S['TokensRevokeOut']>(`/campaigns/${id}/tokens/revoke`, body),
  units: () => get<S['UnitOut'][]>('/admin/units'),
  questionnaires: (q?: { status?: string }) =>
    get<S['QuestionnaireSummary'][]>('/questionnaires', q),
  questionnaire: (id: string) => get<S['QuestionnaireOut']>(`/questionnaires/${id}`),
  publish: (id: string) => post<S['QuestionnaireOut']>(`/questionnaires/${id}/publish`),
  newVersion: (id: string) => post<S['QuestionnaireOut']>(`/questionnaires/${id}/new-version`),
  archive: (id: string) => post<S['QuestionnaireOut']>(`/questionnaires/${id}/archive`),
  validate: (id: string) => get<S['ValidationIssue'][]>(`/questionnaires/${id}/validate`),

  // Чек-лист
  checklist: (campaignId: string) => get<S['ChecklistOut']>(`/campaigns/${campaignId}/checklist`),
  setEntry: (campaignId: string, questionId: string, body: S['EntryIn']) =>
    put<S['ChecklistItemOut']>(`/campaigns/${campaignId}/checklist/${questionId}`, body),
  confirm: (campaignId: string, questionId: string) =>
    post<S['ChecklistItemOut']>(`/campaigns/${campaignId}/checklist/${questionId}/confirm`),
  unconfirm: (campaignId: string, questionId: string) =>
    del<S['ChecklistItemOut']>(`/campaigns/${campaignId}/checklist/${questionId}/confirm`),
  uploadFile: (campaignId: string, questionId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<S['EvidenceFileOut']>(`/campaigns/${campaignId}/checklist/${questionId}/files`, {
      method: 'POST',
      body: fd,
    })
  },
  deleteFile: (campaignId: string, questionId: string, fileId: string) =>
    del<void>(`/campaigns/${campaignId}/checklist/${questionId}/files/${fileId}`),

  // Журнал
  auditLog: (q?: Q) => get<S['AuditLogOut'][]>('/admin/audit-log', q),
  verifyAudit: () => post<S['AuditVerifyOut']>('/admin/audit-log/verify'),
}

/** Завантажити файл із заголовком авторизації (посилання <a href> токен не передає). */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const token = session.get()
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Не вдалося завантажити файл (${res.status})`)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
