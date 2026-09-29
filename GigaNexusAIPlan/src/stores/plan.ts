import { defineStore } from 'pinia'
import { api, ApiError, lastRevisionHeader, savePin } from '../api'
import type { Dependency, Scale, ServerInfo, Task, TaskStatus, Workstream } from '../types'
import { todayStr } from '../utils/date'
import { cascadeShift, isDelayed, summarize, type WorkstreamSummary } from '../utils/metrics'

export type Row =
  | { kind: 'ws'; key: string; ws: Workstream; summary: WorkstreamSummary; collapsed: boolean }
  | { kind: 'task'; key: string; task: Task; depth: number; delayed: boolean }

interface HistoryEntry {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

interface Toast {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
}

export type StatusFilter = '' | TaskStatus | 'delayed'

const LS = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('nexusplan.' + key)
      return v == null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('nexusplan.' + key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
}

const pick = <T extends object>(obj: T, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, (obj as any)[k]])) as Partial<T>

let toastSeq = 0

export const usePlan = defineStore('plan', {
  state: () => ({
    workstreams: [] as Workstream[],
    tasks: [] as Task[],
    dependencies: [] as Dependency[],
    revision: 0,
    server: null as ServerInfo | null,
    loaded: false,
    loadError: '',
    today: todayStr(),

    search: '',
    ownerFilter: '',
    statusFilter: '' as StatusFilter,
    scale: LS.get<Scale>('scale', 'week'),
    collapsed: LS.get<string[]>('collapsed', []),
    reportMode: false,
    theme: LS.get<'light' | 'dark'>('theme', 'light'),

    selectedId: null as string | null,
    drawer: null as null | { mode: 'edit'; taskId: string } | { mode: 'new'; preset: Partial<Task> },
    wsDialog: null as null | { ws: Workstream | null },
    connectOpen: false,
    cascade: null as null | { rootName: string; items: { id: string; changes: Partial<Task> }[] },
    interacting: false,

    undoStack: [] as HistoryEntry[],
    redoStack: [] as HistoryEntry[],
    toasts: [] as Toast[],
  }),

  getters: {
    byId(state): Map<string, Task> {
      return new Map(state.tasks.map((t) => [t.id, t]))
    },
    canEdit(state): boolean {
      return !!state.server?.canEdit && !state.reportMode
    },
    filtersActive(state): boolean {
      return !!(state.search.trim() || state.ownerFilter || state.statusFilter)
    },
    matches(state) {
      const q = state.search.trim().toLowerCase()
      return (t: Task) => {
        if (q && ![t.id, t.name, t.owner, t.description].some((s) => s.toLowerCase().includes(q))) return false
        if (state.ownerFilter && !t.owner.split(/[、,，/]/).map((s) => s.trim()).includes(state.ownerFilter)) return false
        if (state.statusFilter === 'delayed') return isDelayed(t, state.today)
        if (state.statusFilter && t.status !== state.statusFilter) return false
        return true
      }
    },
    rows(): Row[] {
      const rows: Row[] = []
      const sorted = [...this.tasks].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      for (const ws of [...this.workstreams].sort((a, b) => a.sort - b.sort)) {
        const own = sorted.filter((t) => t.workstreamId === ws.id)
        const ids = new Set(own.map((t) => t.id))
        const children = new Map<string | null, Task[]>()
        for (const t of own) {
          const p = t.parentId && ids.has(t.parentId) ? t.parentId : null
          if (!children.has(p)) children.set(p, [])
          children.get(p)!.push(t)
        }
        const flat: { task: Task; depth: number }[] = []
        const walk = (pid: string | null, depth: number) => {
          for (const t of children.get(pid) || []) {
            flat.push({ task: t, depth })
            walk(t.id, depth + 1)
          }
        }
        walk(null, 0)
        const visible = this.filtersActive ? flat.filter((x) => this.matches(x.task)) : flat
        if (this.filtersActive && !visible.length) continue
        const collapsed = this.collapsed.includes(ws.id) && !this.filtersActive
        rows.push({ kind: 'ws', key: 'ws:' + ws.id, ws, summary: summarize(ws, this.tasks, this.today), collapsed })
        if (collapsed) continue
        for (const x of visible)
          rows.push({ kind: 'task', key: x.task.id, task: x.task, depth: x.depth, delayed: isDelayed(x.task, this.today) })
      }
      return rows
    },
  },

  actions: {
    // ---------- 載入與同步 ----------
    async load() {
      try {
        const [plan, server] = await Promise.all([api.plan(), api.serverInfo()])
        this.workstreams = plan.workstreams
        this.tasks = plan.tasks
        this.dependencies = plan.dependencies
        this.revision = plan.revision
        this.server = server
        this.loaded = true
        this.loadError = ''
        this.today = todayStr()
        if (this.drawer?.mode === 'edit' && !this.byId.has(this.drawer.taskId)) this.drawer = null
      } catch (e: any) {
        this.loadError = e.message || '無法連線至 NexusPlan 服務'
      }
    },

    async poll() {
      if (this.interacting) return
      try {
        const { revision } = await api.revision()
        if (revision !== this.revision) await this.load()
        if (this.loadError) this.loadError = ''
      } catch {
        this.loadError = '與主機的連線中斷，將自動重試…'
      }
    },

    /** 自己寫入後同步版本號；若中間有其他裝置寫入，留給 poll 重新載入 */
    syncRevision() {
      if (lastRevisionHeader != null && lastRevisionHeader === this.revision + 1) this.revision = lastRevisionHeader
    },

    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      try {
        const r = await fn()
        this.syncRevision()
        return r
      } catch (e) {
        if (e instanceof ApiError) {
          this.toast(e.message, 'error')
          if (e.status === 409) await this.load()
          if (e.status === 403) this.server = await api.serverInfo().catch(() => this.server)
        } else {
          this.toast('連線失敗：' + (e as Error).message, 'error')
        }
        return undefined
      }
    },

    putTask(t: Task) {
      const i = this.tasks.findIndex((x) => x.id === t.id)
      if (i >= 0) this.tasks.splice(i, 1, t)
      else this.tasks.push(t)
    },

    record(entry: HistoryEntry) {
      this.undoStack.push(entry)
      if (this.undoStack.length > 100) this.undoStack.shift()
      this.redoStack = []
    },

    // ---------- 任務 ----------
    async updateTask(id: string, changes: Partial<Task>, opts: { note?: string; expectedUpdatedAt?: string; label?: string } = {}) {
      const before = this.byId.get(id)
      if (!before) return
      const prev = pick(before, [...Object.keys(changes), 'progress', 'status', 'end'])
      const t = await this.run(() => api.updateTask(id, changes, opts.note, opts.expectedUpdatedAt))
      if (!t) return
      this.putTask(t)
      const next = pick(t, Object.keys(prev))
      this.record({
        label: opts.label || `修改「${t.name}」`,
        undo: async () => {
          const r = await this.run(() => api.updateTask(id, prev, '復原'))
          if (r) this.putTask(r)
        },
        redo: async () => {
          const r = await this.run(() => api.updateTask(id, next, '重做'))
          if (r) this.putTask(r)
        },
      })
      return t
    },

    async batchUpdate(items: { id: string; changes: Partial<Task> }[], label: string) {
      const prev = items.map((it) => ({ id: it.id, changes: pick(this.byId.get(it.id)!, Object.keys(it.changes)) }))
      const res = await this.run(() => api.batchUpdate(items))
      if (!res) return
      res.forEach((t) => this.putTask(t))
      this.record({
        label,
        undo: async () => {
          const r = await this.run(() => api.batchUpdate(prev))
          r?.forEach((t) => this.putTask(t))
        },
        redo: async () => {
          const r = await this.run(() => api.batchUpdate(items))
          r?.forEach((t) => this.putTask(t))
        },
      })
    },

    async createTask(task: Partial<Task>, deps: { from: string; to: string }[] = []) {
      const t = await this.run(() => api.createTask(task, deps))
      if (!t) return
      await this.reloadDeps()
      this.putTask(t)
      let snapshot = t
      this.record({
        label: `新增「${t.name}」`,
        undo: async () => {
          snapshot = this.byId.get(t.id) || snapshot
          if (await this.run(() => api.deleteTask(t.id))) this.dropTaskLocal(t.id)
        },
        redo: async () => {
          const r = await this.run(() => api.createTask(snapshot, deps))
          if (r) {
            this.putTask(r)
            await this.reloadDeps()
          }
        },
      })
      return t
    },

    async deleteTask(id: string) {
      const t = this.byId.get(id)
      if (!t) return
      const deps = this.dependencies.filter((d) => d.from === id || d.to === id).map((d) => ({ from: d.from, to: d.to }))
      const children = this.tasks.filter((x) => x.parentId === id).map((x) => x.id)
      if (!(await this.run(() => api.deleteTask(id)))) return
      this.dropTaskLocal(id)
      if (this.drawer?.mode === 'edit' && this.drawer.taskId === id) this.drawer = null
      this.toast(`已刪除「${t.name}」，可按 Ctrl+Z 復原`)
      this.record({
        label: `刪除「${t.name}」`,
        undo: async () => {
          const r = await this.run(() => api.createTask(t, deps))
          if (!r) return
          this.putTask(r)
          if (children.length) {
            const rs = await this.run(() => api.batchUpdate(children.map((c) => ({ id: c, changes: { parentId: id } }))))
            rs?.forEach((x) => this.putTask(x))
          }
          await this.reloadDeps()
        },
        redo: async () => {
          if (await this.run(() => api.deleteTask(id))) this.dropTaskLocal(id)
        },
      })
    },

    dropTaskLocal(id: string) {
      const t = this.byId.get(id)
      this.tasks = this.tasks.filter((x) => x.id !== id).map((x) => (x.parentId === id ? { ...x, parentId: t?.parentId ?? null } : x))
      this.dependencies = this.dependencies.filter((d) => d.from !== id && d.to !== id)
      if (this.selectedId === id) this.selectedId = null
    },

    async reloadDeps() {
      const plan = await this.run(() => api.plan())
      if (plan) this.dependencies = plan.dependencies
    },

    /** 拖曳移動/調整工期後，檢查後續任務是否重疊 */
    checkCascade(id: string) {
      const items = cascadeShift(id, this.tasks, this.dependencies)
      if (items.length) this.cascade = { rootName: this.byId.get(id)?.name || id, items }
    },

    async applyCascade() {
      if (!this.cascade) return
      const { items, rootName } = this.cascade
      this.cascade = null
      await this.batchUpdate(items, `順延「${rootName}」的後續任務`)
      this.toast(`已順延 ${items.length} 個後續任務`, 'success')
    },

    async moveTask(id: string, dir: -1 | 1) {
      const t = this.byId.get(id)
      if (!t) return
      const siblings = this.tasks
        .filter((x) => x.workstreamId === t.workstreamId && (x.parentId ?? null) === (t.parentId ?? null))
        .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      const i = siblings.findIndex((x) => x.id === id)
      const other = siblings[i + dir]
      if (!other) return
      // 若 sort 相同，先重新編號
      const items =
        t.sort === other.sort
          ? siblings.map((x, k) => ({ id: x.id, changes: { sort: x.id === id ? i + dir : x.id === other.id ? i : k } }))
          : [
              { id, changes: { sort: other.sort } },
              { id: other.id, changes: { sort: t.sort } },
            ]
      await this.batchUpdate(items, `調整「${t.name}」順序`)
    },

    // ---------- 相依 ----------
    async addDependency(from: string, to: string) {
      if (this.dependencies.some((d) => d.from === from && d.to === to)) return
      const d = await this.run(() => api.addDependency(from, to))
      if (!d) return
      this.dependencies.push(d)
      const findId = () => this.dependencies.find((x) => x.from === from && x.to === to)?.id
      this.record({
        label: '新增相依',
        undo: async () => {
          const id = findId()
          if (id != null && (await this.run(() => api.removeDependency(id)))) this.dependencies = this.dependencies.filter((x) => x.id !== id)
        },
        redo: async () => {
          const r = await this.run(() => api.addDependency(from, to))
          if (r) this.dependencies.push(r)
        },
      })
      const a = this.byId.get(from)
      const b = this.byId.get(to)
      if (a && b) this.toast(`已建立相依：${a.name} → ${b.name}`, 'success')
      this.checkCascade(from)
    },

    async removeDependency(id: number) {
      const d = this.dependencies.find((x) => x.id === id)
      if (!d) return
      if (!(await this.run(() => api.removeDependency(id)))) return
      this.dependencies = this.dependencies.filter((x) => x.id !== id)
      const { from, to } = d
      this.record({
        label: '移除相依',
        undo: async () => {
          const r = await this.run(() => api.addDependency(from, to))
          if (r) this.dependencies.push(r)
        },
        redo: async () => {
          const cur = this.dependencies.find((x) => x.from === from && x.to === to)
          if (cur && (await this.run(() => api.removeDependency(cur.id)))) this.dependencies = this.dependencies.filter((x) => x.id !== cur.id)
        },
      })
    },

    // ---------- 工作流 ----------
    async saveWorkstream(ws: Partial<Workstream> & { name: string; color: string }) {
      const r = await this.run(() => (ws.id ? api.updateWorkstream(ws as Workstream) : api.createWorkstream(ws)))
      if (!r) return
      const i = this.workstreams.findIndex((x) => x.id === r.id)
      if (i >= 0) this.workstreams.splice(i, 1, r)
      else this.workstreams.push(r)
      return r
    },

    async deleteWorkstream(id: string) {
      if (!(await this.run(() => api.deleteWorkstream(id)))) return
      await this.load()
      this.undoStack = []
      this.redoStack = []
    },

    async moveWorkstream(id: string, dir: -1 | 1) {
      const list = [...this.workstreams].sort((a, b) => a.sort - b.sort)
      const i = list.findIndex((w) => w.id === id)
      const other = list[i + dir]
      if (!other) return
      const a = { ...list[i], sort: i + dir + 1 }
      const b = { ...other, sort: i + 1 }
      // 其餘依目前順序重新編號，避免 sort 重複
      const rest = list.filter((w) => w.id !== a.id && w.id !== b.id).map((w) => ({ ...w, sort: list.indexOf(w) + 1 }))
      for (const w of [a, b, ...rest]) await this.saveWorkstream(w)
    },

    // ---------- 復原 / 重做 ----------
    async undo() {
      const e = this.undoStack.pop()
      if (!e) return
      await e.undo()
      this.redoStack.push(e)
      this.toast('已復原：' + e.label)
    },
    async redo() {
      const e = this.redoStack.pop()
      if (!e) return
      await e.redo()
      this.undoStack.push(e)
      this.toast('已重做：' + e.label)
    },

    // ---------- 其他 ----------
    async unlock(pin: string) {
      const { ok } = await api.checkPin(pin)
      if (!ok) return false
      savePin(pin)
      this.server = await api.serverInfo()
      return true
    },
    lock() {
      savePin('')
      api.serverInfo().then((s) => (this.server = s))
    },

    toggleCollapse(wsId: string) {
      this.collapsed = this.collapsed.includes(wsId) ? this.collapsed.filter((x) => x !== wsId) : [...this.collapsed, wsId]
      LS.set('collapsed', this.collapsed)
    },
    setScale(s: Scale) {
      this.scale = s
      LS.set('scale', s)
    },
    setTheme(t: 'light' | 'dark') {
      this.theme = t
      LS.set('theme', t)
      document.documentElement.dataset.theme = t
    },

    openTask(id: string) {
      this.selectedId = id
      this.drawer = { mode: 'edit', taskId: id }
    },
    newTask(preset: Partial<Task> = {}) {
      this.drawer = { mode: 'new', preset }
    },

    toast(text: string, kind: Toast['kind'] = 'info') {
      const id = ++toastSeq
      this.toasts.push({ id, text, kind })
      setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 2800)
    },
  },
})
