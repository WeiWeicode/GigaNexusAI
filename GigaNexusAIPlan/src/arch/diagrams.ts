// 由 architecture/*.json 產生 Mermaid 語法(純函式,不碰 DOM)
// 每個產生器回傳 code 與 ids(Mermaid 節點 ID → 原始 ID),供點擊節點時反查
import type { Component, ProjectDetail, Table, Workspace, WsNode } from './types'

export interface Diagram {
  code: string
  ids: Map<string, string>
}

/** Mermaid 節點 ID 只能用英數與底線 */
const mid = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, '_')}`

/** 引號內標籤:跳脫會破壞語法的字元 */
const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;')

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** 圖層 / 分類配色(半透明底 + 實線框,深淺主題都可讀) */
export const LAYER_COLORS = ['#64748b', '#12a57c', '#2563eb', '#7c3aed', '#0891b2', '#ea580c', '#b45309', '#db2777']

function classDef(name: string, color: string, text: string) {
  return `  classDef ${name} fill:${color}1f,stroke:${color},color:${text},stroke-width:1.5px;`
}

function edge(style: 'solid' | 'thick' | 'dotted', label?: string) {
  const arrow = style === 'thick' ? '==>' : style === 'dotted' ? '-.->' : '-->'
  return label ? `${arrow}|"${esc(short(label, 40))}"|` : arrow
}

function nodeShape(kind: WsNode['kind'] | Component['type'], label: string) {
  const l = `"${label}"`
  switch (kind) {
    case 'datastore':
      return `[(${l})]`
    case 'external':
      return `{{${l}}}`
    case 'repo':
    case 'module':
      return `(${l})`
    case 'worker':
      return `[[${l}]]`
    case 'package':
      return `[/${l}/]`
    case 'client':
      return `([${l}])`
    default:
      return `[${l}]`
  }
}

const PLANNED_CLASS = '  classDef planned stroke-dasharray:5 4,opacity:0.78;'
const FOCUS_CLASS = '  classDef focus stroke-width:3.5px;'

// ---------------- 5-1 專案彼此的關係 ----------------

export interface WorkspaceOpts {
  categories: Set<string>
  relationTypes: Set<string>
  showPlanned: boolean
  /** 只畫此節點與其直接相鄰節點 */
  focus?: string
  /** 線上顯示關係說明(關係多時會讓圖變很寬) */
  labels: boolean
  /** 依分類畫成群組框 */
  grouped: boolean
  textColor: string
}

export function workspaceDiagram(ws: Workspace, o: WorkspaceOpts): Diagram {
  const ids = new Map<string, string>()
  let rels = ws.relations.filter((r) => o.relationTypes.has(r.type) && (o.showPlanned || r.status !== 'planned'))
  let nodes = ws.nodes.filter((n) => o.categories.has(n.category) && (o.showPlanned || n.status !== 'planned'))
  if (o.focus) {
    const near = new Set([o.focus])
    for (const r of rels) if (r.from === o.focus || r.to === o.focus) near.add(r.from).add(r.to)
    nodes = nodes.filter((n) => near.has(n.id) || n.id === o.focus)
    rels = rels.filter((r) => r.from === o.focus || r.to === o.focus)
  }
  const visible = new Set(nodes.map((n) => n.id))
  rels = rels.filter((r) => visible.has(r.from) && visible.has(r.to))

  const lines = ['flowchart LR']
  for (const c of ws.categories) {
    const inCat = nodes.filter((n) => n.category === c.id)
    if (!inCat.length) continue
    if (o.grouped) lines.push(`  subgraph ${mid('cat', c.id)}["${esc(c.name)}"]`, '    direction TB')
    for (const n of inCat) {
      const id = mid('n', n.id)
      ids.set(id, n.id)
      const tag = n.status === 'planned' ? ' · 規劃中' : n.detail ? ' · ✔ 詳細' : ''
      lines.push(`    ${id}${nodeShape(n.kind, `<b>${esc(n.name)}</b><br/><small>${esc(n.label)}${tag}</small>`)}`)
    }
    if (o.grouped) lines.push('  end')
  }
  const typeOf = new Map(ws.relationTypes.map((t) => [t.id, t]))
  const planned: number[] = []
  rels.forEach((r, i) => {
    lines.push(`  ${mid('n', r.from)} ${edge(typeOf.get(r.type)?.style || 'solid', o.labels ? r.label : undefined)} ${mid('n', r.to)}`)
    if (r.status === 'planned') planned.push(i)
  })

  for (const c of ws.categories) lines.push(classDef(mid('c', c.id), c.color, o.textColor))
  lines.push(PLANNED_CLASS, FOCUS_CLASS)
  for (const n of nodes) {
    lines.push(`  class ${mid('n', n.id)} ${mid('c', n.category)};`)
    if (n.status === 'planned') lines.push(`  class ${mid('n', n.id)} planned;`)
  }
  if (o.focus && visible.has(o.focus)) lines.push(`  class ${mid('n', o.focus)} focus;`)
  if (planned.length) lines.push(`  linkStyle ${planned.join(',')} stroke-dasharray:4 4;`)
  return { code: lines.join('\n'), ids }
}

// ---------------- 5-2 專案裡面的架構 ----------------

export interface InternalOpts {
  layers: Set<string>
  showPlanned: boolean
  direction: 'LR' | 'TB'
  textColor: string
}

export function internalDiagram(p: ProjectDetail, o: InternalOpts): Diagram {
  const ids = new Map<string, string>()
  const a = p.architecture
  const comps = a.components.filter((c) => o.layers.has(c.layer) && (o.showPlanned || c.status !== 'planned'))
  const visible = new Set(comps.map((c) => c.id))
  const flows = a.flows.filter((f) => visible.has(f.from) && visible.has(f.to) && (o.showPlanned || f.status !== 'planned'))

  const lines = [`flowchart ${o.direction}`]
  a.layers.forEach((layer) => {
    const inLayer = comps.filter((c) => c.layer === layer.id)
    if (!inLayer.length) return
    lines.push(`  subgraph ${mid('ly', layer.id)}["${esc(layer.name)}"]`, `    direction ${o.direction === 'LR' ? 'TB' : 'LR'}`)
    for (const c of inLayer) {
      const id = mid('c', c.id)
      ids.set(id, c.id)
      const sub = c.path ? `<br/><small>${esc(short(c.path, 34))}</small>` : ''
      lines.push(`    ${id}${nodeShape(c.type, `<b>${esc(c.name)}</b>${sub}`)}`)
    }
    lines.push('  end')
  })
  const planned: number[] = []
  flows.forEach((f, i) => {
    lines.push(`  ${mid('c', f.from)} ${edge(f.status === 'planned' ? 'dotted' : 'solid', f.label)} ${mid('c', f.to)}`)
    if (f.status === 'planned') planned.push(i)
  })
  a.layers.forEach((layer, i) => lines.push(classDef(mid('l', layer.id), LAYER_COLORS[i % LAYER_COLORS.length], o.textColor)))
  lines.push(PLANNED_CLASS)
  for (const c of comps) {
    lines.push(`  class ${mid('c', c.id)} ${mid('l', c.layer)};`)
    if (c.status === 'planned') lines.push(`  class ${mid('c', c.id)} planned;`)
  }
  if (planned.length) lines.push(`  linkStyle ${planned.join(',')} stroke-dasharray:4 4;`)
  return { code: lines.join('\n'), ids }
}

// ---------------- 5-3 資料庫的架構 ----------------

export type ColumnMode = 'none' | 'keys' | 'all'

export interface ErOpts {
  groups: Set<string>
  showPlanned: boolean
  columns: ColumnMode
}

const CARD: Record<string, string> = { '1:N': '||--o{', '1:0..1': '||--o|', '1:1': '||--||', 'N:1': '}o--||' }

/** Mermaid ER 型別只接受英數、底線與括號,其他字元換成底線 */
const erType = (t: string) => t.replace(/[^A-Za-z0-9_()]/g, '_')

function erKeys(key?: string) {
  if (!key) return ''
  const k = key
    .split(',')
    .map((s) => (s.trim() === 'UQ' ? 'UK' : s.trim()))
    .filter((s) => ['PK', 'FK', 'UK'].includes(s))
  return k.length ? ' ' + k.join(', ') : ''
}

export function erDiagram(p: ProjectDetail, o: ErOpts): Diagram {
  const ids = new Map<string, string>()
  const db = p.database
  const tables = db.tables.filter((t) => o.groups.has(t.group) && (o.showPlanned || t.status !== 'planned'))
  const visible = new Set(tables.map((t) => t.id))
  const lines = ['erDiagram']
  for (const t of tables) {
    const id = mid('t', t.id)
    ids.set(id, t.id)
    const alias = t.status === 'planned' ? `${t.id}(規劃)` : t.id
    const cols = columnsFor(t, o.columns)
    if (!cols.length) {
      lines.push(`  ${id}["${esc(alias)}"] {`, '  }')
      continue
    }
    lines.push(`  ${id}["${esc(alias)}"] {`)
    for (const c of cols) lines.push(`    ${erType(c.type)} ${c.name.replace(/[^A-Za-z0-9_]/g, '_')}${erKeys(c.key)}`)
    lines.push('  }')
  }
  for (const r of db.relations) {
    if (!visible.has(r.from) || !visible.has(r.to)) continue
    if (!o.showPlanned && r.status === 'planned') continue
    let card = CARD[r.card] || '||--o{'
    if (r.fk === false || r.status === 'planned') card = card.replace('--', '..')
    lines.push(`  ${mid('t', r.from)} ${card} ${mid('t', r.to)} : "${esc(r.label)}"`)
  }
  return { code: lines.join('\n'), ids }
}

function columnsFor(t: Table, mode: ColumnMode) {
  if (mode === 'none') return []
  if (mode === 'keys') return t.columns.filter((c) => c.key)
  return t.columns
}
