export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'on_hold'
export type TaskType = 'task' | 'milestone'
export type Priority = 'low' | 'normal' | 'high'
export type Scale = 'day' | 'week' | 'month' | 'quarter'

export interface Workstream {
  id: string
  name: string
  color: string
  sort: number
}

export interface Task {
  id: string
  workstreamId: string
  parentId: string | null
  name: string
  owner: string
  start: string
  end: string
  progress: number
  status: TaskStatus
  type: TaskType
  priority: Priority
  description: string
  blockedReason: string
  links: string[]
  sort: number
  updatedAt: string
  /** 最新一筆進度備註（唯讀，由歷程產生） */
  lastNote?: string
  lastNoteAt?: string | null
}

export interface Dependency {
  id: number
  from: string
  to: string
  type: 'FS'
}

export interface Plan {
  revision: number
  workstreams: Workstream[]
  tasks: Task[]
  dependencies: Dependency[]
}

export interface ProgressLog {
  id: number
  task_id: string
  task_name: string
  at: string
  from_progress: number | null
  to_progress: number | null
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  note: string
}

export interface ServerInfo {
  hostname: string
  port: number
  addresses: { name: string; address: string; virtual: boolean }[]
  hasPin: boolean
  isLocal: boolean
  canEdit: boolean
  dbFile?: string
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '未開始',
  in_progress: '進行中',
  blocked: '卡關',
  done: '已完成',
  on_hold: '暫緩',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: '低',
  normal: '一般',
  high: '高',
}

export const SCALE_LABEL: Record<Scale, string> = {
  day: '日',
  week: '週',
  month: '月',
  quarter: '季',
}
