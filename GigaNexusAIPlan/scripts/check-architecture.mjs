// 檢查 architecture/*.json 的參照是否一致(npm run arch:check)
// 修改架構資料後執行;有錯誤時以非 0 結束,方便 AI / CI 判斷
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'architecture')
const errors = []
const read = (f) => {
  try {
    return JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  } catch (e) {
    errors.push(`${f}:JSON 無法解析 — ${e.message}`)
    return null
  }
}
const dup = (file, what, ids) => {
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${file}:${what} ID 重複「${id}」`)
    seen.add(id)
  }
  return seen
}
const STATUS = new Set(['active', 'planned'])

const ws = read('workspace.json')
const detailFiles = readdirSync(join(DIR, 'projects')).filter((f) => f.endsWith('.json'))

if (ws) {
  const cats = dup('workspace.json', '分類', ws.categories.map((c) => c.id))
  const types = dup('workspace.json', '關係類型', ws.relationTypes.map((t) => t.id))
  const nodes = dup('workspace.json', '節點', ws.nodes.map((n) => n.id))
  for (const n of ws.nodes) {
    if (!cats.has(n.category)) errors.push(`workspace.json:節點 ${n.id} 的 category「${n.category}」不存在`)
    if (!STATUS.has(n.status)) errors.push(`workspace.json:節點 ${n.id} 的 status 應為 active / planned`)
    if (n.detail && !detailFiles.includes(n.detail.replace(/^projects\//, ''))) errors.push(`workspace.json:節點 ${n.id} 的 detail「${n.detail}」檔案不存在`)
  }
  for (const r of ws.relations) {
    const tag = `${r.from} → ${r.to}`
    if (!nodes.has(r.from)) errors.push(`workspace.json:關係 ${tag} 的 from 不存在`)
    if (!nodes.has(r.to)) errors.push(`workspace.json:關係 ${tag} 的 to 不存在`)
    if (!types.has(r.type)) errors.push(`workspace.json:關係 ${tag} 的 type「${r.type}」不存在`)
    if (!STATUS.has(r.status)) errors.push(`workspace.json:關係 ${tag} 的 status 應為 active / planned`)
  }
  for (const f of detailFiles) {
    const p = read(join('projects', f))
    if (!p) continue
    const file = `projects/${f}`
    if (`${p.id}.json` !== f) errors.push(`${file}:檔名應為 <id>.json(id = ${p.id})`)
    const node = ws.nodes.find((n) => n.id === p.id)
    if (!node) errors.push(`${file}:workspace.json 沒有節點 ${p.id}`)
    else if (node.detail !== `projects/${f}`) errors.push(`${file}:workspace.json 節點 ${p.id} 的 detail 應為 "projects/${f}"`)

    const a = p.architecture
    const layers = dup(file, '分層', a.layers.map((l) => l.id))
    const comps = dup(file, '元件', a.components.map((c) => c.id))
    for (const c of a.components) {
      if (!layers.has(c.layer)) errors.push(`${file}:元件 ${c.id} 的 layer「${c.layer}」不存在`)
      if (!STATUS.has(c.status)) errors.push(`${file}:元件 ${c.id} 的 status 應為 active / planned`)
    }
    for (const fl of a.flows) {
      if (!comps.has(fl.from)) errors.push(`${file}:流向 ${fl.from} → ${fl.to} 的 from 不存在`)
      if (!comps.has(fl.to)) errors.push(`${file}:流向 ${fl.from} → ${fl.to} 的 to 不存在`)
    }

    const db = p.database
    const stores = dup(file, '資料庫', db.stores.map((s) => s.id))
    const groups = dup(file, '資料表分類', db.groups.map((g) => g.id))
    const tables = dup(file, '資料表', db.tables.map((t) => t.id))
    for (const t of db.tables) {
      if (!stores.has(t.store)) errors.push(`${file}:資料表 ${t.id} 的 store「${t.store}」不存在`)
      if (!groups.has(t.group)) errors.push(`${file}:資料表 ${t.id} 的 group「${t.group}」不存在`)
      dup(file, `${t.id} 欄位`, t.columns.map((c) => c.name))
    }
    for (const r of db.relations) {
      if (!tables.has(r.from)) errors.push(`${file}:關聯 ${r.from} → ${r.to} 的 from 不存在`)
      if (!tables.has(r.to)) errors.push(`${file}:關聯 ${r.from} → ${r.to} 的 to 不存在`)
      if (!['1:N', '1:0..1', '1:1', 'N:1'].includes(r.card)) errors.push(`${file}:關聯 ${r.from} → ${r.to} 的 card「${r.card}」不支援`)
    }
  }
}

// 部署流程(deployment.json):節點、泳道、步驟與專案參照
const dep = read('deployment.json')
if (dep) {
  const file = 'deployment.json'
  const lanes = dup(file, '泳道', dep.lanes.map((l) => l.id))
  const dnodes = dup(file, '節點', dep.nodes.map((n) => n.id))
  dup(file, '步驟', dep.steps.map((s) => String(s.no)))
  for (const n of dep.nodes) if (!lanes.has(n.lane)) errors.push(`${file}:節點 ${n.id} 的 lane「${n.lane}」不存在`)
  for (const e of dep.edges) {
    if (!dnodes.has(e.from) || !dnodes.has(e.to)) errors.push(`${file}:連線 ${e.from} → ${e.to} 的節點不存在`)
    if (!['auto', 'manual', 'sync'].includes(e.mode)) errors.push(`${file}:連線 ${e.from} → ${e.to} 的 mode 應為 auto / manual / sync`)
  }
  for (const s of dep.steps) {
    if (!['dev', 'test', 'prod'].includes(s.env)) errors.push(`${file}:步驟 ${s.no} 的 env 應為 dev / test / prod`)
    for (const id of s.nodes) if (!dnodes.has(id)) errors.push(`${file}:步驟 ${s.no} 的節點「${id}」不存在`)
  }
  const states = new Set(['auto', 'manual', 'pending', 'none', 'hand'])
  for (const p of dep.projects) {
    if (ws && !ws.nodes.some((n) => n.id === p.id)) errors.push(`${file}:專案 ${p.id} 在 workspace.json 沒有節點`)
    if (!states.has(p.test.state) || !states.has(p.prod.state)) errors.push(`${file}:專案 ${p.id} 的 state 不正確`)
  }
}

if (errors.length) {
  console.error(`架構資料有 ${errors.length} 個問題:\n- ` + errors.join('\n- '))
  process.exit(1)
}
console.log(`架構資料檢查通過:workspace.json + ${detailFiles.length} 個專案詳細檔 + deployment.json`)
