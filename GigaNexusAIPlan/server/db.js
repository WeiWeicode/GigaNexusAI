// 地端 SQLite 資料層（使用 Node 內建 node:sqlite，免編譯原生模組）
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.NEXUSPLAN_DATA || join(ROOT, 'data')
const BACKUP_DIR = join(DATA_DIR, 'backup')
const DB_FILE = join(DATA_DIR, 'nexusplan.db')
const SEED_FILE = join(ROOT, 'seed', 'plan.json')
const BACKUP_KEEP = 30

mkdirSync(BACKUP_DIR, { recursive: true })

const db = new DatabaseSync(DB_FILE)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workstreams (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3a6fd8',
    sort  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    workstream_id TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
    parent_id     TEXT,
    name          TEXT NOT NULL,
    owner         TEXT NOT NULL DEFAULT '',
    start         TEXT NOT NULL,
    end           TEXT NOT NULL,
    progress      INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'todo',
    type          TEXT NOT NULL DEFAULT 'task',
    priority      TEXT NOT NULL DEFAULT 'normal',
    description   TEXT NOT NULL DEFAULT '',
    blocked_reason TEXT NOT NULL DEFAULT '',
    links         TEXT NOT NULL DEFAULT '[]',
    sort          INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dependencies (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type    TEXT NOT NULL DEFAULT 'FS',
    UNIQUE(from_id, to_id)
  );

  CREATE TABLE IF NOT EXISTS progress_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL,
    task_name     TEXT NOT NULL,
    at            TEXT NOT NULL,
    from_progress INTEGER,
    to_progress   INTEGER,
    from_status   TEXT,
    to_status     TEXT,
    note          TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const now = () => new Date().toISOString()

// ---------- settings / revision ----------
const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))

export function getRevision() {
  return Number(getSetting('revision') || 0)
}
function bump() {
  setSetting('revision', getRevision() + 1)
}

const hashPin = (pin) => createHash('sha256').update('nexusplan:' + pin).digest('hex')
export const hasPin = () => !!getSetting('pin_hash')
export const checkPin = (pin) => !hasPin() || (!!pin && hashPin(String(pin)) === getSetting('pin_hash'))
export function setPin(pin) {
  if (pin) setSetting('pin_hash', hashPin(String(pin)))
  else db.prepare("DELETE FROM settings WHERE key = 'pin_hash'").run()
}

// ---------- mapping ----------
const toTask = (r) => ({
  id: r.id,
  workstreamId: r.workstream_id,
  parentId: r.parent_id,
  name: r.name,
  owner: r.owner,
  start: r.start,
  end: r.end,
  progress: r.progress,
  status: r.status,
  type: r.type,
  priority: r.priority,
  description: r.description,
  blockedReason: r.blocked_reason,
  links: JSON.parse(r.links || '[]'),
  sort: r.sort,
  updatedAt: r.updated_at,
  lastNote: r.last_note || '',
  lastNoteAt: r.last_note_at || null,
})

// 每個任務附上最新一筆進度備註
const TASK_SELECT = `
  SELECT t.*,
    (SELECT note FROM progress_logs l WHERE l.task_id = t.id AND l.note <> '' AND l.note NOT IN ('復原', '重做') ORDER BY l.at DESC, l.id DESC LIMIT 1) AS last_note,
    (SELECT at   FROM progress_logs l WHERE l.task_id = t.id AND l.note <> '' AND l.note NOT IN ('復原', '重做') ORDER BY l.at DESC, l.id DESC LIMIT 1) AS last_note_at
  FROM tasks t`

const TASK_FIELDS = {
  workstreamId: 'workstream_id',
  parentId: 'parent_id',
  name: 'name',
  owner: 'owner',
  start: 'start',
  end: 'end',
  progress: 'progress',
  status: 'status',
  type: 'type',
  priority: 'priority',
  description: 'description',
  blockedReason: 'blocked_reason',
  links: 'links',
  sort: 'sort',
}

function tx(fn) {
  db.exec('BEGIN')
  try {
    const r = fn()
    bump()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

// ---------- queries ----------
export function getPlan() {
  return {
    revision: getRevision(),
    workstreams: db.prepare('SELECT * FROM workstreams ORDER BY sort, id').all().map((r) => ({ ...r })),
    tasks: db.prepare(`${TASK_SELECT} ORDER BY t.sort, t.id`).all().map(toTask),
    dependencies: db.prepare('SELECT id, from_id AS "from", to_id AS "to", type FROM dependencies').all().map((r) => ({ ...r })),
  }
}

export function getTask(id) {
  const r = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)
  return r ? toTask(r) : null
}

export function getLogs(taskId) {
  return db.prepare('SELECT * FROM progress_logs WHERE task_id = ? ORDER BY at DESC, id DESC LIMIT 100').all(taskId).map((r) => ({ ...r }))
}

export function getChanges(since) {
  return db
    .prepare('SELECT * FROM progress_logs WHERE at >= ? ORDER BY at DESC, id DESC LIMIT 500')
    .all(since)
    .map((r) => ({ ...r }))
}

// ---------- mutations ----------
function nextTaskId(workstreamId) {
  const rows = db.prepare('SELECT id FROM tasks WHERE workstream_id = ?').all(workstreamId)
  let max = 0
  for (const { id } of rows) {
    const m = String(id).match(new RegExp(`^${workstreamId}-(\\d+)$`))
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  while (getTask(`${workstreamId}-${n}`)) n++
  return `${workstreamId}-${n}`
}

function validateTask(t) {
  if (!t.name || !String(t.name).trim()) throw new HttpError(400, '任務名稱不可空白')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.start) || !/^\d{4}-\d{2}-\d{2}$/.test(t.end)) throw new HttpError(400, '日期格式需為 YYYY-MM-DD')
  if (t.end < t.start) throw new HttpError(400, '結束日不可早於開始日')
  if (t.progress < 0 || t.progress > 100) throw new HttpError(400, '進度需介於 0–100')
}

function insertTask(input) {
  const t = {
    id: input.id || nextTaskId(input.workstreamId),
    workstreamId: input.workstreamId,
    parentId: input.parentId ?? null,
    name: input.name,
    owner: input.owner ?? '',
    start: input.start,
    end: input.type === 'milestone' ? input.start : input.end,
    progress: Math.round(input.progress ?? 0),
    status: input.status ?? 'todo',
    type: input.type ?? 'task',
    priority: input.priority ?? 'normal',
    description: input.description ?? '',
    blockedReason: input.blockedReason ?? '',
    links: input.links ?? [],
    sort: input.sort ?? (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM tasks').get().s),
  }
  validateTask(t)
  if (getTask(t.id)) throw new HttpError(409, `任務編號 ${t.id} 已存在`)
  db.prepare(
    `INSERT INTO tasks (id, workstream_id, parent_id, name, owner, start, end, progress, status, type, priority, description, blocked_reason, links, sort, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(t.id, t.workstreamId, t.parentId, t.name.trim(), t.owner, t.start, t.end, t.progress, t.status, t.type, t.priority, t.description, t.blockedReason, JSON.stringify(t.links), t.sort, now())
  return t.id
}

export function createTask(input, deps = []) {
  return tx(() => {
    const id = insertTask(input)
    for (const d of deps) insertDep(d.from, d.to)
    return getTask(id)
  })
}

function applyTaskPatch(id, changes, note = '', expectedUpdatedAt) {
  const before = getTask(id)
  if (!before) throw new HttpError(404, `找不到任務 ${id}`)
  if (expectedUpdatedAt && expectedUpdatedAt !== before.updatedAt)
    throw new HttpError(409, '此任務已被其他裝置更新，請重新載入後再試', { task: before })

  const after = { ...before, ...changes }
  if (after.type === 'milestone') after.end = after.start
  // 只改進度未指定狀態時，自動推導狀態
  if (!('status' in changes) && 'progress' in changes) {
    if (after.progress >= 100) after.status = 'done'
    else if (after.progress > 0 && (after.status === 'todo' || after.status === 'done')) after.status = 'in_progress'
    else if (after.progress === 0 && after.status === 'done') after.status = 'todo'
  }
  if (after.status === 'done') after.progress = 100
  if (after.status !== 'blocked') after.blockedReason = ''
  after.progress = Math.round(after.progress)
  validateTask(after)

  const sets = []
  const vals = []
  for (const [k, col] of Object.entries(TASK_FIELDS)) {
    const a = k === 'links' ? JSON.stringify(after.links) : after[k]
    const b = k === 'links' ? JSON.stringify(before.links) : before[k]
    if (a === b) continue
    sets.push(`${col} = ?`)
    vals.push(a)
  }
  const ts = now()
  sets.push('updated_at = ?')
  vals.push(ts)
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)

  if (before.progress !== after.progress || before.status !== after.status || note) {
    db.prepare(
      `INSERT INTO progress_logs (task_id, task_name, at, from_progress, to_progress, from_status, to_status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, after.name, ts, before.progress, after.progress, before.status, after.status, note || '')
  }
  return getTask(id)
}

export function updateTask(id, changes, note, expectedUpdatedAt) {
  return tx(() => applyTaskPatch(id, changes, note, expectedUpdatedAt))
}

/** 批次更新（例如：連動順延多個後續任務），單一交易 */
export function updateTasks(items) {
  return tx(() => items.map((it) => applyTaskPatch(it.id, it.changes, it.note)))
}

export function deleteTask(id) {
  return tx(() => {
    const t = getTask(id)
    if (!t) throw new HttpError(404, `找不到任務 ${id}`)
    db.prepare('UPDATE tasks SET parent_id = ? WHERE parent_id = ?').run(t.parentId, id)
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return t
  })
}

function insertDep(from, to) {
  if (from === to) throw new HttpError(400, '不可相依自己')
  if (!getTask(from) || !getTask(to)) throw new HttpError(404, '相依的任務不存在')
  // 循環檢查：to 是否可到達 from
  const seen = new Set()
  const stack = [to]
  const next = db.prepare('SELECT to_id FROM dependencies WHERE from_id = ?')
  while (stack.length) {
    const cur = stack.pop()
    if (cur === from) throw new HttpError(400, '此相依會形成循環')
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const r of next.all(cur)) stack.push(r.to_id)
  }
  db.prepare('INSERT OR IGNORE INTO dependencies (from_id, to_id, type) VALUES (?, ?, ?)').run(from, to, 'FS')
}

export function createDependency(from, to) {
  return tx(() => {
    insertDep(from, to)
    const r = db.prepare('SELECT id, from_id AS "from", to_id AS "to", type FROM dependencies WHERE from_id = ? AND to_id = ?').get(from, to)
    return { ...r }
  })
}

export function deleteDependency(id) {
  return tx(() => {
    db.prepare('DELETE FROM dependencies WHERE id = ?').run(id)
  })
}

export function upsertWorkstream(ws) {
  return tx(() => {
    if (!ws.name?.trim()) throw new HttpError(400, '工作流名稱不可空白')
    const id = ws.id || nextWorkstreamId()
    const sort = ws.sort ?? db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM workstreams').get().s
    db.prepare(
      `INSERT INTO workstreams (id, name, color, sort) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, sort = excluded.sort`
    ).run(id, ws.name.trim(), ws.color || '#3a6fd8', sort)
    return { ...db.prepare('SELECT * FROM workstreams WHERE id = ?').get(id) }
  })
}

function nextWorkstreamId() {
  let n = db.prepare('SELECT COUNT(*) AS c FROM workstreams').get().c + 1
  while (db.prepare('SELECT 1 FROM workstreams WHERE id = ?').get(`W${n}`)) n++
  return `W${n}`
}

export function deleteWorkstream(id) {
  return tx(() => {
    db.prepare('DELETE FROM workstreams WHERE id = ?').run(id)
  })
}

// ---------- import / export / seed ----------
export function exportPlan() {
  const plan = getPlan()
  return {
    format: 'nexusplan',
    version: 1,
    exportedAt: now(),
    workstreams: plan.workstreams,
    tasks: plan.tasks,
    dependencies: plan.dependencies.map((d) => [d.from, d.to]),
    progressLogs: db.prepare('SELECT * FROM progress_logs ORDER BY id').all().map((r) => ({ ...r })),
  }
}

export function importPlan(data) {
  if (!Array.isArray(data?.workstreams) || !Array.isArray(data?.tasks)) throw new HttpError(400, '檔案格式不正確（缺少 workstreams / tasks）')
  if (db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c > 0) backup('before-import')
  return tx(() => {
    db.exec('DELETE FROM dependencies; DELETE FROM tasks; DELETE FROM workstreams;')
    if (Array.isArray(data.progressLogs)) db.exec('DELETE FROM progress_logs;')
    data.workstreams.forEach((w, i) =>
      db.prepare('INSERT INTO workstreams (id, name, color, sort) VALUES (?, ?, ?, ?)').run(w.id, w.name, w.color || '#3a6fd8', w.sort ?? i + 1)
    )
    data.tasks.forEach((t, i) => insertTask({ ...t, sort: t.sort ?? i + 1 }))
    for (const d of data.dependencies || []) {
      const [from, to] = Array.isArray(d) ? d : [d.from, d.to]
      insertDep(from, to)
    }
    for (const l of data.progressLogs || []) {
      db.prepare(
        `INSERT INTO progress_logs (task_id, task_name, at, from_progress, to_progress, from_status, to_status, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(l.task_id, l.task_name, l.at, l.from_progress, l.to_progress, l.from_status, l.to_status, l.note || '')
    }
    return getPlan()
  })
}

function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM workstreams').get()
  if (c > 0 || !existsSync(SEED_FILE)) return false
  importPlan({ ...JSON.parse(readFileSync(SEED_FILE, 'utf8')), progressLogs: undefined })
  return true
}

// ---------- backup ----------
export function backup(tag = 'auto') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
  const file = join(BACKUP_DIR, `nexusplan-${stamp}-${tag}.db`)
  if (existsSync(file)) return file
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) unlinkSync(join(BACKUP_DIR, f))
  return file
}

export const seeded = seedIfEmpty()
export { DB_FILE }
