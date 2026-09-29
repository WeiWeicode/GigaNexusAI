import type { Dependency, Task, Workstream } from '../types'
import { duration, toDay, fromDay } from './date'

/** 依今天日期計算「照計畫應完成」的百分比 */
export function expectedProgress(t: Pick<Task, 'start' | 'end'>, today: string): number {
  if (today < t.start) return 0
  if (today > t.end) return 100
  return Math.round(((toDay(today) - toDay(t.start) + 1) / duration(t.start, t.end)) * 100)
}

/** 延遲：實際進度落後預期超過 10 個百分點，或已過結束日仍未完成 */
export function isDelayed(t: Task, today: string): boolean {
  if (t.status === 'done' || t.status === 'on_hold') return false
  if (t.type === 'milestone') return today > t.end
  if (today > t.end) return true
  return t.progress + 10 < expectedProgress(t, today)
}

/** 以工期加權的完成度（實際 / 計畫） */
export function weighted(tasks: Task[], today: string) {
  const items = tasks.filter((t) => t.type !== 'milestone')
  const total = items.reduce((s, t) => s + duration(t.start, t.end), 0)
  if (!total) return { actual: 0, planned: 0 }
  let a = 0
  let p = 0
  for (const t of items) {
    const w = duration(t.start, t.end)
    a += t.progress * w
    p += expectedProgress(t, today) * w
  }
  return { actual: Math.round(a / total), planned: Math.round(p / total) }
}

export interface WorkstreamSummary {
  ws: Workstream
  start: string | null
  end: string | null
  actual: number
  planned: number
  total: number
  done: number
  delayed: number
  blocked: number
}

export function summarize(ws: Workstream, tasks: Task[], today: string): WorkstreamSummary {
  const own = tasks.filter((t) => t.workstreamId === ws.id)
  const { actual, planned } = weighted(own, today)
  return {
    ws,
    start: own.length ? own.reduce((m, t) => (t.start < m ? t.start : m), own[0].start) : null,
    end: own.length ? own.reduce((m, t) => (t.end > m ? t.end : m), own[0].end) : null,
    actual,
    planned,
    total: own.length,
    done: own.filter((t) => t.status === 'done').length,
    delayed: own.filter((t) => isDelayed(t, today)).length,
    blocked: own.filter((t) => t.status === 'blocked').length,
  }
}

/** Finish-to-Start：後續任務最早可開始日（里程碑可與前置同日） */
export function earliestStart(pred: Task, succ: Task): number {
  const gap = pred.type === 'milestone' || succ.type === 'milestone' ? 0 : 1
  return toDay(pred.end) + gap
}

export function isViolated(dep: Dependency, byId: Map<string, Task>): boolean {
  const a = byId.get(dep.from)
  const b = byId.get(dep.to)
  if (!a || !b) return false
  return toDay(b.start) < earliestStart(a, b)
}

/**
 * 計算移動 rootId 後需要一併順延的後續任務（保留工期，只往後推）。
 * 回傳 [{ id, changes: { start, end } }]
 */
export function cascadeShift(rootId: string, tasks: Task[], deps: Dependency[]) {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]))
  const out = new Map<string, { start: string; end: string }>()
  const queue = [rootId]
  let guard = 0
  while (queue.length && guard++ < 5000) {
    const id = queue.shift()!
    const pred = byId.get(id)!
    for (const d of deps.filter((x) => x.from === id)) {
      const succ = byId.get(d.to)
      if (!succ) continue
      const need = earliestStart(pred, succ)
      const cur = toDay(succ.start)
      if (cur >= need) continue
      const shift = need - cur
      succ.start = fromDay(cur + shift)
      succ.end = fromDay(toDay(succ.end) + shift)
      out.set(succ.id, { start: succ.start, end: succ.end })
      queue.push(succ.id)
    }
  }
  return [...out].map(([id, changes]) => ({ id, changes }))
}

export function ownersOf(tasks: Task[]): string[] {
  const set = new Set<string>()
  for (const t of tasks) for (const o of t.owner.split(/[、,，/]/)) if (o.trim()) set.add(o.trim())
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}
