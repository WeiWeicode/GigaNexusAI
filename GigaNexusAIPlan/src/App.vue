<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { toPng } from 'html-to-image'
import { usePlan } from './stores/plan'
import { api } from './api'
import { SCALE_LABEL, STATUS_LABEL, type Scale } from './types'
import { duration } from './utils/date'
import { expectedProgress, isDelayed, ownersOf } from './utils/metrics'
import GanttChart from './components/GanttChart.vue'
import TaskDrawer from './components/TaskDrawer.vue'
import ReportSummary from './components/ReportSummary.vue'
import WorkstreamDialog from './components/WorkstreamDialog.vue'
import ConnectDialog from './components/ConnectDialog.vue'
import Icon from './components/Icon.vue'

// 架構圖(含 mermaid)只在報告模式切到「架構圖」時才載入
const ArchitectureView = defineAsyncComponent(() => import('./components/arch/ArchitectureView.vue'))

const store = usePlan()
const gantt = ref<InstanceType<typeof GanttChart>>()
const drawerRef = ref<InstanceType<typeof TaskDrawer>>()
const menuOpen = ref(false)
const showSummary = ref(true)
const fileInput = ref<HTMLInputElement>()

document.documentElement.dataset.theme = store.theme

const owners = computed(() => ownersOf(store.tasks))
const scales: Scale[] = ['day', 'week', 'month', 'quarter']
const allCollapsed = computed(() => store.workstreams.length > 0 && store.workstreams.every((w) => store.collapsed.includes(w.id)))

function toggleAll() {
  const target = !allCollapsed.value
  for (const w of store.workstreams) if (store.collapsed.includes(w.id) !== target) store.toggleCollapse(w.id)
}

// 報告模式分頁:進度(甘特圖 + 摘要)/ 架構圖;網址 #/arch… 直接開啟架構圖
const reportView = ref<'progress' | 'arch'>(location.hash.startsWith('#/arch') ? 'arch' : 'progress')
if (reportView.value === 'arch') store.reportMode = true
const archShown = computed(() => store.reportMode && reportView.value === 'arch')

function setReportView(v: 'progress' | 'arch') {
  reportView.value = v
  if (v === 'progress' && location.hash.startsWith('#/arch')) history.replaceState(null, '', location.pathname + location.search)
}

function toggleReport() {
  store.reportMode = !store.reportMode
  if (store.reportMode) {
    store.drawer = null
    showSummary.value = true
  } else if (location.hash.startsWith('#/arch')) {
    history.replaceState(null, '', location.pathname + location.search)
  }
}

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}

// ---------- 匯出 ----------
const stamp = () => new Date().toISOString().slice(0, 10)

function download(name: string, blob: Blob | string) {
  const a = document.createElement('a')
  a.href = typeof blob === 'string' ? blob : URL.createObjectURL(blob)
  a.download = name
  a.click()
  if (typeof blob !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function exportPng() {
  menuOpen.value = false
  const el = gantt.value?.el
  if (!el) return
  store.toast('正在產生圖片…')
  try {
    const bg = getComputedStyle(document.body).getPropertyValue('--c-surface').trim() || '#fff'
    const url = await toPng(el, { pixelRatio: 1.5, backgroundColor: bg, filter: (n) => !(n as HTMLElement).classList?.contains('no-print') })
    download(`NexusPlan-甘特圖-${stamp()}.png`, url)
  } catch (e) {
    store.toast('產生圖片失敗，請改用較粗的時間刻度（月 / 季）再試：' + (e as Error).message, 'error')
  }
}

function exportPdf() {
  menuOpen.value = false
  setTimeout(() => window.print(), 50)
}

function exportCsv() {
  menuOpen.value = false
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['編號', '工作流', '任務', '類型', '負責人', '開始', '結束', '工期(天)', '進度%', '計畫進度%', '狀態', '延遲', '前置任務', '說明', '卡關原因']
  const lines = [head.map(esc).join(',')]
  for (const r of store.rows) {
    if (r.kind !== 'task') continue
    const t = r.task
    const ws = store.workstreams.find((w) => w.id === t.workstreamId)
    const preds = store.dependencies.filter((d) => d.to === t.id).map((d) => d.from).join(' ')
    lines.push(
      [
        t.id,
        ws?.name,
        t.name,
        t.type === 'milestone' ? '里程碑' : '任務',
        t.owner,
        t.start,
        t.end,
        duration(t.start, t.end),
        t.progress,
        t.type === 'milestone' ? '' : expectedProgress(t, store.today),
        STATUS_LABEL[t.status],
        isDelayed(t, store.today) ? '是' : '',
        preds,
        t.description,
        t.blockedReason,
      ]
        .map(esc)
        .join(',')
    )
  }
  download(`NexusPlan-${stamp()}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
}

async function exportJson() {
  menuOpen.value = false
  const data = await store.run(() => api.exportPlan())
  if (data) download(`nexusplan-${stamp()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
}

function pickImport() {
  menuOpen.value = false
  fileInput.value?.click()
}

async function doImport(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  let data: unknown
  try {
    data = JSON.parse(await f.text())
  } catch {
    store.toast('無法讀取 JSON 檔', 'error')
    return
  }
  if (!confirm(`匯入「${f.name}」會取代目前整份計畫（匯入前會自動備份）。確定匯入？`)) return
  if (await store.run(() => api.importPlan(data))) {
    await store.load()
    store.undoStack = []
    store.redoStack = []
    store.toast('匯入完成', 'success')
  }
}

async function backupNow() {
  menuOpen.value = false
  const r = await store.run(() => api.backup())
  if (r) store.toast('已備份至 ' + r.file, 'success')
}

// ---------- 鍵盤 ----------
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'Escape') {
    if (menuOpen.value) menuOpen.value = false
    else if (store.cascade) store.cascade = null
    else if (store.wsDialog) store.wsDialog = null
    else if (store.connectOpen) store.connectOpen = false
    else if (store.drawer) drawerRef.value?.close()
    else if (store.selectedId) store.selectedId = null
    return
  }
  if (typing) return
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && store.canEdit) {
    e.preventDefault()
    store.undo()
  } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && store.canEdit) {
    e.preventDefault()
    store.redo()
  } else if (!mod && e.key.toLowerCase() === 't') {
    gantt.value?.scrollToToday()
  } else if (!mod && e.key.toLowerCase() === 'r') {
    toggleReport()
  } else if (!mod && e.key.toLowerCase() === 'f' && store.reportMode) {
    fullscreen()
  }
}

// ---------- 同步 ----------
let timer: number | undefined
function onVisible() {
  if (document.visibilityState === 'visible') store.poll()
}
function onDocClick(e: MouseEvent) {
  if (menuOpen.value && !(e.target as HTMLElement).closest('.menu-wrap')) menuOpen.value = false
}

onMounted(async () => {
  await store.load()
  timer = window.setInterval(() => store.poll(), 15000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('keydown', onKey)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="app" :class="{ report: store.reportMode }">
    <!-- 頂部列 -->
    <header class="topbar no-print">
      <div class="brand">
        <div class="logo">
          <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="currentColor" /><rect x="6" y="8" width="14" height="4" rx="2" fill="#fff" /><rect x="10" y="14" width="16" height="4" rx="2" fill="#fff" opacity=".8" /><rect x="8" y="20" width="10" height="4" rx="2" fill="#fff" opacity=".6" /></svg>
        </div>
        <div>
          <div class="b-title">NexusPlan</div>
          <div class="b-sub">GigaNexus AI 平台建置甘特圖</div>
        </div>
      </div>

      <div class="top-actions">
        <span v-if="store.loadError" class="chip blocked" :title="store.loadError">連線中斷</span>
        <button v-if="store.server && !store.server.canEdit" class="chip lock" @click="store.connectOpen = true">
          <Icon name="lock" :size="12" />唯讀 · 輸入 PIN
        </button>
        <button class="btn ghost" title="區網連線資訊" @click="store.connectOpen = true">
          <Icon name="wifi" /><span class="hide-sm">連線</span>
        </button>
        <button class="btn ghost icon" :title="store.theme === 'dark' ? '淺色模式' : '深色模式'" @click="store.setTheme(store.theme === 'dark' ? 'light' : 'dark')">
          <Icon :name="store.theme === 'dark' ? 'sun' : 'moon'" />
        </button>
        <div class="menu-wrap">
          <button class="btn" @click="menuOpen = !menuOpen"><Icon name="download" /><span class="hide-sm">匯出</span></button>
          <div v-if="menuOpen" class="menu">
            <button @click="exportPng"><Icon name="image" />甘特圖 PNG</button>
            <button @click="exportPdf"><Icon name="printer" />列印 / 另存 PDF</button>
            <button @click="exportCsv"><Icon name="table" />任務清單 CSV（Excel）</button>
            <hr />
            <button @click="exportJson"><Icon name="download" />匯出 JSON（完整備份）</button>
            <button :disabled="!store.canEdit" @click="pickImport"><Icon name="upload" />匯入 JSON…</button>
            <button v-if="store.server?.isLocal" @click="backupNow"><Icon name="save" />立即備份資料庫</button>
          </div>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="doImport" />
        </div>
        <div v-if="store.reportMode" class="seg report-seg" role="group" aria-label="報告內容">
          <button :class="{ on: reportView === 'progress' }" @click="setReportView('progress')">進度</button>
          <button :class="{ on: reportView === 'arch' }" @click="setReportView('arch')">架構圖</button>
        </div>
        <button class="btn" :class="{ primary: store.reportMode }" title="報告模式 (R)" @click="toggleReport">
          <Icon :name="store.reportMode ? 'edit' : 'present'" />{{ store.reportMode ? '回到編輯' : '報告模式' }}
        </button>
        <button v-if="store.reportMode" class="btn icon" title="全螢幕 (F)" @click="fullscreen"><Icon name="fullscreen" /></button>
      </div>
    </header>

    <!-- 工具列 -->
    <div v-if="!archShown" class="toolbar no-print">
      <div class="search">
        <Icon name="search" />
        <input v-model="store.search" class="input sm" placeholder="搜尋任務、負責人…" />
      </div>
      <select v-model="store.ownerFilter" class="select sm auto">
        <option value="">全部負責人</option>
        <option v-for="o in owners" :key="o" :value="o">{{ o }}</option>
      </select>
      <select v-model="store.statusFilter" class="select sm auto">
        <option value="">全部狀態</option>
        <option value="delayed">⚠ 延遲</option>
        <option v-for="(l, k) in STATUS_LABEL" :key="k" :value="k">{{ l }}</option>
      </select>
      <button v-if="store.filtersActive" class="btn ghost sm" @click="((store.search = ''), (store.ownerFilter = ''), (store.statusFilter = ''))">清除篩選</button>

      <span class="sep" />

      <div class="seg" role="group" aria-label="時間刻度">
        <button v-for="s in scales" :key="s" :class="{ on: store.scale === s }" @click="store.setScale(s)">{{ SCALE_LABEL[s] }}</button>
      </div>
      <button class="btn" title="捲動到今天 (T)" @click="gantt?.scrollToToday()"><Icon name="today" />今天</button>
      <button class="btn ghost" :title="allCollapsed ? '全部展開' : '全部收合'" @click="toggleAll">
        <Icon :name="allCollapsed ? 'chevronDown' : 'up'" /><span class="hide-sm">{{ allCollapsed ? '展開' : '收合' }}</span>
      </button>

      <span class="spacer" />

      <template v-if="store.canEdit">
        <button class="btn ghost icon" :disabled="!store.undoStack.length" :title="store.undoStack.length ? `復原：${store.undoStack[store.undoStack.length - 1].label} (Ctrl+Z)` : '復原'" @click="store.undo()">
          <Icon name="undo" />
        </button>
        <button class="btn ghost icon" :disabled="!store.redoStack.length" title="重做 (Ctrl+Y)" @click="store.redo()"><Icon name="redo" /></button>
        <button class="btn" @click="store.wsDialog = { ws: null }"><Icon name="layers" /><span class="hide-sm">工作流</span></button>
        <button class="btn primary" @click="store.newTask()"><Icon name="plus" />新增任務</button>
      </template>
      <button v-if="store.reportMode" class="btn ghost sm" @click="showSummary = !showSummary">{{ showSummary ? '隱藏摘要' : '顯示摘要' }}</button>
    </div>

    <!-- 報告摘要 -->
    <ReportSummary v-if="store.reportMode && showSummary && store.loaded && !archShown" />

    <!-- 架構圖(報告模式) -->
    <div v-if="archShown" class="main">
      <ArchitectureView :theme="store.theme" />
    </div>

    <!-- 甘特圖 -->
    <main v-else class="main">
      <div v-if="!store.loaded" class="state">
        <template v-if="store.loadError">
          <b>無法連線至 NexusPlan 服務</b>
          <p class="muted">{{ store.loadError }}</p>
          <button class="btn" @click="store.load()">重試</button>
        </template>
        <template v-else>載入中…</template>
      </div>
      <GanttChart v-else ref="gantt" />
    </main>

    <!-- 連動順延提示 -->
    <Transition name="pop">
      <div v-if="store.cascade" class="cascade no-print">
        <Icon name="alert" />
        <div>
          <b>「{{ store.cascade.rootName }}」的 {{ store.cascade.items.length }} 個後續任務會重疊</b>
          <div class="muted">
            {{ store.cascade.items.slice(0, 3).map((i) => store.byId.get(i.id)?.name).join('、') }}{{ store.cascade.items.length > 3 ? '…' : '' }}
          </div>
        </div>
        <button class="btn primary" @click="store.applyCascade()">一併順延</button>
        <button class="btn" @click="store.cascade = null">略過</button>
      </div>
    </Transition>

    <div class="legend no-print" v-if="!store.reportMode && store.loaded">
      <span><i class="lg bar" />任務（深色＝完成度）</span>
      <span><i class="lg ms" />里程碑</span>
      <span><i class="lg today" />今天</span>
      <span><i class="lg dep bad" />相依衝突</span>
      <span class="subtle hide-sm">拖曳條狀調整日期 · 拖曳邊緣調整工期 · 拖曳下方 ▲ 調整進度 · 拖曳右側 ○ 建立相依 · 雙擊空白處新增</span>
    </div>

    <TaskDrawer ref="drawerRef" />
    <WorkstreamDialog v-if="store.wsDialog" />
    <ConnectDialog v-if="store.connectOpen" />

    <div class="toasts no-print">
      <TransitionGroup name="pop">
        <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.kind">
          <Icon :name="t.kind === 'error' ? 'alert' : 'check'" />{{ t.text }}
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.logo {
  width: 32px;
  height: 32px;
  color: var(--c-brand-500);
  flex: none;
}
.b-title {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.2px;
}
.b-sub {
  font-size: 12px;
  color: var(--c-text-muted);
  white-space: nowrap;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chip.lock {
  border: 0;
  cursor: pointer;
  background: var(--c-warning-soft);
  color: var(--c-warning);
}
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 150;
  display: flex;
  flex-direction: column;
  min-width: 230px;
  padding: 6px;
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  box-shadow: var(--c-shadow-lg);
}
.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--c-r-sm);
  background: none;
  text-align: left;
  cursor: pointer;
}
.menu button:hover:not(:disabled) {
  background: var(--c-surface-3);
}
.menu button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.menu hr {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--c-border);
  margin: 4px 0;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: none;
}
.search {
  position: relative;
  width: 220px;
}
.search svg {
  position: absolute;
  left: 9px;
  top: 8px;
  color: var(--c-text-subtle);
}
.search .input {
  padding-left: 30px;
}
.select.auto {
  width: auto;
}
.sep {
  width: 1px;
  height: 22px;
  background: var(--c-border);
}
.spacer {
  flex: 1;
}
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
}
.seg button {
  min-width: 36px;
  height: 26px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  color: var(--c-text-muted);
  cursor: pointer;
}
.seg button.on {
  background: var(--c-surface);
  color: var(--c-text);
  font-weight: 600;
  box-shadow: var(--c-shadow-xs);
}
.report-seg button {
  padding: 0 10px;
}

.main {
  position: relative;
  flex: 1;
  min-height: 0;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--c-text-muted);
}

.cascade {
  position: fixed;
  left: 50%;
  bottom: 56px;
  z-index: 120;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 32px);
  padding: 12px 14px 12px 16px;
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  border: 1px solid var(--c-warning);
  box-shadow: var(--c-shadow-lg);
  font-size: 13px;
}
.cascade > svg {
  color: var(--c-warning);
  flex: none;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 6px 16px;
  font-size: 12px;
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  border-top: 1px solid var(--c-border);
  flex: none;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg {
  display: inline-block;
}
.lg.bar {
  width: 22px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--c-brand-500) 55%, var(--c-brand-100) 55%);
}
.lg.ms {
  width: 9px;
  height: 9px;
  transform: rotate(45deg);
  border: 2px solid var(--c-brand-500);
}
.lg.today {
  width: 2px;
  height: 12px;
  background: var(--g-today);
}
.lg.dep {
  width: 20px;
  border-top: 2px dashed var(--c-danger);
}

.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(460px, calc(100vw - 32px));
  padding: 10px 14px;
  border-radius: var(--c-r-md);
  background: var(--c-text);
  color: var(--c-surface);
  box-shadow: var(--c-shadow-lg);
  font-size: 13px;
}
.toast.success svg {
  color: var(--c-brand-400);
}
.toast.error {
  background: var(--c-danger);
  color: #fff;
}
.pop-enter-active,
.pop-leave-active {
  transition: all 0.2s var(--c-ease);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.cascade.pop-enter-from,
.cascade.pop-leave-to {
  transform: translate(-50%, 8px);
}

@media (max-width: 760px) {
  .hide-sm {
    display: none;
  }
  .b-sub {
    display: none;
  }
  .search {
    width: 100%;
  }
}

@media print {
  .app {
    height: auto;
  }
  .main {
    overflow: visible;
  }
}
</style>
