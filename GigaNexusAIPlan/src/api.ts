import type { Dependency, Plan, ProgressLog, ServerInfo, Task, Workstream } from './types'

const PIN_KEY = 'nexusplan.pin'

export function getPin(): string {
  try {
    return sessionStorage.getItem(PIN_KEY) || ''
  } catch {
    return ''
  }
}
export function savePin(pin: string) {
  try {
    if (pin) sessionStorage.setItem(PIN_KEY, pin)
    else sessionStorage.removeItem(PIN_KEY)
  } catch {
    /* 私密視窗等情況忽略 */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any) {
    super(message)
  }
}

/** 每次回應帶回的資料版本，store 用來判斷是否有其他裝置寫入 */
export let lastRevisionHeader: number | null = null

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const pin = getPin()
  if (pin) headers['x-edit-pin'] = encodeURIComponent(pin)
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const rev = res.headers.get('x-revision')
  if (rev) lastRevisionHeader = Number(rev)
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, data?.error || `${res.status} ${res.statusText}`, data)
  return data as T
}

export const api = {
  plan: () => req<Plan>('GET', '/api/plan'),
  revision: () => req<{ revision: number }>('GET', '/api/revision'),
  serverInfo: () => req<ServerInfo>('GET', '/api/server-info'),
  checkPin: (pin: string) => req<{ ok: boolean }>('POST', '/api/auth/check', { pin }),
  setPin: (pin: string) => req<{ hasPin: boolean }>('PUT', '/api/settings/pin', { pin }),

  createTask: (task: Partial<Task>, dependencies: { from: string; to: string }[] = []) =>
    req<Task>('POST', '/api/tasks', { task, dependencies }),
  updateTask: (id: string, changes: Partial<Task>, note = '', expectedUpdatedAt?: string) =>
    req<Task>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, { changes, note, expectedUpdatedAt }),
  batchUpdate: (items: { id: string; changes: Partial<Task>; note?: string }[]) => req<Task[]>('POST', '/api/tasks/batch', { items }),
  deleteTask: (id: string) => req<Task>('DELETE', `/api/tasks/${encodeURIComponent(id)}`),
  logs: (id: string) => req<ProgressLog[]>('GET', `/api/tasks/${encodeURIComponent(id)}/logs`),

  addDependency: (from: string, to: string) => req<Dependency>('POST', '/api/dependencies', { from, to }),
  removeDependency: (id: number) => req<{ ok: true }>('DELETE', `/api/dependencies/${id}`),

  createWorkstream: (ws: Partial<Workstream>) => req<Workstream>('POST', '/api/workstreams', ws),
  updateWorkstream: (ws: Workstream) => req<Workstream>('PUT', `/api/workstreams/${encodeURIComponent(ws.id)}`, ws),
  deleteWorkstream: (id: string) => req<{ ok: true }>('DELETE', `/api/workstreams/${encodeURIComponent(id)}`),

  changes: (since: string) => req<ProgressLog[]>('GET', `/api/changes?since=${encodeURIComponent(since)}`),
  exportPlan: () => req<unknown>('GET', '/api/export'),
  importPlan: (data: unknown) => req<Plan>('POST', '/api/import', data),
  backup: () => req<{ file: string }>('POST', '/api/backup'),
}
