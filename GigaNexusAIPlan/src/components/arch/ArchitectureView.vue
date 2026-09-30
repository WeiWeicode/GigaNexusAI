<script setup lang="ts">
// 架構圖頁面:整體架構(專案關係)+ 各子專案(關係 / 內部架構 / 資料庫)
// 資料來源為 architecture/*.json,路由以網址 #/arch/<專案>/<分頁> 表示,可直接分享連結
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { categoryOf, nodeOf, projects, workspace } from '../../arch/data'
import { erDiagram, internalDiagram, LAYER_COLORS, workspaceDiagram, type ColumnMode } from '../../arch/diagrams'
import type { ArchTab, Component, Selection, Table } from '../../arch/types'
import Icon from '../Icon.vue'
import DiagramCanvas from './DiagramCanvas.vue'

const props = defineProps<{ theme: 'light' | 'dark' }>()

// ---------- 路由(hash) ----------
const TABS: { id: ArchTab; name: string; hint: string }[] = [
  { id: 'relations', name: '專案關係', hint: '與其他專案 / 系統的連線' },
  { id: 'internal', name: '內部架構', hint: '模組、分層與請求流向' },
  { id: 'database', name: '資料庫', hint: '資料表、關聯與 Redis 鍵' },
]

function parseHash() {
  const m = /^#\/arch(?:\/([^/?]+))?(?:\/(relations|internal|database))?/.exec(location.hash)
  const id = m?.[1] ? decodeURIComponent(m[1]) : null
  const project = id && nodeOf(id) ? id : null
  const tab = (m?.[2] as ArchTab | undefined) || (project && projects[project] ? 'internal' : 'relations')
  return { project, tab }
}
const route = reactive(parseHash())

function hashOf(project: string | null, tab: ArchTab) {
  return project ? `#/arch/${encodeURIComponent(project)}/${tab}` : '#/arch'
}
watch(
  () => [route.project, route.tab],
  () => {
    const h = hashOf(route.project, route.tab)
    if (location.hash !== h) history.replaceState(null, '', h)
  },
  { immediate: true }
)
function onHash() {
  if (!location.hash.startsWith('#/arch')) return
  const next = parseHash()
  if (next.project !== route.project || next.tab !== route.tab) selected.value = null
  Object.assign(route, next)
}

function openProject(id: string | null, tab?: ArchTab) {
  route.project = id
  route.tab = tab || (id && projects[id] ? 'internal' : 'relations')
  selected.value = null
  mainEl.value?.scrollTo({ top: 0 })
}

const node = computed(() => (route.project ? nodeOf(route.project) : undefined))
const detail = computed(() => (route.project ? projects[route.project] : undefined))
const textColor = computed(() => (props.theme === 'dark' ? '#e8f0ed' : '#10231d'))

// ---------- 篩選狀態 ----------
const wsCats = ref(new Set(workspace.categories.map((c) => c.id)))
const wsRels = ref(new Set(workspace.relationTypes.map((t) => t.id)))
const showPlanned = ref(true)
const wsLabels = ref(false)
const wsGrouped = ref(false)
const layerSel = ref(new Set<string>())
const direction = ref<'LR' | 'TB'>('LR')
const groupSel = ref(new Set<string>())
const colMode = ref<ColumnMode>('keys')
const tableQuery = ref('')
const compQuery = ref('')

watch(
  detail,
  (d) => {
    layerSel.value = new Set(d?.architecture.layers.map((l) => l.id) || [])
    groupSel.value = new Set(d?.database.groups.map((g) => g.id) || [])
    direction.value = d?.architecture.direction || 'LR'
    tableQuery.value = ''
    compQuery.value = ''
  },
  { immediate: true }
)

const filterSets = { cats: wsCats, rels: wsRels, layers: layerSel, groups: groupSel }
function toggle(which: keyof typeof filterSets, id: string, all: string[]) {
  const set = filterSets[which]
  const s = new Set(set.value)
  // 全選時點一下 = 只看這一類;再點其他則加入 / 移除
  if (s.size === all.length) {
    set.value = new Set([id])
    return
  }
  if (s.has(id)) s.delete(id)
  else s.add(id)
  set.value = s.size ? s : new Set(all)
}
const allOf = (arr: { id: string }[]) => arr.map((x) => x.id)

// ---------- 圖 ----------
const diagram = computed(() => {
  if (!route.project || route.tab === 'relations') {
    return workspaceDiagram(workspace, {
      categories: route.project ? new Set(allOf(workspace.categories)) : wsCats.value,
      relationTypes: wsRels.value,
      showPlanned: showPlanned.value,
      focus: route.project || undefined,
      // 單一專案的關係圖線少,一律顯示說明
      labels: !!route.project || wsLabels.value,
      grouped: !route.project && wsGrouped.value,
      textColor: textColor.value,
    })
  }
  const d = detail.value
  if (!d) return null
  if (route.tab === 'internal') return internalDiagram(d, { layers: layerSel.value, showPlanned: showPlanned.value, direction: direction.value, textColor: textColor.value })
  return erDiagram(d, { groups: groupSel.value, showPlanned: showPlanned.value, columns: colMode.value })
})
// ER 圖表很多、各自獨立的群組:以 COFFMAN_GRAHAM 限制每層數量,讓圖接近畫面比例
const diagramConfig = computed(() => (route.project && route.tab === 'database' ? { elk: { layeringStrategy: 'COFFMAN_GRAHAM', layeringLayerBound: 5 } } : undefined))
const diagramName = computed(() => `${route.project || 'workspace'}-${route.project ? route.tab : 'relations'}`)

// ---------- 選取與詳細面板 ----------
const selected = ref<Selection | null>(null)
const selectedId = computed(() => selected.value?.id ?? null)

function onDiagramSelect(id: string) {
  if (!route.project || route.tab === 'relations') selected.value = { kind: 'node', id }
  else if (route.tab === 'internal') selected.value = { kind: 'component', projectId: route.project, id }
  else selected.value = { kind: 'table', projectId: route.project, id }
}

const selNode = computed(() => (selected.value?.kind === 'node' ? nodeOf(selected.value.id) : undefined))
const selComp = computed(() => {
  const s = selected.value
  return s?.kind === 'component' ? projects[s.projectId]?.architecture.components.find((c) => c.id === s.id) : undefined
})
const selTable = computed(() => {
  const s = selected.value
  return s?.kind === 'table' ? projects[s.projectId]?.database.tables.find((t) => t.id === s.id) : undefined
})

const nodeRels = computed(() => {
  const id = selNode.value?.id
  if (!id) return []
  return workspace.relations
    .filter((r) => r.from === id || r.to === id)
    .map((r) => ({ r, out: r.from === id, other: nodeOf(r.from === id ? r.to : r.from)!, type: workspace.relationTypes.find((t) => t.id === r.type) }))
})
const compFlows = computed(() => {
  const c = selComp.value
  const d = detail.value
  if (!c || !d) return []
  const byId = new Map(d.architecture.components.map((x) => [x.id, x]))
  return d.architecture.flows
    .filter((f) => f.from === c.id || f.to === c.id)
    .map((f) => ({ f, out: f.from === c.id, other: byId.get(f.from === c.id ? f.to : f.from)! }))
    .filter((x) => x.other)
})
const tableRels = computed(() => {
  const t = selTable.value
  if (!t || !detail.value) return []
  return detail.value.database.relations.filter((r) => r.from === t.id || r.to === t.id).map((r) => ({ r, out: r.from === t.id, other: r.from === t.id ? r.to : r.from }))
})

/** 選取項目的直接相鄰節點(圖上其餘淡化) */
const near = computed(() => {
  if (selNode.value) return nodeRels.value.map((x) => x.other.id)
  if (selComp.value) return compFlows.value.map((x) => x.other.id)
  if (selTable.value) return tableRels.value.map((x) => x.other)
  return []
})

// ---------- 全域搜尋(分類查詢) ----------
const query = ref('')
const q = computed(() => query.value.trim().toLowerCase())
const has = (...vals: (string | undefined | null)[]) => vals.some((v) => v && v.toLowerCase().includes(q.value))

interface Hit {
  kind: 'node' | 'component' | 'table' | 'column' | 'redis'
  title: string
  sub: string
  go: () => void
}
const results = computed(() => {
  if (!q.value) return []
  const out: { label: string; items: Hit[] }[] = []
  const nodes = workspace.nodes.filter((n) => has(n.id, n.name, n.label, n.summary, ...n.tech, ...n.endpoints))
  if (nodes.length)
    out.push({ label: '專案 / 系統', items: nodes.map((n) => ({ kind: 'node', title: n.name, sub: categoryOf(n.category)?.name || '', go: () => goNode(n.id) })) })
  const comps: Hit[] = []
  const tables: Hit[] = []
  const cols: Hit[] = []
  const keys: Hit[] = []
  for (const p of Object.values(projects)) {
    for (const c of p.architecture.components)
      if (has(c.id, c.name, c.path, c.description)) comps.push({ kind: 'component', title: c.name, sub: `${p.name} · ${c.path || c.layer}`, go: () => goComponent(p.id, c) })
    for (const t of p.database.tables) {
      if (has(t.id, t.description)) tables.push({ kind: 'table', title: t.id, sub: `${p.name} · ${t.description}`, go: () => goTable(p.id, t) })
      for (const c of t.columns)
        if (has(c.name, c.note)) cols.push({ kind: 'column', title: `${t.id}.${c.name}`, sub: `${c.type}${c.note ? ' · ' + c.note : ''}`, go: () => goTable(p.id, t) })
    }
    for (const r of p.database.redisKeys)
      if (has(r.key, r.purpose)) keys.push({ kind: 'redis', title: r.key, sub: `${p.name} · ${r.purpose}`, go: () => goRedis(p.id, r.key) })
  }
  if (comps.length) out.push({ label: '元件 / 模組', items: comps })
  if (tables.length) out.push({ label: '資料表', items: tables })
  if (cols.length) out.push({ label: '欄位', items: cols.slice(0, 40) })
  if (keys.length) out.push({ label: 'Redis 鍵', items: keys })
  return out
})
const resultCount = computed(() => results.value.reduce((s, g) => s + g.items.length, 0))

/** 目前圖上符合搜尋的節點,以外框標示 */
const hits = computed(() => {
  if (!q.value) return []
  if (!route.project || route.tab === 'relations') return workspace.nodes.filter((n) => has(n.id, n.name, n.label, n.summary, ...n.tech)).map((n) => n.id)
  const d = detail.value
  if (!d) return []
  if (route.tab === 'internal') return d.architecture.components.filter((c) => has(c.id, c.name, c.path, c.description)).map((c) => c.id)
  return d.database.tables.filter((t) => has(t.id, t.description) || t.columns.some((c) => has(c.name, c.note))).map((t) => t.id)
})

function goNode(id: string) {
  if (route.project !== id) openProject(id, 'relations')
  else route.tab = 'relations'
  selected.value = { kind: 'node', id }
}
function goComponent(pid: string, c: Component) {
  if (route.project !== pid) openProject(pid, 'internal')
  route.tab = 'internal'
  if (!layerSel.value.has(c.layer)) layerSel.value = new Set([...layerSel.value, c.layer])
  if (c.status === 'planned') showPlanned.value = true
  selected.value = { kind: 'component', projectId: pid, id: c.id }
}
function goTable(pid: string, t: Table) {
  if (route.project !== pid) openProject(pid, 'database')
  route.tab = 'database'
  if (!groupSel.value.has(t.group)) groupSel.value = new Set([...groupSel.value, t.group])
  if (t.status === 'planned') showPlanned.value = true
  selected.value = { kind: 'table', projectId: pid, id: t.id }
}
const redisFocus = ref('')
function goRedis(pid: string, key: string) {
  if (route.project !== pid) openProject(pid, 'database')
  route.tab = 'database'
  redisFocus.value = key
  setTimeout(() => document.getElementById('arch-redis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
}

// ---------- 清單 ----------
const nodesByCat = computed(() =>
  workspace.categories.map((c) => ({ c, nodes: workspace.nodes.filter((n) => n.category === c.id) })).filter((g) => g.nodes.length)
)
const projectRels = computed(() =>
  route.project
    ? workspace.relations
        .filter((r) => r.from === route.project || r.to === route.project)
        .map((r) => ({ r, out: r.from === route.project, other: nodeOf(r.from === route.project ? r.to : r.from)!, type: workspace.relationTypes.find((t) => t.id === r.type) }))
    : []
)
const compRows = computed(() => {
  const d = detail.value
  if (!d) return []
  const cq = compQuery.value.trim().toLowerCase()
  return d.architecture.layers
    .map((l, i) => ({
      l,
      color: LAYER_COLORS[i % LAYER_COLORS.length],
      comps: d.architecture.components.filter(
        (c) => c.layer === l.id && (!cq || [c.id, c.name, c.path, c.description].some((v) => v?.toLowerCase().includes(cq)))
      ),
    }))
    .filter((g) => g.comps.length && layerSel.value.has(g.l.id))
})
const tableRows = computed(() => {
  const d = detail.value
  if (!d) return []
  const tq = tableQuery.value.trim().toLowerCase()
  return d.database.tables.filter(
    (t) =>
      groupSel.value.has(t.group) &&
      (showPlanned.value || t.status !== 'planned') &&
      (!tq || t.id.toLowerCase().includes(tq) || t.description.toLowerCase().includes(tq) || t.columns.some((c) => c.name.toLowerCase().includes(tq)))
  )
})
const groupName = (id: string) => detail.value?.database.groups.find((g) => g.id === id)?.name || id
const storeOf = (id: string) => detail.value?.database.stores.find((s) => s.id === id)
const layerName = (id: string) => detail.value?.architecture.layers.find((l) => l.id === id)?.name || id
const tableById = (id: string) => detail.value?.database.tables.find((t) => t.id === id)

const counts = computed(() => ({
  nodes: workspace.nodes.length,
  repos: workspace.nodes.filter((n) => n.kind === 'repo').length,
  detailed: Object.keys(projects).length,
  relations: workspace.relations.length,
}))

// ---------- 版面 ----------
const mainEl = ref<HTMLElement>()
/** 詳細面板與畫布重疊的寬度:面板寬 400,畫布右緣距視窗右緣約 24 */
const PANEL_INSET = 380
const sideOpen = ref(false)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && selected.value) selected.value = null
}
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="arch">
    <!-- 左側:搜尋 + 專案導覽 -->
    <aside class="side" :class="{ open: sideOpen }">
      <div class="search">
        <Icon name="search" />
        <input v-model="query" class="input sm" placeholder="搜尋專案、模組、資料表、欄位…" />
        <button v-if="query" class="clear" title="清除" @click="query = ''"><Icon name="x" :size="14" /></button>
      </div>

      <template v-if="q">
        <div class="res-head subtle">找到 {{ resultCount }} 筆</div>
        <div v-for="g in results" :key="g.label" class="res-group">
          <div class="side-label">{{ g.label }} <span class="subtle">{{ g.items.length }}</span></div>
          <button v-for="(h, i) in g.items" :key="g.label + i" class="res" @click="(h.go(), (sideOpen = false))">
            <span class="res-t">{{ h.title }}</span>
            <span class="res-s">{{ h.sub }}</span>
          </button>
        </div>
        <p v-if="!resultCount" class="muted empty-s">沒有符合「{{ query }}」的項目</p>
      </template>

      <template v-else>
        <button class="nav-item" :class="{ on: !route.project }" @click="(openProject(null), (sideOpen = false))">
          <Icon name="layers" />整體架構
        </button>
        <div v-for="g in nodesByCat" :key="g.c.id" class="nav-group">
          <div class="side-label"><i class="dot" :style="{ background: g.c.color }" />{{ g.c.name }}</div>
          <button
            v-for="n in g.nodes"
            :key="n.id"
            class="nav-item sub"
            :class="{ on: route.project === n.id }"
            :title="n.summary"
            @click="(openProject(n.id), (sideOpen = false))"
          >
            <span class="nav-name">{{ n.name }}</span>
            <span v-if="n.detail" class="badge ok">詳細</span>
            <span v-else-if="n.status === 'planned'" class="badge">規劃</span>
          </button>
        </div>
      </template>
    </aside>

    <!-- 主內容 -->
    <main ref="mainEl" class="content">
      <button class="btn sm side-toggle" @click="sideOpen = !sideOpen"><Icon name="filter" :size="14" />專案 / 搜尋</button>

      <!-- 標題 -->
      <header class="head">
        <div class="crumbs subtle">
          <a href="#/arch" @click.prevent="openProject(null)">整體架構</a>
          <template v-if="node">
            <Icon name="chevronRight" :size="12" />
            <span>{{ categoryOf(node.category)?.name }}</span>
          </template>
        </div>
        <h1>
          <template v-if="node">
            <i class="dot lg" :style="{ background: categoryOf(node.category)?.color }" />{{ node.name }}
            <span class="h-label">{{ node.label }}</span>
            <span v-if="node.status === 'planned'" class="chip">規劃中</span>
          </template>
          <template v-else>{{ workspace.title }}</template>
        </h1>
        <p class="lead">{{ detail?.summary || node?.summary || workspace.summary }}</p>
        <div v-if="!node" class="stats">
          <span><b class="num">{{ counts.repos }}</b> 個 repo</span>
          <span><b class="num">{{ counts.nodes }}</b> 個專案 / 系統</span>
          <span><b class="num">{{ counts.relations }}</b> 條關係</span>
          <span><b class="num">{{ counts.detailed }}</b> 個已建立詳細架構</span>
          <span class="subtle">資料更新 {{ workspace.updated }}</span>
        </div>
        <div v-else-if="node.tech.length" class="tags">
          <span v-for="t in node.tech" :key="t" class="tag">{{ t }}</span>
        </div>
      </header>

      <!-- 子專案分頁 -->
      <nav v-if="node" class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ on: route.tab === t.id }"
          :disabled="t.id !== 'relations' && !detail"
          :title="t.id !== 'relations' && !detail ? '尚未建立詳細架構資料' : t.hint"
          @click="((route.tab = t.id), (selected = null))"
        >
          {{ t.name }}
        </button>
        <span class="grow" />
        <span v-if="detail" class="subtle upd">資料更新 {{ detail.updated }}</span>
      </nav>

      <!-- 篩選列 -->
      <div class="filters">
        <template v-if="!node">
          <span class="f-label">分類</span>
          <button
            v-for="c in workspace.categories"
            :key="c.id"
            class="fchip"
            :class="{ on: wsCats.has(c.id) }"
            :style="{ '--chip': c.color }"
            :title="c.description"
            @click="toggle('cats', c.id, allOf(workspace.categories))"
          >
            <i class="dot" />{{ c.name }}
          </button>
        </template>
        <template v-if="!node || route.tab === 'relations'">
          <span class="f-label">關係</span>
          <button
            v-for="t in workspace.relationTypes"
            :key="t.id"
            class="fchip plain"
            :class="{ on: wsRels.has(t.id) }"
            :title="t.description"
            @click="toggle('rels', t.id, allOf(workspace.relationTypes))"
          >
            <i class="ln" :class="t.style" />{{ t.name }}
          </button>
        </template>
        <template v-else-if="detail && route.tab === 'internal'">
          <span class="f-label">分層</span>
          <button
            v-for="(l, i) in detail.architecture.layers"
            :key="l.id"
            class="fchip"
            :class="{ on: layerSel.has(l.id) }"
            :style="{ '--chip': LAYER_COLORS[i % LAYER_COLORS.length] }"
            :title="l.description"
            @click="toggle('layers', l.id, allOf(detail.architecture.layers))"
          >
            <i class="dot" />{{ l.name }}
          </button>
          <div class="seg">
            <button :class="{ on: direction === 'LR' }" @click="direction = 'LR'">橫向</button>
            <button :class="{ on: direction === 'TB' }" @click="direction = 'TB'">直向</button>
          </div>
        </template>
        <template v-else-if="detail && route.tab === 'database'">
          <span class="f-label">分類</span>
          <button
            v-for="g in detail.database.groups"
            :key="g.id"
            class="fchip plain"
            :class="{ on: groupSel.has(g.id) }"
            :title="g.description"
            @click="toggle('groups', g.id, allOf(detail.database.groups))"
          >
            {{ g.name }}
          </button>
          <div class="seg" title="圖上顯示的欄位">
            <button :class="{ on: colMode === 'none' }" @click="colMode = 'none'">只有表名</button>
            <button :class="{ on: colMode === 'keys' }" @click="colMode = 'keys'">鍵欄位</button>
            <button :class="{ on: colMode === 'all' }" @click="colMode = 'all'">全部欄位</button>
          </div>
        </template>
        <span class="checks">
          <template v-if="!node">
            <label class="check"><input v-model="wsLabels" type="checkbox" />關係說明</label>
            <label class="check"><input v-model="wsGrouped" type="checkbox" />依分類分組</label>
          </template>
          <label class="check"><input v-model="showPlanned" type="checkbox" />顯示規劃中</label>
        </span>
      </div>

      <!-- 圖 -->
      <DiagramCanvas
        v-if="diagram"
        class="diagram"
        :code="diagram.code"
        :ids="diagram.ids"
        :theme="props.theme"
        :selected="selectedId"
        :hits="hits"
        :near="near"
        :config="diagramConfig"
        :inset="selected ? PANEL_INSET : 0"
        :name="diagramName"
        @select="onDiagramSelect"
      />
      <div v-else class="empty">
        <b>「{{ node?.name }}」尚未建立詳細架構資料</b>
        <p class="muted">
          新增 <code>GigaNexusAIPlan/architecture/projects/{{ node?.id }}.json</code>,並在 <code>workspace.json</code> 的節點填入
          <code>"detail"</code>;格式見 <code>architecture/README.md</code>。
        </p>
      </div>

      <!-- 圖例 -->
      <div class="legend subtle">
        <template v-if="!node || route.tab === 'relations'">
          <span><i class="sh round" />repo</span><span><i class="sh rect" />服務</span><span><i class="sh cyl" />資料庫</span><span><i class="sh hex" />外部系統</span>
        </template>
        <template v-else-if="route.tab === 'internal'">
          <span><i class="sh stadium" />呼叫端</span><span><i class="sh rect" />API / 設定</span><span><i class="sh round" />模組</span><span><i class="sh sub" />Worker</span><span><i class="sh para" />共用套件</span><span><i class="sh cyl" />資料庫</span>
        </template>
        <template v-else>
          <span><i class="ln solid" />外鍵(FK)</span><span><i class="ln dotted" />邏輯關聯 / 同步 / 規劃</span><span>PK 主鍵 · FK 外鍵 · UK 唯一</span>
        </template>
        <span><i class="sh dashed" />規劃中(虛線)</span>
      </div>

      <!-- ===== 清單:整體架構 ===== -->
      <section v-if="!node" class="block">
        <h2>專案一覽</h2>
        <div v-for="g in nodesByCat" :key="g.c.id" class="cat">
          <h3><i class="dot" :style="{ background: g.c.color }" />{{ g.c.name }} <span class="subtle">{{ g.c.description }}</span></h3>
          <div class="cards">
            <button v-for="n in g.nodes" :key="n.id" class="card" :class="{ planned: n.status === 'planned' }" @click="openProject(n.id)">
              <div class="card-h">
                <b>{{ n.name }}</b>
                <span v-if="n.detail" class="badge ok">詳細架構</span>
                <span v-else-if="n.status === 'planned'" class="badge">規劃中</span>
              </div>
              <div class="card-l muted">{{ n.label }}</div>
              <p>{{ n.summary }}</p>
              <div class="tags">
                <span v-for="t in n.tech.slice(0, 4)" :key="t" class="tag">{{ t }}</span>
              </div>
            </button>
          </div>
        </div>
      </section>

      <!-- ===== 清單:專案關係 ===== -->
      <section v-else-if="route.tab === 'relations'" class="block">
        <h2>關係清單 <span class="subtle">{{ projectRels.length }}</span></h2>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr><th>方向</th><th>對象</th><th>類型</th><th>說明</th><th>狀態</th></tr>
            </thead>
            <tbody>
              <tr v-for="(x, i) in projectRels" :key="i">
                <td>{{ x.out ? '→ 呼叫 / 提供' : '← 被使用' }}</td>
                <td>
                  <a href="#" @click.prevent="openProject(x.other.id, 'relations')">{{ x.other.name }}</a>
                </td>
                <td><i class="ln" :class="x.type?.style" />{{ x.type?.name }}</td>
                <td>{{ x.r.label }}</td>
                <td><span class="chip" :class="x.r.status === 'planned' ? '' : 'done'">{{ x.r.status === 'planned' ? '規劃中' : '使用中' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="node.endpoints.length || node.docs.length" class="two">
          <div v-if="node.endpoints.length">
            <h3>對外入口</h3>
            <ul class="plain-list">
              <li v-for="e in node.endpoints" :key="e"><code>{{ e }}</code></li>
            </ul>
          </div>
          <div v-if="node.docs.length">
            <h3>文件(工作區相對路徑)</h3>
            <ul class="plain-list">
              <li v-for="d in node.docs" :key="d"><code>{{ d }}</code></li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ===== 清單:內部架構 ===== -->
      <section v-else-if="detail && route.tab === 'internal'" class="block">
        <div class="block-h">
          <h2>元件清單</h2>
          <input v-model="compQuery" class="input sm narrow" placeholder="篩選元件、路徑…" />
        </div>
        <div v-for="g in compRows" :key="g.l.id" class="layer">
          <h3><i class="dot" :style="{ background: g.color }" />{{ g.l.name }} <span class="subtle">{{ g.l.description }}</span></h3>
          <div class="tbl-wrap">
            <table class="tbl">
              <tbody>
                <tr
                  v-for="c in g.comps"
                  :key="c.id"
                  class="row-click"
                  :class="{ sel: selectedId === c.id, planned: c.status === 'planned' }"
                  @click="goComponent(detail.id, c)"
                >
                  <td class="w-name"><b>{{ c.name }}</b><span v-if="c.status === 'planned'" class="badge">規劃</span></td>
                  <td class="w-path"><code v-if="c.path">{{ c.path }}</code></td>
                  <td>{{ c.description }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p class="subtle src">資料依據:{{ detail.sources.join('、') }}</p>
      </section>

      <!-- ===== 清單:資料庫 ===== -->
      <section v-else-if="detail && route.tab === 'database'" class="block">
        <div class="stores">
          <div v-for="s in detail.database.stores" :key="s.id" class="store">
            <b>{{ s.name }}</b>
            <span class="muted">{{ s.engine }} · {{ s.access }}</span>
            <span class="subtle">{{ s.description }}</span>
          </div>
        </div>
        <ul class="notes">
          <li v-for="n in detail.database.notes" :key="n">{{ n }}</li>
        </ul>

        <div class="block-h">
          <h2>資料表 <span class="subtle">{{ tableRows.length }}</span></h2>
          <input v-model="tableQuery" class="input sm narrow" placeholder="篩選表名、欄位…" />
        </div>
        <div class="tcards">
          <div
            v-for="t in tableRows"
            :key="t.id"
            class="tcard"
            :class="{ sel: selectedId === t.id, planned: t.status === 'planned' }"
            @click="selected = { kind: 'table', projectId: detail.id, id: t.id }"
          >
            <div class="tcard-h">
              <b>{{ t.id }}</b>
              <span v-if="t.status === 'planned'" class="badge">規劃</span>
              <span class="grow" />
              <span class="subtle">{{ groupName(t.group) }}</span>
            </div>
            <p class="muted">{{ t.description }}</p>
            <table class="cols">
              <tbody>
                <tr v-for="c in t.columns" :key="c.name" :class="{ planned: c.status === 'planned', hit: !!tableQuery && c.name.toLowerCase().includes(tableQuery.trim().toLowerCase()) }">
                  <td class="k">{{ c.key || '' }}</td>
                  <td class="n">{{ c.name }}</td>
                  <td class="t">{{ c.type }}</td>
                </tr>
                <tr v-if="t.audit" class="audit">
                  <td class="k" />
                  <td class="n" colspan="2">★ 共通欄位(created/updated_at/by、row_ver)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <h2 id="arch-redis">Redis 鍵 <span class="subtle">{{ detail.database.redisKeys.length }}</span></h2>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr><th>鍵</th><th>型別</th><th>TTL</th><th>用途</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in detail.database.redisKeys" :key="r.key" :class="{ sel: redisFocus === r.key }">
                <td><code>{{ r.key }}</code></td>
                <td>{{ r.type }}</td>
                <td>{{ r.ttl }}</td>
                <td>{{ r.purpose }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="subtle src">資料依據:{{ detail.sources.join('、') }}</p>
      </section>
    </main>

    <!-- 右側詳細面板 -->
    <Transition name="slide">
      <aside v-if="selected && (selNode || selComp || selTable)" class="panel">
        <button class="btn ghost icon close" title="關閉 (Esc)" @click="selected = null"><Icon name="x" /></button>

        <template v-if="selNode">
          <div class="p-kicker"><i class="dot" :style="{ background: categoryOf(selNode.category)?.color }" />{{ categoryOf(selNode.category)?.name }}</div>
          <h3>{{ selNode.name }}</h3>
          <div class="muted">{{ selNode.label }}<span v-if="selNode.status === 'planned'"> · 規劃中</span></div>
          <p>{{ selNode.summary }}</p>
          <div v-if="selNode.tech.length" class="tags"><span v-for="t in selNode.tech" :key="t" class="tag">{{ t }}</span></div>
          <button v-if="route.project !== selNode.id || route.tab !== (selNode.detail ? 'internal' : 'relations')" class="btn primary sm open" @click="openProject(selNode.id)">
            開啟專案頁<Icon name="chevronRight" :size="14" />
          </button>
          <h4 v-if="selNode.endpoints.length">對外入口</h4>
          <ul class="plain-list"><li v-for="e in selNode.endpoints" :key="e"><code>{{ e }}</code></li></ul>
          <h4>關係 <span class="subtle">{{ nodeRels.length }}</span></h4>
          <ul class="links">
            <li v-for="(x, i) in nodeRels" :key="i">
              <span class="dir">{{ x.out ? '→' : '←' }}</span>
              <a href="#" @click.prevent="selected = { kind: 'node', id: x.other.id }">{{ x.other.name }}</a>
              <span class="subtle">{{ x.type?.name }}{{ x.r.status === 'planned' ? ' · 規劃' : '' }}</span>
              <div class="l-desc">{{ x.r.label }}</div>
            </li>
          </ul>
          <h4 v-if="selNode.docs.length">文件</h4>
          <ul class="plain-list"><li v-for="d in selNode.docs" :key="d"><code>{{ d }}</code></li></ul>
        </template>

        <template v-else-if="selComp">
          <div class="p-kicker">{{ layerName(selComp.layer) }} · {{ selComp.type }}</div>
          <h3>{{ selComp.name }}</h3>
          <div v-if="selComp.status === 'planned'" class="chip">規劃中</div>
          <p v-if="selComp.path"><code>{{ selComp.path }}</code></p>
          <p>{{ selComp.description }}</p>
          <h4>連線 <span class="subtle">{{ compFlows.length }}</span></h4>
          <ul class="links">
            <li v-for="(x, i) in compFlows" :key="i">
              <span class="dir">{{ x.out ? '→' : '←' }}</span>
              <a href="#" @click.prevent="selected = { kind: 'component', projectId: detail!.id, id: x.other.id }">{{ x.other.name }}</a>
              <span class="subtle">{{ x.f.status === 'planned' ? '規劃' : '' }}</span>
              <div v-if="x.f.label" class="l-desc">{{ x.f.label }}</div>
            </li>
          </ul>
        </template>

        <template v-else-if="selTable">
          <div class="p-kicker">{{ storeOf(selTable.store)?.name }} · {{ groupName(selTable.group) }}</div>
          <h3>{{ selTable.id }}</h3>
          <div v-if="selTable.status === 'planned'" class="chip">規劃中(尚未 migration)</div>
          <p>{{ selTable.description }}</p>
          <table class="cols full">
            <thead>
              <tr><th>鍵</th><th>欄位</th><th>型別</th></tr>
            </thead>
            <tbody>
              <template v-for="c in selTable.columns" :key="c.name">
                <tr :class="{ planned: c.status === 'planned' }">
                  <td class="k">{{ c.key || '' }}</td>
                  <td class="n">{{ c.name }}<span v-if="c.status === 'planned'" class="badge">規劃</span></td>
                  <td class="t">{{ c.type }}</td>
                </tr>
                <tr v-if="c.note" class="note-row">
                  <td />
                  <td colspan="2">{{ c.note }}</td>
                </tr>
              </template>
              <template v-if="selTable.audit">
                <tr v-for="c in detail?.database.commonColumns" :key="'a' + c.name" class="audit">
                  <td class="k">★</td>
                  <td class="n">{{ c.name }}</td>
                  <td class="t">{{ c.type }}</td>
                </tr>
              </template>
            </tbody>
          </table>
          <h4>關聯 <span class="subtle">{{ tableRels.length }}</span></h4>
          <ul class="links">
            <li v-for="(x, i) in tableRels" :key="i">
              <span class="dir">{{ x.out ? '→' : '←' }}</span>
              <a href="#" @click.prevent="tableById(x.other) && goTable(detail!.id, tableById(x.other)!)">{{ x.other }}</a>
              <span class="subtle">{{ x.r.card }}{{ x.r.fk === false ? ' · 邏輯' : '' }}{{ x.r.status === 'planned' ? ' · 規劃' : '' }}</span>
              <div class="l-desc">{{ x.r.label }}<template v-if="x.r.column"> · <code>{{ x.r.column }}</code></template></div>
            </li>
          </ul>
        </template>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.arch {
  position: relative;
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--c-bg);
}

/* ---- 左側 ---- */
.side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px 24px;
  overflow-y: auto;
  border-right: 1px solid var(--c-border);
  background: var(--c-surface);
}
.search {
  position: relative;
  margin-bottom: 8px;
}
.search > svg {
  position: absolute;
  left: 9px;
  top: 8px;
  color: var(--c-text-subtle);
}
.search .input {
  padding-left: 30px;
  padding-right: 28px;
}
.clear {
  position: absolute;
  right: 4px;
  top: 4px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--c-text-subtle);
  cursor: pointer;
}
.side-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--c-text-muted);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--c-r-sm);
  background: none;
  color: var(--c-text);
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}
.nav-item.sub {
  padding-left: 22px;
}
.nav-item:hover {
  background: var(--c-surface-3);
}
.nav-item.on {
  background: var(--c-brand-50);
  color: var(--c-brand-700);
  font-weight: 600;
}
[data-theme='dark'] .nav-item.on {
  color: var(--c-brand-400);
}
.nav-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.res-head {
  margin: 0 8px;
  font-size: 12px;
}
.res {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--c-r-sm);
  background: none;
  text-align: left;
  cursor: pointer;
}
.res:hover {
  background: var(--c-surface-3);
}
.res-t {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
  word-break: break-all;
}
.res-s {
  font-size: 11px;
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-s {
  padding: 8px;
  font-size: 13px;
}

/* ---- 共用小元件 ---- */
.dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--chip, var(--c-text-subtle));
}
.dot.lg {
  width: 12px;
  height: 12px;
  margin-right: 10px;
  vertical-align: 2px;
}
.badge {
  flex: none;
  padding: 1px 6px;
  border-radius: var(--c-r-full);
  font-size: 10.5px;
  font-weight: 600;
  background: var(--c-surface-3);
  color: var(--c-text-muted);
}
.badge.ok {
  background: var(--c-brand-50);
  color: var(--c-brand-600);
}
[data-theme='dark'] .badge.ok {
  color: var(--c-brand-400);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  padding: 1px 7px;
  border-radius: var(--c-r-xs);
  font-size: 11.5px;
  background: var(--c-surface-3);
  color: var(--c-text-muted);
}
code {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 0.92em;
  word-break: break-all;
}
.grow {
  flex: 1;
}

/* ---- 主內容 ---- */
.content {
  min-width: 0;
  overflow-y: auto;
  padding: 18px 24px 48px;
}
.side-toggle {
  display: none;
}
.head h1 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 4px 0 6px;
  font-size: 22px;
  line-height: 1.3;
}
.h-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--c-text-muted);
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.crumbs a {
  color: inherit;
}
.lead {
  max-width: 980px;
  margin: 0 0 10px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: var(--c-text-muted);
}
.stats b {
  color: var(--c-text);
  font-size: 16px;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 14px 0 0;
  border-bottom: 1px solid var(--c-border);
}
.tabs button {
  padding: 8px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--c-text-muted);
  font-weight: 600;
  cursor: pointer;
}
.tabs button.on {
  color: var(--c-text);
  border-bottom-color: var(--c-brand-500);
}
.tabs button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.upd {
  font-size: 12px;
}
.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 10px;
}
.f-label {
  font-size: 12px;
  color: var(--c-text-subtle);
  margin-right: 2px;
}
.f-label:not(:first-child) {
  margin-left: 10px;
}
.fchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-full);
  background: var(--c-surface);
  color: var(--c-text-muted);
  font-size: 12.5px;
  cursor: pointer;
  opacity: 0.55;
}
.fchip.on {
  opacity: 1;
  color: var(--c-text);
  border-color: var(--chip, var(--c-border-strong));
  background: color-mix(in srgb, var(--chip, var(--c-text-subtle)) 10%, var(--c-surface));
}
.fchip.plain.on {
  border-color: var(--c-border-strong);
  background: var(--c-surface-3);
}
.ln {
  display: inline-block;
  width: 18px;
  height: 0;
  margin-right: 6px;
  vertical-align: middle;
  border-top: 2px solid var(--c-text-muted);
}
.ln.thick {
  border-top-width: 4px;
}
.ln.dotted {
  border-top-style: dashed;
}
.seg {
  display: inline-flex;
  margin-left: 8px;
  padding: 3px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
}
.seg button {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.seg button.on {
  background: var(--c-surface);
  color: var(--c-text);
  font-weight: 600;
  box-shadow: var(--c-shadow-xs);
}
.checks {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-left: auto;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--c-text-muted);
  cursor: pointer;
}
.diagram {
  height: max(420px, calc(100vh - 290px));
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 240px;
  padding: 24px;
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--c-r-md);
  text-align: center;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 8px 2px 0;
  font-size: 12px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sh {
  display: inline-block;
  width: 18px;
  height: 11px;
  border: 1.5px solid var(--c-text-muted);
}
.sh.round {
  border-radius: 4px;
}
.sh.stadium {
  border-radius: 6px;
}
.sh.cyl {
  border-radius: 50% / 30%;
}
.sh.hex {
  clip-path: polygon(20% 0, 80% 0, 100% 50%, 80% 100%, 20% 100%, 0 50%);
  background: var(--c-text-muted);
  border: 0;
}
.sh.para {
  transform: skewX(-18deg);
}
.sh.sub {
  border-left-width: 4px;
  border-right-width: 4px;
}
.sh.dashed {
  border-style: dashed;
}

/* ---- 清單區 ---- */
.block {
  margin-top: 26px;
}
.block h2 {
  margin: 22px 0 10px;
  font-size: 16px;
}
.block h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 16px 0 8px;
  font-size: 14px;
}
.block h3 .subtle {
  font-weight: 400;
  font-size: 12px;
}
.block-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.narrow {
  width: 220px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  color: var(--c-text);
  text-align: left;
  cursor: pointer;
  transition: box-shadow var(--c-dur) var(--c-ease), border-color var(--c-dur) var(--c-ease);
}
.card:hover {
  border-color: var(--c-border-strong);
  box-shadow: var(--c-shadow-md);
}
.card.planned {
  border-style: dashed;
}
.card-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-l {
  font-size: 12px;
}
.card p {
  margin: 4px 0 6px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--c-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tbl-wrap {
  overflow-x: auto;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th,
.tbl td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--c-border);
  text-align: left;
  vertical-align: top;
}
.tbl th {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  white-space: nowrap;
}
.tbl tr:last-child td {
  border-bottom: 0;
}
.tbl .w-name {
  width: 200px;
  white-space: nowrap;
}
.tbl .w-name .badge {
  margin-left: 6px;
}
.tbl .w-path {
  width: 280px;
  color: var(--c-text-muted);
}
.row-click {
  cursor: pointer;
}
.row-click:hover td {
  background: var(--g-row-hover);
}
tr.sel td {
  background: var(--g-row-selected) !important;
}
tr.planned td {
  color: var(--c-text-muted);
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.plain-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.8;
}
.src {
  margin-top: 14px;
  font-size: 12px;
}
.stores {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.store {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  font-size: 12.5px;
}
.store b {
  font-size: 13.5px;
}
.notes {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--c-text-muted);
}
.tcards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
  align-items: start;
}
.tcard {
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  cursor: pointer;
}
.tcard:hover {
  border-color: var(--c-border-strong);
}
.tcard.sel {
  border-color: var(--g-today);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-today) 25%, transparent);
}
.tcard.planned {
  border-style: dashed;
}
.tcard-h {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
}
.tcard-h .subtle {
  font-size: 11.5px;
}
.tcard p {
  margin: 4px 0 8px;
  font-size: 12px;
  line-height: 1.5;
}
.cols {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.cols td,
.cols th {
  padding: 2px 4px;
  border-top: 1px solid var(--c-border);
  vertical-align: top;
}
.cols th {
  text-align: left;
  font-family: var(--c-font);
  font-weight: 600;
  color: var(--c-text-muted);
}
.cols .k {
  width: 44px;
  color: var(--c-warning);
  font-weight: 700;
  font-size: 10.5px;
}
.cols .t {
  color: var(--c-text-muted);
  text-align: right;
  white-space: nowrap;
}
.cols tr.planned td {
  color: var(--c-text-subtle);
  font-style: italic;
}
.cols tr.hit td {
  background: var(--c-warning-soft);
}
.cols tr.audit td {
  color: var(--c-text-subtle);
  font-family: var(--c-font);
}
.cols .note-row td {
  border-top: 0;
  padding-top: 0;
  font-family: var(--c-font);
  color: var(--c-text-subtle);
  font-size: 11.5px;
}
.cols .badge {
  margin-left: 6px;
  font-family: var(--c-font);
}

/* ---- 右側詳細面板 ---- */
.panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  width: min(400px, 100%);
  padding: 18px 18px 32px;
  overflow-y: auto;
  background: var(--c-surface);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--c-shadow-lg);
  font-size: 13px;
}
.panel h3 {
  margin: 4px 36px 4px 0;
  font-size: 17px;
  word-break: break-all;
}
.panel h4 {
  margin: 18px 0 6px;
  font-size: 13px;
}
.panel p {
  line-height: 1.6;
}
.close {
  position: absolute;
  top: 10px;
  right: 10px;
}
.p-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.open {
  margin-top: 12px;
}
.links {
  margin: 0;
  padding: 0;
  list-style: none;
}
.links li {
  padding: 6px 0;
  border-bottom: 1px solid var(--c-border);
}
.links .dir {
  display: inline-block;
  width: 18px;
  color: var(--c-text-subtle);
}
.links a {
  font-weight: 600;
  margin-right: 6px;
}
.l-desc {
  margin: 2px 0 0 18px;
  color: var(--c-text-muted);
  font-size: 12px;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s var(--c-ease), opacity 0.2s var(--c-ease);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

@media (max-width: 900px) {
  .arch {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 30;
    width: min(300px, 86vw);
    transform: translateX(-102%);
    transition: transform 0.2s var(--c-ease);
    box-shadow: var(--c-shadow-lg);
  }
  .side.open {
    transform: none;
  }
  .side-toggle {
    display: inline-flex;
    margin-bottom: 8px;
  }
  .content {
    padding: 12px 16px 40px;
  }
  .two {
    grid-template-columns: 1fr;
  }
  .checks {
    margin-left: 0;
  }
  .narrow {
    width: 150px;
  }
  .tbl .w-name,
  .tbl .w-path {
    width: auto;
    white-space: normal;
  }
}
</style>
