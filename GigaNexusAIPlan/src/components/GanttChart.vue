<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { usePlan, type Row } from '../stores/plan'
import type { Scale, Task } from '../types'
import { STATUS_LABEL } from '../types'
import { toDay, fromDay, parts, monthStart, nextMonth, duration, fmtMD, fmtYMD } from '../utils/date'
import { expectedProgress, isViolated } from '../utils/metrics'
import Icon from './Icon.vue'

const store = usePlan()

// ---------- 版面參數 ----------
const PX: Record<Scale, number> = { day: 28, week: 12, month: 3.6, quarter: 1.4 }
const px = computed(() => PX[store.scale])
const rowH = computed(() => (store.reportMode ? 40 : 34))
const narrow = ref(window.innerWidth < 900)
const leftW = computed(() => (narrow.value ? 230 : store.reportMode ? 440 : 400))

const scroller = ref<HTMLElement>()
const inner = ref<HTMLElement>()
const body = ref<HTMLElement>()

// ---------- 時間範圍 ----------
const range = computed(() => {
  const today = toDay(store.today)
  let min = today
  let max = today
  for (const t of store.tasks) {
    min = Math.min(min, toDay(t.start))
    max = Math.max(max, toDay(t.end))
  }
  let start = monthStart(min - 14)
  let end = nextMonth(max + 31) // exclusive
  if (store.scale === 'quarter' || store.scale === 'month') {
    const s = parts(start)
    start = Math.round(Date.UTC(s.y, Math.floor((s.m - 1) / 3) * 3, 1) / 86_400_000)
    const e = parts(end - 1)
    end = Math.round(Date.UTC(e.y, Math.floor((e.m - 1) / 3) * 3 + 3, 1) / 86_400_000)
  }
  return { start, end }
})
const timelineW = computed(() => (range.value.end - range.value.start) * px.value)
const xOfDay = (d: number) => (d - range.value.start) * px.value
const xOf = (s: string) => xOfDay(toDay(s))

// ---------- 刻度 ----------
interface Seg {
  key: string
  x: number
  w: number
  label: string
  weekend?: boolean
  today?: boolean
}

function boundaries(unit: 'day' | 'week' | 'month' | 'quarter' | 'year'): number[] {
  const { start, end } = range.value
  const out = [start]
  let d = start
  if (unit === 'day') for (d = start + 1; d < end; d++) out.push(d)
  else if (unit === 'week') {
    d = start + ((8 - parts(start).wd) % 7 || 7)
    for (; d < end; d += 7) out.push(d)
  } else {
    d = nextMonth(start)
    for (; d < end; d = nextMonth(d)) {
      const m = parts(d).m
      if (unit === 'month' || (unit === 'quarter' && (m - 1) % 3 === 0) || (unit === 'year' && m === 1)) out.push(d)
    }
  }
  out.push(end)
  return out
}

function segs(unit: 'day' | 'week' | 'month' | 'quarter' | 'year', label: (d: number) => string): Seg[] {
  const b = boundaries(unit)
  const today = toDay(store.today)
  const res: Seg[] = []
  for (let i = 0; i < b.length - 1; i++) {
    const d = b[i]
    const wd = parts(d).wd
    res.push({
      key: unit + d,
      x: xOfDay(d),
      w: (b[i + 1] - d) * px.value,
      label: label(d),
      weekend: unit === 'day' && (wd === 0 || wd === 6),
      today: today >= d && today < b[i + 1],
    })
  }
  return res
}

const tiers = computed(() => {
  const ym = (d: number) => `${parts(d).y} 年 ${parts(d).m} 月`
  const y = (d: number) => `${parts(d).y}`
  switch (store.scale) {
    case 'day':
      return { top: segs('month', ym), bottom: segs('day', (d) => String(parts(d).d)) }
    case 'week':
      return { top: segs('month', ym), bottom: segs('week', (d) => `${parts(d).m}/${parts(d).d}`) }
    case 'month':
      return { top: segs('year', y), bottom: segs('month', (d) => `${parts(d).m}月`) }
    default:
      return { top: segs('year', y), bottom: segs('quarter', (d) => `Q${Math.floor((parts(d).m - 1) / 3) + 1}`) }
  }
})
const weekends = computed(() => (store.scale === 'day' ? tiers.value.bottom.filter((s) => s.weekend) : []))
const todayX = computed(() => xOf(store.today) + px.value / 2)

// ---------- 列與甘特條 ----------
const rows = computed(() => store.rows)
const rowIndex = computed(() => {
  const m = new Map<string, number>()
  rows.value.forEach((r, i) => m.set(r.key, i))
  return m
})
const bodyH = computed(() => rows.value.length * rowH.value)

const preview = reactive<Record<string, { start: string; end: string; progress: number }>>({})
const eff = (t: Task): Task => (preview[t.id] ? { ...t, ...preview[t.id] } : t)

function barGeom(t: Task) {
  const e = eff(t)
  if (e.type === 'milestone') {
    const cx = xOf(e.end) + px.value / 2
    return { left: cx, right: cx, width: 0, cx }
  }
  const left = xOf(e.start)
  const width = Math.max(duration(e.start, e.end) * px.value, 3)
  return { left, right: left + width, width, cx: left + width / 2 }
}

function barStyle(t: Task) {
  const g = barGeom(t)
  return { left: g.left + 'px', width: g.width + 'px' }
}

const wsColor = (id: string) => store.workstreams.find((w) => w.id === id)?.color || '#3a6fd8'

// ---------- 相依箭頭 ----------
const depPaths = computed(() => {
  const byId = store.byId
  const out: { id: number; d: string; bad: boolean; active: boolean }[] = []
  const h = rowH.value
  for (const dep of store.dependencies) {
    const iF = rowIndex.value.get(dep.from)
    const iT = rowIndex.value.get(dep.to)
    const F = byId.get(dep.from)
    const T = byId.get(dep.to)
    if (iF == null || iT == null || !F || !T) continue
    const gF = barGeom(F)
    const gT = barGeom(T)
    const x1 = F.type === 'milestone' ? gF.cx + 7 : gF.right
    const x2 = T.type === 'milestone' ? gT.cx - 7 : gT.left
    const y1 = iF * h + h / 2
    const y2 = iT * h + h / 2
    let d: string
    if (x2 - x1 >= 14) {
      d = `M${x1},${y1} H${x1 + 6} V${y2} H${x2 - 1}`
    } else {
      const ym = y2 + (y2 > y1 ? -h / 2 : h / 2)
      d = `M${x1},${y1} H${x1 + 6} V${ym} H${x2 - 10} V${y2} H${x2 - 1}`
    }
    const effMap = new Map([
      [F.id, eff(F)],
      [T.id, eff(T)],
    ])
    out.push({
      id: dep.id,
      d,
      bad: isViolated(dep, effMap),
      active: store.selectedId === dep.from || store.selectedId === dep.to,
    })
  }
  return out
})

// ---------- 拖曳 ----------
type Mode = 'move' | 'left' | 'right' | 'progress'
let drag: null | { id: string; mode: Mode; x0: number; start: string; end: string; progress: number; width: number; moved: boolean } = null
const linkDrag = ref<null | { from: string; x1: number; y1: number; x2: number; y2: number; target: string | null }>(null)
const dragging = ref(false)

function onBarDown(e: PointerEvent, t: Task, mode: Mode) {
  if (e.button !== 0) return
  e.stopPropagation()
  if (!store.canEdit) {
    store.openTask(t.id)
    return
  }
  if (t.type === 'milestone' && mode !== 'move') mode = 'move'
  drag = { id: t.id, mode, x0: e.clientX, start: t.start, end: t.end, progress: t.progress, width: barGeom(t).width, moved: false }
  store.interacting = true
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onMove(e: PointerEvent) {
  if (!drag) return
  const dx = e.clientX - drag.x0
  if (!drag.moved && Math.abs(dx) < 3) return
  drag.moved = true
  dragging.value = true
  hideTip()
  const days = Math.round(dx / px.value)
  let { start, end, progress } = drag
  if (drag.mode === 'move') {
    start = fromDay(toDay(drag.start) + days)
    end = fromDay(toDay(drag.end) + days)
  } else if (drag.mode === 'left') {
    start = fromDay(Math.min(toDay(drag.start) + days, toDay(drag.end)))
  } else if (drag.mode === 'right') {
    end = fromDay(Math.max(toDay(drag.end) + days, toDay(drag.start)))
  } else {
    progress = Math.max(0, Math.min(100, Math.round((drag.progress + (dx / Math.max(drag.width, 1)) * 100) / 5) * 5))
  }
  preview[drag.id] = { start, end, progress }
}

async function onUp() {
  window.removeEventListener('pointermove', onMove)
  const d = drag
  drag = null
  dragging.value = false
  if (!d) return
  const p = preview[d.id]
  if (!d.moved || !p) {
    delete preview[d.id]
    store.interacting = false
    store.openTask(d.id)
    return
  }
  const t = store.byId.get(d.id)!
  const changes: Partial<Task> = {}
  if (p.start !== t.start) changes.start = p.start
  if (p.end !== t.end) changes.end = p.end
  if (p.progress !== t.progress) changes.progress = p.progress
  if (Object.keys(changes).length) {
    const label = d.mode === 'progress' ? `更新「${t.name}」進度 ${p.progress}%` : `調整「${t.name}」日期`
    await store.updateTask(d.id, changes, { label })
    if (changes.start || changes.end) store.checkCascade(d.id)
  }
  delete preview[d.id]
  store.interacting = false
}

function localPoint(e: PointerEvent) {
  const r = body.value!.getBoundingClientRect()
  return { x: e.clientX - r.left - leftW.value, y: e.clientY - r.top }
}

function onLinkDown(e: PointerEvent, t: Task) {
  if (e.button !== 0 || !store.canEdit) return
  e.stopPropagation()
  e.preventDefault()
  const g = barGeom(t)
  const i = rowIndex.value.get(t.id)!
  const x1 = t.type === 'milestone' ? g.cx + 7 : g.right
  const y1 = i * rowH.value + rowH.value / 2
  linkDrag.value = { from: t.id, x1, y1, x2: x1, y2: y1, target: null }
  store.interacting = true
  window.addEventListener('pointermove', onLinkMove)
  window.addEventListener('pointerup', onLinkUp, { once: true })
}

function targetAt(e: PointerEvent): string | null {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-row-task]') as HTMLElement | null
  return el?.dataset.rowTask || null
}

function onLinkMove(e: PointerEvent) {
  if (!linkDrag.value) return
  const p = localPoint(e)
  const tgt = targetAt(e)
  linkDrag.value = { ...linkDrag.value, x2: p.x, y2: p.y, target: tgt && tgt !== linkDrag.value.from ? tgt : null }
}

async function onLinkUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onLinkMove)
  const l = linkDrag.value
  linkDrag.value = null
  store.interacting = false
  const to = targetAt(e)
  if (l && to && to !== l.from) await store.addDependency(l.from, to)
}

// 雙擊空白時間軸：在該工作流新增任務
function onTimelineDbl(e: MouseEvent, r: Row) {
  if (!store.canEdit) return
  const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left
  const start = fromDay(range.value.start + Math.floor(x / px.value))
  const wsId = r.kind === 'ws' ? r.ws.id : r.task.workstreamId
  const parentId = r.kind === 'task' ? r.task.parentId : null
  store.newTask({ workstreamId: wsId, parentId, start, end: fromDay(toDay(start) + 6) })
}

// ---------- 提示框 ----------
const tip = ref<null | { x: number; y: number; t: Task }>(null)
function showTip(e: MouseEvent, t: Task) {
  if (dragging.value || linkDrag.value) return
  tip.value = { x: e.clientX, y: e.clientY, t }
}
function hideTip() {
  tip.value = null
}
const tipStyle = computed(() => {
  if (!tip.value) return {}
  const w = 280
  const x = Math.min(tip.value.x + 14, window.innerWidth - w - 12)
  const y = tip.value.y + 18 + 160 > window.innerHeight ? tip.value.y - 170 : tip.value.y + 18
  return { left: x + 'px', top: y + 'px', width: w + 'px' }
})

// ---------- 捲動與匯出 ----------
function scrollToToday(smooth = true) {
  const el = scroller.value
  if (!el) return
  const target = todayX.value - (el.clientWidth - leftW.value) / 3
  el.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
}

function scrollToTask(id: string) {
  const el = scroller.value
  const t = store.byId.get(id)
  const i = rowIndex.value.get(id)
  if (!el || !t || i == null) return
  const g = barGeom(t)
  const vis = el.clientWidth - leftW.value
  if (g.left < el.scrollLeft || g.right > el.scrollLeft + vis) el.scrollTo({ left: Math.max(0, g.left - 80), behavior: 'smooth' })
  const top = i * rowH.value
  const headH = 56
  if (top < el.scrollTop || top + rowH.value > el.scrollTop + el.clientHeight - headH)
    el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' })
}

defineExpose({ scrollToToday, scrollToTask, el: inner })

// 切換刻度時維持目前檢視中心日期
let prevScale: Scale = store.scale
let prevStart = range.value.start
watch(
  () => store.scale,
  async (s) => {
    const el = scroller.value
    const centerDay = el ? prevStart + (el.scrollLeft + (el.clientWidth - leftW.value) / 2) / PX[prevScale] : null
    await nextTick()
    if (el && centerDay != null) el.scrollLeft = Math.max(0, (centerDay - range.value.start) * px.value - (el.clientWidth - leftW.value) / 2)
    prevScale = s
  }
)
watch(
  () => range.value.start,
  async (v) => {
    await nextTick()
    prevStart = v
  }
)

watch(
  () => store.selectedId,
  (id) => id && nextTick(() => scrollToTask(id))
)

function onResize() {
  narrow.value = window.innerWidth < 900
}
onMounted(() => {
  window.addEventListener('resize', onResize)
  // 等版面寬度確定後再捲動到今天
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToToday(false)))
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointermove', onLinkMove)
})

const pctLabel = (n: number) => `${Math.round(n)}%`
</script>

<template>
  <div ref="scroller" class="gantt" :class="{ report: store.reportMode, dragging, linking: !!linkDrag, readonly: !store.canEdit }">
    <div ref="inner" class="g-inner" :style="{ width: leftW + timelineW + 'px', '--row-h': rowH + 'px', '--left-w': leftW + 'px' }">
      <!-- 表頭 -->
      <div class="g-head">
        <div class="g-corner">
          <div class="c-name">任務</div>
          <div v-if="!narrow" class="c-owner">負責人</div>
          <div class="c-pct">進度</div>
        </div>
        <div class="g-scale" :style="{ width: timelineW + 'px' }">
          <div class="tier top">
            <div v-for="s in tiers.top" :key="s.key" class="seg" :style="{ left: s.x + 'px', width: s.w + 'px' }">
              <span>{{ s.label }}</span>
            </div>
          </div>
          <div class="tier bottom">
            <div
              v-for="s in tiers.bottom"
              :key="s.key"
              class="seg"
              :class="{ weekend: s.weekend, today: s.today }"
              :style="{ left: s.x + 'px', width: s.w + 'px' }"
            >
              <span v-if="s.w >= 14">{{ s.label }}</span>
            </div>
          </div>
          <div class="today-flag" :style="{ left: todayX + 'px' }">今天</div>
        </div>
      </div>

      <!-- 內容 -->
      <div ref="body" class="g-body" :style="{ height: bodyH + 'px' }">
        <div class="g-grid" :style="{ width: timelineW + 'px', height: bodyH + 'px' }">
          <div v-for="s in weekends" :key="'w' + s.key" class="weekend" :style="{ left: s.x + 'px', width: s.w + 'px' }" />
          <div v-for="s in tiers.bottom" :key="'l' + s.key" class="vline" :style="{ left: s.x + 'px' }" />
          <div v-for="s in tiers.top" :key="'L' + s.key" class="vline strong" :style="{ left: s.x + 'px' }" />
          <div class="today-line" :style="{ left: todayX + 'px' }" />
        </div>

        <svg class="g-deps" :width="timelineW" :height="bodyH">
          <defs>
            <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--g-dep)" />
            </marker>
            <marker id="arr-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--g-dep-active)" />
            </marker>
            <marker id="arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--c-danger)" />
            </marker>
          </defs>
          <path
            v-for="p in depPaths"
            :key="p.id"
            :d="p.d"
            class="dep"
            :class="{ bad: p.bad, active: p.active }"
            :marker-end="p.bad ? 'url(#arr-bad)' : p.active ? 'url(#arr-active)' : 'url(#arr)'"
          />
          <line
            v-if="linkDrag"
            :x1="linkDrag.x1"
            :y1="linkDrag.y1"
            :x2="linkDrag.x2"
            :y2="linkDrag.y2"
            class="dep linking"
            marker-end="url(#arr-active)"
          />
        </svg>

        <template v-for="r in rows" :key="r.key">
          <!-- 工作流列 -->
          <div v-if="r.kind === 'ws'" class="g-row ws" :style="{ '--ws': r.ws.color }">
            <div class="g-left" @click="store.toggleCollapse(r.ws.id)">
              <div class="c-name">
                <Icon :name="r.collapsed ? 'chevronRight' : 'chevronDown'" class="chev" />
                <span class="ws-dot" />
                <span class="ws-id">{{ r.ws.id }}</span>
                <span class="ellipsis" :title="r.ws.name">{{ r.ws.name }}</span>
                <span v-if="r.summary.delayed" class="chip delayed" :title="`${r.summary.delayed} 項延遲`">
                  <Icon name="alert" :size="12" />{{ r.summary.delayed }}
                </span>
                <button
                  v-if="store.canEdit"
                  class="btn ghost icon sm ws-edit no-print"
                  title="編輯工作流"
                  @click.stop="store.wsDialog = { ws: r.ws }"
                >
                  <Icon name="edit" :size="14" />
                </button>
              </div>
              <div v-if="!narrow" class="c-owner subtle">{{ r.summary.done }}/{{ r.summary.total }}</div>
              <div class="c-pct num">
                <b>{{ pctLabel(r.summary.actual) }}</b>
              </div>
            </div>
            <div class="g-time" :style="{ width: timelineW + 'px' }" @dblclick="onTimelineDbl($event, r)">
              <div
                v-if="r.summary.start && r.summary.end"
                class="summary"
                :style="{ left: xOf(r.summary.start) + 'px', width: duration(r.summary.start, r.summary.end) * px + 'px' }"
                :title="`${r.ws.name}：${fmtYMD(r.summary.start)} ~ ${fmtYMD(r.summary.end)}，實際 ${r.summary.actual}% / 計畫 ${r.summary.planned}%`"
              >
                <div class="fill" :style="{ width: r.summary.actual + '%' }" />
              </div>
            </div>
          </div>

          <!-- 任務列 -->
          <div
            v-else
            class="g-row task"
            :class="{
              selected: store.selectedId === r.task.id,
              target: linkDrag?.target === r.task.id,
            }"
            :data-row-task="r.task.id"
            :style="{ '--ws': wsColor(r.task.workstreamId) }"
          >
            <div class="g-left" @click="store.openTask(r.task.id)">
              <div class="c-name" :style="{ paddingLeft: 30 + r.depth * 16 + 'px' }">
                <span class="st" :class="r.task.type === 'milestone' ? 'ms' : r.task.status" :title="STATUS_LABEL[r.task.status]" />
                <span class="ellipsis" :title="r.task.name">{{ r.task.name }}</span>
                <Icon v-if="r.delayed" name="alert" :size="13" class="warn" />
              </div>
              <div v-if="!narrow" class="c-owner ellipsis muted" :title="r.task.owner">{{ r.task.owner }}</div>
              <div class="c-pct num" :class="{ done: r.task.status === 'done' }">
                {{ r.task.type === 'milestone' ? (r.task.status === 'done' ? '✓' : fmtMD(r.task.end)) : pctLabel(eff(r.task).progress) }}
              </div>
            </div>

            <div class="g-time" :style="{ width: timelineW + 'px' }" @dblclick.self="onTimelineDbl($event, r)">
              <!-- 里程碑 -->
              <template v-if="r.task.type === 'milestone'">
                <div
                  class="milestone"
                  :class="[r.task.status, { delayed: r.delayed }]"
                  :style="{ left: barGeom(r.task).cx + 'px' }"
                  @pointerdown="onBarDown($event, r.task, 'move')"
                  @mousemove="showTip($event, r.task)"
                  @mouseleave="hideTip"
                />
                <div v-if="store.canEdit" class="connector" :style="{ left: barGeom(r.task).cx + 10 + 'px' }" title="拖曳到其他任務以建立相依" @pointerdown="onLinkDown($event, r.task)" />
                <div class="bar-label" :style="{ left: barGeom(r.task).cx + 14 + 'px' }">
                  {{ r.task.name.replace(/^◆\s*/, '') }} <span class="subtle">{{ fmtMD(eff(r.task).end) }}</span>
                </div>
              </template>

              <!-- 一般任務 -->
              <template v-else>
                <div
                  class="bar"
                  :class="[r.task.status, { delayed: r.delayed, previewing: !!preview[r.task.id] }]"
                  :style="barStyle(r.task)"
                  @pointerdown="onBarDown($event, r.task, 'move')"
                  @mousemove="showTip($event, r.task)"
                  @mouseleave="hideTip"
                >
                  <div class="fill" :style="{ width: eff(r.task).progress + '%' }" />
                  <span v-if="barGeom(r.task).width > 40" class="pct num">{{ eff(r.task).progress }}%</span>
                  <template v-if="store.canEdit">
                    <div class="h h-left" @pointerdown="onBarDown($event, r.task, 'left')" />
                    <div class="h h-right" @pointerdown="onBarDown($event, r.task, 'right')" />
                    <div
                      class="h-progress"
                      :style="{ left: eff(r.task).progress + '%' }"
                      title="拖曳調整進度"
                      @pointerdown="onBarDown($event, r.task, 'progress')"
                    />
                  </template>
                </div>
                <div v-if="store.canEdit" class="connector" :style="{ left: barGeom(r.task).right + 6 + 'px' }" title="拖曳到其他任務以建立相依" @pointerdown="onLinkDown($event, r.task)" />
                <div class="bar-label" :style="{ left: barGeom(r.task).right + 16 + 'px' }">
                  <span class="ellipsis">{{ r.task.owner }}</span>
                  <Icon v-if="r.delayed" name="alert" :size="12" class="warn" />
                </div>
              </template>
            </div>
          </div>
        </template>

        <div v-if="!rows.length" class="empty">沒有符合條件的任務</div>
      </div>
    </div>

    <!-- 提示框 -->
    <Teleport to="body">
      <div v-if="tip" class="g-tip" :style="tipStyle">
        <div class="tt-title">
          <span class="tt-id">{{ tip.t.id }}</span>{{ tip.t.name }}
        </div>
        <div class="tt-grid">
          <span>期間</span><b class="num">{{ fmtYMD(eff(tip.t).start) }} ~ {{ fmtYMD(eff(tip.t).end) }}（{{ duration(eff(tip.t).start, eff(tip.t).end) }} 天）</b>
          <span>負責人</span><b>{{ tip.t.owner || '—' }}</b>
          <span>狀態</span><b><span class="chip" :class="tip.t.status">{{ STATUS_LABEL[tip.t.status] }}</span></b>
          <template v-if="tip.t.type !== 'milestone'">
            <span>進度</span>
            <b class="num">實際 {{ eff(tip.t).progress }}% ／ 計畫 {{ expectedProgress(eff(tip.t), store.today) }}%</b>
          </template>
        </div>
        <div v-if="tip.t.blockedReason" class="tt-note">卡關：{{ tip.t.blockedReason }}</div>
        <div v-if="tip.t.lastNote" class="tt-last">📝 {{ tip.t.lastNote }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gantt {
  position: relative;
  overflow: auto;
  height: 100%;
  background: var(--c-surface);
  user-select: none;
}
.gantt.dragging,
.gantt.dragging * {
  cursor: grabbing !important;
}
.gantt.linking,
.gantt.linking * {
  cursor: crosshair !important;
}
.g-inner {
  position: relative;
  min-height: 100%;
}

/* ----- 表頭 ----- */
.g-head {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  height: 56px;
  background: var(--c-surface-2);
  border-bottom: 1px solid var(--c-border-strong);
}
.g-corner {
  position: sticky;
  left: 0;
  z-index: 21;
  display: flex;
  align-items: flex-end;
  width: var(--left-w);
  flex: none;
  padding-bottom: 8px;
  background: var(--c-surface-2);
  border-right: 1px solid var(--c-border-strong);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
}
.g-corner .c-name {
  padding-left: 16px;
}
.g-scale {
  position: relative;
  flex: none;
}
.tier {
  position: absolute;
  left: 0;
  right: 0;
}
.tier.top {
  top: 0;
  height: 28px;
}
.tier.bottom {
  top: 28px;
  height: 28px;
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  border-left: 1px solid var(--g-line);
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
}
.tier.top .seg {
  padding-left: 8px;
  font-weight: 600;
  border-left-color: var(--g-line-strong);
}
.tier.top .seg span {
  position: sticky;
  left: calc(var(--left-w) + 8px);
}
.tier.bottom .seg {
  justify-content: center;
  color: var(--c-text-muted);
  border-top: 1px solid var(--g-line);
}
.tier.bottom .seg.weekend {
  color: var(--c-text-subtle);
  background: var(--g-weekend);
}
.tier.bottom .seg.today {
  color: var(--g-today);
  font-weight: 700;
}
.today-flag {
  position: absolute;
  top: 2px;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: var(--c-r-full);
  background: var(--g-today);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  pointer-events: none;
}

/* ----- 格線 ----- */
.g-body {
  position: relative;
}
.g-grid {
  position: absolute;
  top: 0;
  left: var(--left-w);
  z-index: 1;
  pointer-events: none;
}
.g-grid .weekend {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--g-weekend);
}
.g-grid .vline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--g-line);
}
.g-grid .vline.strong {
  background: var(--g-line-strong);
}
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--g-today);
  opacity: 0.75;
}
.g-deps {
  position: absolute;
  top: 0;
  left: var(--left-w);
  z-index: 2;
  pointer-events: none;
  overflow: visible;
}
.dep {
  fill: none;
  stroke: var(--g-dep);
  stroke-width: 1.3;
  opacity: 0.75;
}
.dep.active {
  stroke: var(--g-dep-active);
  stroke-width: 1.8;
  opacity: 1;
}
.dep.bad {
  stroke: var(--c-danger);
  stroke-dasharray: 4 3;
  opacity: 1;
}
.dep.linking {
  stroke: var(--g-dep-active);
  stroke-dasharray: 5 4;
}

/* ----- 列 ----- */
.g-row {
  --row-bg: transparent;
  display: flex;
  height: var(--row-h);
  border-bottom: 1px solid var(--g-line);
  background: var(--row-bg);
}
.g-row.task:hover {
  --row-bg: var(--g-row-hover);
}
.g-row.selected,
.g-row.target {
  --row-bg: var(--g-row-selected);
}
.g-row.ws {
  --row-bg: var(--c-surface-3);
  border-bottom-color: var(--c-border);
}
.g-left {
  position: sticky;
  left: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  width: var(--left-w);
  flex: none;
  background: linear-gradient(var(--row-bg), var(--row-bg)), var(--c-surface);
  border-right: 1px solid var(--c-border-strong);
  cursor: pointer;
}
.c-name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding-right: 6px;
}
.c-owner {
  width: 84px;
  flex: none;
  padding-right: 6px;
  font-size: 12px;
}
.c-pct {
  width: 54px;
  flex: none;
  padding-right: 12px;
  text-align: right;
  font-size: 12px;
}
.c-pct.done {
  color: var(--c-success);
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.g-row.ws .c-name {
  padding-left: 8px;
  font-weight: 600;
}
.chev {
  color: var(--c-text-subtle);
  flex: none;
}
.ws-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--ws);
  flex: none;
}
.ws-id {
  font-size: 11px;
  color: var(--c-text-subtle);
  font-weight: 600;
}
.ws-edit {
  margin-left: auto;
  opacity: 0;
}
.g-row.ws:hover .ws-edit {
  opacity: 1;
}
.st {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--c-border-strong);
}
.st.in_progress {
  background: var(--c-info);
}
.st.blocked {
  background: var(--c-danger);
}
.st.done {
  background: var(--c-success);
}
.st.on_hold {
  background: var(--c-warning);
}
.st.ms {
  width: 9px;
  height: 9px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: var(--ws);
}
.warn {
  color: var(--c-danger);
  flex: none;
}

.g-time {
  position: relative;
  flex: none;
}

/* ----- 工作流摘要條 ----- */
.summary {
  position: absolute;
  top: 50%;
  height: 8px;
  margin-top: -4px;
  z-index: 3;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ws) 25%, transparent);
  overflow: hidden;
}
.summary .fill {
  height: 100%;
  background: var(--ws);
}
.summary::before,
.summary::after {
  content: '';
  position: absolute;
  top: 0;
  width: 3px;
  height: 12px;
  background: var(--ws);
}

/* ----- 任務條 ----- */
.bar {
  position: absolute;
  top: 50%;
  height: 20px;
  margin-top: -10px;
  z-index: 3;
  display: flex;
  align-items: center;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--ws) 70%, transparent);
  background: color-mix(in srgb, var(--ws) 18%, var(--c-surface));
  cursor: grab;
  transition: box-shadow var(--c-dur) var(--c-ease);
}
.report .bar {
  height: 24px;
  margin-top: -12px;
}
.readonly .bar {
  cursor: pointer;
}
.bar:hover {
  box-shadow: var(--c-shadow-sm);
}
.g-row.selected .bar {
  box-shadow: 0 0 0 2px var(--c-surface), 0 0 0 4px color-mix(in srgb, var(--ws) 60%, transparent);
}
.bar .fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: 4px 0 0 4px;
  background: var(--ws);
  opacity: 0.85;
}
.bar.done .fill {
  border-radius: 4px;
}
.bar .pct {
  position: relative;
  padding-left: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text);
  text-shadow: 0 0 3px var(--c-surface);
  pointer-events: none;
}
.bar.blocked {
  border: 1.5px solid var(--c-danger);
  background-image: repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in srgb, var(--c-danger) 14%, transparent) 5px 10px);
}
.bar.on_hold {
  border-style: dashed;
  opacity: 0.65;
}
.bar.delayed:not(.blocked) {
  border-color: var(--c-danger);
}
.bar.previewing {
  box-shadow: var(--c-shadow-md);
  z-index: 5;
}
.h {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 8px;
  cursor: ew-resize;
}
.h-left {
  left: -4px;
}
.h-right {
  right: -4px;
}
.h-progress {
  position: absolute;
  bottom: -7px;
  width: 0;
  height: 0;
  margin-left: -5px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 7px solid var(--c-text-muted);
  cursor: col-resize;
  opacity: 0;
}
.bar:hover .h-progress,
.bar.previewing .h-progress {
  opacity: 1;
}
.connector {
  position: absolute;
  top: 50%;
  z-index: 4;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  border: 2px solid var(--c-text-muted);
  background: var(--c-surface);
  cursor: crosshair;
  opacity: 0;
  transition: opacity var(--c-dur);
}
.g-row.task:hover .connector {
  opacity: 1;
}
.bar-label {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 320px;
  font-size: 12px;
  color: var(--c-text-muted);
  white-space: nowrap;
  pointer-events: none;
}
.report .bar-label {
  font-size: 13px;
}

/* ----- 里程碑 ----- */
.milestone {
  position: absolute;
  top: 50%;
  z-index: 3;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  transform: rotate(45deg);
  border-radius: 2px;
  background: var(--c-surface);
  border: 2px solid var(--ws);
  cursor: grab;
}
.milestone.done {
  background: var(--ws);
}
.milestone.delayed {
  border-color: var(--c-danger);
}
.readonly .milestone {
  cursor: pointer;
}

.empty {
  position: sticky;
  left: 0;
  padding: 40px;
  color: var(--c-text-muted);
  text-align: center;
  width: 100vw;
}

/* ----- 提示框 ----- */
.g-tip {
  position: fixed;
  z-index: 1000;
  padding: 10px 12px;
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  box-shadow: var(--c-shadow-lg);
  font-size: 12px;
  pointer-events: none;
}
.tt-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  line-height: 1.4;
}
.tt-id {
  margin-right: 6px;
  color: var(--c-text-subtle);
  font-size: 11px;
}
.tt-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: center;
}
.tt-grid > span {
  color: var(--c-text-muted);
}
.tt-grid b {
  font-weight: 500;
}
.tt-last {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--c-border);
  color: var(--c-text-muted);
  white-space: pre-wrap;
  line-height: 1.5;
}
.tt-note {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: var(--c-r-xs);
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

@media print {
  .gantt {
    overflow: visible;
    height: auto;
  }
  .g-head,
  .g-left,
  .g-corner {
    position: static;
  }
}
</style>
