<script setup lang="ts">
// Mermaid 圖畫布:延遲載入 mermaid、滾輪縮放 / 拖曳平移、點擊節點回傳原始 ID
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../Icon.vue'

const props = defineProps<{
  code: string
  ids: Map<string, string>
  theme: 'light' | 'dark'
  selected?: string | null
  hits?: string[]
  /** 選取節點的直接相鄰節點;有選取時其餘節點淡化 */
  near?: string[]
  /** 額外的 mermaid 設定(例如 ER 圖的 elk 分層方式) */
  config?: Record<string, unknown>
  /** 右側被詳細面板遮住的寬度(px),置中選取節點時避開 */
  inset?: number
  name?: string
}>()
const emit = defineEmits<{ select: [id: string] }>()

const viewport = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const error = ref('')
const rendering = ref(false)
const k = ref(1)
const tx = ref(0)
const ty = ref(0)

type Mermaid = (typeof import('mermaid'))['default']
let mermaidP: Promise<Mermaid> | null = null
const loadMermaid = () => (mermaidP ??= import('mermaid').then((m) => m.default))

let seq = 0
let elements = new Map<string, Element>()

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

let latest = 0
async function render() {
  if (!host.value) return
  // 篩選連續切換時,只採用最後一次的繪製結果
  const token = ++latest
  rendering.value = true
  error.value = ''
  try {
    const mermaid = await loadMermaid()
    const dark = props.theme === 'dark'
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      darkMode: dark,
      fontFamily: cssVar('--c-font'),
      maxTextSize: 500000,
      maxEdges: 2000,
      themeVariables: {
        darkMode: dark,
        background: cssVar('--c-surface'),
        primaryColor: cssVar('--c-surface'),
        primaryTextColor: cssVar('--c-text'),
        primaryBorderColor: cssVar('--c-border-strong'),
        secondaryColor: cssVar('--c-surface-3'),
        tertiaryColor: cssVar('--c-surface-2'),
        lineColor: cssVar('--c-text-subtle'),
        textColor: cssVar('--c-text'),
        clusterBkg: cssVar('--c-surface-2'),
        clusterBorder: cssVar('--c-border-strong'),
        edgeLabelBackground: cssVar('--c-surface'),
        titleColor: cssVar('--c-text'),
        fontSize: '14px',
        attributeBackgroundColorOdd: cssVar('--c-surface'),
        attributeBackgroundColorEven: cssVar('--c-surface-2'),
      },
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', padding: 10, nodeSpacing: 34, rankSpacing: 60 },
      er: { useMaxWidth: false, layoutDirection: 'TB', entityPadding: 12 },
      ...props.config,
    })
    const { svg } = await mermaid.render(`arch-diagram-${++seq}`, props.code)
    if (token !== latest || !host.value) return
    host.value.innerHTML = svg
    indexElements()
    applyMarks()
    await nextTick()
    fit()
  } catch (e) {
    if (token !== latest) return
    error.value = (e as Error).message || String(e)
    host.value.innerHTML = ''
    document.querySelectorAll('[id^="darch-diagram-"]').forEach((n) => n.remove())
  } finally {
    if (token === latest) rendering.value = false
  }
}

/** Mermaid 產生的元素 ID 形如 flowchart-<id>-<n>、entity-<id>-<n>,反查原始 ID */
function resolve(el: Element): string | null {
  const dataId = el.getAttribute('data-id')
  if (dataId && props.ids.has(dataId)) return props.ids.get(dataId)!
  const m = /(?:flowchart|entity)-(.+?)-\d+$/.exec(el.id)
  if (m && props.ids.has(m[1])) return props.ids.get(m[1])!
  for (const [mid, orig] of props.ids) if (el.id.includes(`-${mid}-`) || el.id.endsWith(`-${mid}`)) return orig
  return null
}

function indexElements() {
  elements = new Map()
  host.value?.querySelectorAll('g.node, g[id*="entity-"]').forEach((el) => {
    const id = resolve(el)
    if (id && !elements.has(id)) {
      elements.set(id, el)
      el.classList.add('clickable')
    }
  })
}

function applyMarks() {
  const hits = new Set(props.hits || [])
  const sel = props.selected && elements.has(props.selected) ? props.selected : null
  const near = new Set(props.near || [])
  host.value?.classList.toggle('has-selection', !!sel)
  for (const [id, el] of elements) {
    el.classList.toggle('is-selected', id === sel)
    el.classList.toggle('is-near', !!sel && (id === sel || near.has(id)))
    el.classList.toggle('is-hit', hits.has(id))
  }
}

// ---------- 縮放 / 平移 ----------
function svgSize() {
  const svg = host.value?.querySelector('svg')
  if (!svg) return { w: 1, h: 1 }
  const vb = svg.viewBox?.baseVal
  const w = vb && vb.width ? vb.width : svg.getBoundingClientRect().width / k.value
  const h = vb && vb.height ? vb.height : svg.getBoundingClientRect().height / k.value
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.style.maxWidth = 'none'
  return { w, h }
}

function fit() {
  const vp = viewport.value
  if (!vp) return
  const { w, h } = svgSize()
  const pad = 24
  const s = Math.min((vp.clientWidth - pad * 2) / w, (vp.clientHeight - pad * 2) / h, 1.25)
  k.value = Math.max(0.08, s)
  tx.value = (vp.clientWidth - w * k.value) / 2
  ty.value = Math.max(pad, (vp.clientHeight - h * k.value) / 2)
}

function zoomAt(factor: number, cx?: number, cy?: number) {
  const vp = viewport.value
  if (!vp) return
  const x = cx ?? vp.clientWidth / 2
  const y = cy ?? vp.clientHeight / 2
  const nk = Math.min(4, Math.max(0.08, k.value * factor))
  tx.value = x - ((x - tx.value) * nk) / k.value
  ty.value = y - ((y - ty.value) * nk) / k.value
  k.value = nk
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const r = viewport.value!.getBoundingClientRect()
  zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
}

let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null
function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  drag = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value, moved: false }
}
function onMove(e: PointerEvent) {
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  if (!drag.moved) viewport.value?.setPointerCapture(e.pointerId)
  drag.moved = true
  dragging.value = true
  tx.value = drag.tx + dx
  ty.value = drag.ty + dy
}
let justDragged = false
const dragging = ref(false)
function onUp() {
  justDragged = !!drag?.moved
  drag = null
  dragging.value = false
}
function onClick(e: MouseEvent) {
  if (justDragged) {
    justDragged = false
    return
  }
  const target = (e.target as Element).closest?.('g.clickable')
  const id = target && [...elements].find(([, el]) => el === target)?.[0]
  if (id) emit('select', id)
}

// ---------- 匯出 ----------
function download(name: string, content: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
function exportSvg() {
  const svg = host.value?.querySelector('svg')
  if (svg) download(`${props.name || 'architecture'}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml')
}
const copied = ref(false)
async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
  } catch {
    download(`${props.name || 'architecture'}.mmd`, props.code, 'text/plain')
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

/** 選取節點:縮放到看得清楚的比例並置中 */
const READABLE = 0.85
function scrollToSelected() {
  const el = props.selected ? elements.get(props.selected) : null
  const vp = viewport.value
  if (!el || !vp) return
  if (k.value < READABLE) {
    const er0 = el.getBoundingClientRect()
    const vr0 = vp.getBoundingClientRect()
    zoomAt(READABLE / k.value, er0.left + er0.width / 2 - vr0.left, er0.top + er0.height / 2 - vr0.top)
  }
  const er = el.getBoundingClientRect()
  const vr = vp.getBoundingClientRect()
  const inset = Math.min(props.inset || 0, vr.width * 0.5)
  const right = vr.right - inset
  if (er.left >= vr.left && er.right <= right && er.top >= vr.top && er.bottom <= vr.bottom) return
  tx.value += vr.left + (vr.width - inset) / 2 - (er.left + er.width / 2)
  ty.value += vr.top + vr.height / 2 - (er.top + er.height / 2)
}

watch(() => [props.code, props.theme], render)
watch(() => [props.hits, props.near], applyMarks, { deep: true })
watch(
  () => props.selected,
  () => {
    applyMarks()
    scrollToSelected()
  }
)

let ro: ResizeObserver | undefined
onMounted(() => {
  render()
  viewport.value?.addEventListener('wheel', onWheel, { passive: false })
  let last = 0
  ro = new ResizeObserver(() => {
    const w = viewport.value?.clientWidth || 0
    if (Math.abs(w - last) > 40 && !rendering.value && host.value?.querySelector('svg')) fit()
    last = w
  })
  if (viewport.value) ro.observe(viewport.value)
})
onBeforeUnmount(() => {
  viewport.value?.removeEventListener('wheel', onWheel)
  ro?.disconnect()
})

defineExpose({ fit })
</script>

<template>
  <div class="canvas">
    <div class="tools">
      <button class="btn sm icon" title="放大" @click="zoomAt(1.25)"><Icon name="plus" :size="14" /></button>
      <button class="btn sm icon" title="縮小" @click="zoomAt(0.8)"><span class="minus" /></button>
      <button class="btn sm" title="符合畫面" @click="fit"><Icon name="fullscreen" :size="14" />符合</button>
      <span class="pct num">{{ Math.round(k * 100) }}%</span>
      <span class="grow" />
      <button class="btn sm ghost" title="複製 Mermaid 原始碼(可貼到文件或給 AI)" @click="copyCode">
        <Icon :name="copied ? 'check' : 'table'" :size="14" />{{ copied ? '已複製' : 'Mermaid' }}
      </button>
      <button class="btn sm ghost" title="下載 SVG" @click="exportSvg"><Icon name="download" :size="14" />SVG</button>
    </div>
    <div
      ref="viewport"
      class="viewport"
      :class="{ dragging }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @click="onClick"
      @dblclick="fit"
    >
      <div ref="host" class="stage" :style="{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }" />
      <div v-if="rendering" class="overlay muted">繪製中…</div>
      <div v-if="error" class="overlay err">
        <b>圖表產生失敗</b>
        <code>{{ error }}</code>
      </div>
      <div class="hint subtle">滾輪縮放 · 拖曳平移 · 點節點看詳細 · 雙擊符合畫面</div>
    </div>
  </div>
</template>

<style scoped>
.canvas {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  overflow: hidden;
}
.tools {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface-2);
}
.minus {
  display: inline-block;
  width: 10px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
}
.pct {
  min-width: 42px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.grow {
  flex: 1;
}
.viewport {
  position: relative;
  flex: 1;
  min-height: 320px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-image: radial-gradient(var(--c-border) 1px, transparent 1px);
  background-size: 18px 18px;
}
.viewport.dragging {
  cursor: grabbing;
}
.stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  background: color-mix(in srgb, var(--c-surface) 70%, transparent);
}
.overlay.err code {
  max-width: 90%;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--c-danger);
}
.hint {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: 11px;
  pointer-events: none;
}
.stage :deep(g.clickable) {
  cursor: pointer;
}
.stage :deep(g.clickable:hover) {
  filter: brightness(1.08) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.18));
}
.stage :deep(g.is-hit) :is(rect, path, polygon, circle, ellipse) {
  stroke: var(--c-warning) !important;
  stroke-width: 3px !important;
}
.stage.has-selection :deep(g.clickable:not(.is-near)) {
  opacity: 0.22;
}
.stage :deep(g.is-selected) :is(rect, path, polygon, circle, ellipse) {
  stroke: var(--g-today) !important;
  stroke-width: 3.5px !important;
}
@media (max-width: 760px) {
  .hint {
    display: none;
  }
}
</style>
