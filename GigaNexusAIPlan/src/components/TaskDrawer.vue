<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { usePlan } from '../stores/plan'
import { api } from '../api'
import type { ProgressLog, Task } from '../types'
import { PRIORITY_LABEL, STATUS_LABEL } from '../types'
import { addDays, duration, fmtDateTime, fmtYMD, todayStr } from '../utils/date'
import { expectedProgress, isDelayed, ownersOf } from '../utils/metrics'
import Icon from './Icon.vue'

const store = usePlan()

const original = ref<Task | null>(null)
const draft = ref<Task>(blank())
const note = ref('')
const linksText = ref('')
const logs = ref<ProgressLog[]>([])
const newPred = ref('')
const saving = ref(false)
const nameInput = ref<HTMLInputElement>()

const isNew = computed(() => store.drawer?.mode === 'new')
const readonly = computed(() => !store.canEdit)
const open = computed(() => !!store.drawer)

function blank(): Task {
  const start = todayStr()
  return {
    id: '',
    workstreamId: store.workstreams[0]?.id || '',
    parentId: null,
    name: '',
    owner: '',
    start,
    end: addDays(start, 6),
    progress: 0,
    status: 'todo',
    type: 'task',
    priority: 'normal',
    description: '',
    blockedReason: '',
    links: [],
    sort: 0,
    updatedAt: '',
  }
}

watch(
  () => store.drawer,
  async (d) => {
    note.value = ''
    newPred.value = ''
    logs.value = []
    if (!d) return
    if (d.mode === 'edit') {
      const t = store.byId.get(d.taskId)
      if (!t) return
      original.value = t
      draft.value = { ...t, links: [...t.links] }
      linksText.value = t.links.join('\n')
      logs.value = await api.logs(t.id).catch(() => [])
    } else {
      original.value = null
      draft.value = { ...blank(), ...d.preset }
      linksText.value = ''
      await nextTick()
      nameInput.value?.focus()
    }
  },
  { immediate: true }
)

// 任務被其他動作（拖曳、復原）更新時，同步未修改的欄位
watch(
  () => (store.drawer?.mode === 'edit' ? store.byId.get(store.drawer.taskId) : null),
  (t) => {
    if (!t || !original.value || t.updatedAt === original.value.updatedAt) return
    const dirty = diff()
    original.value = t
    draft.value = { ...t, links: [...t.links], ...dirty }
    if (!dirty.links) linksText.value = t.links.join('\n')
    api.logs(t.id).then((l) => (logs.value = l)).catch(() => {})
  }
)

const owners = computed(() => ownersOf(store.tasks))
const parentOptions = computed(() =>
  store.tasks.filter((t) => t.workstreamId === draft.value.workstreamId && t.id !== draft.value.id && t.type !== 'milestone' && !isDescendant(t.id))
)
function isDescendant(id: string): boolean {
  let cur = store.byId.get(id)
  while (cur?.parentId) {
    if (cur.parentId === draft.value.id) return true
    cur = store.byId.get(cur.parentId)
  }
  return false
}

const preds = computed(() => store.dependencies.filter((d) => d.to === draft.value.id).map((d) => ({ dep: d, t: store.byId.get(d.from) })))
const succs = computed(() => store.dependencies.filter((d) => d.from === draft.value.id).map((d) => ({ dep: d, t: store.byId.get(d.to) })))
const predCandidates = computed(() => {
  const taken = new Set(preds.value.map((p) => p.dep.from))
  return store.workstreams.map((ws) => ({
    ws,
    tasks: store.tasks.filter((t) => t.workstreamId === ws.id && t.id !== draft.value.id && !taken.has(t.id)),
  }))
})

const days = computed(() => (draft.value.end >= draft.value.start ? duration(draft.value.start, draft.value.end) : 0))
const expected = computed(() => expectedProgress(draft.value, store.today))
const delayed = computed(() => !isNew.value && isDelayed(draft.value, store.today))
const wsColor = computed(() => store.workstreams.find((w) => w.id === draft.value.workstreamId)?.color || '#3a6fd8')

function diff(): Partial<Task> {
  const o = original.value
  if (!o) return {}
  const d = draft.value
  const out: Partial<Task> = {}
  for (const k of ['workstreamId', 'parentId', 'name', 'owner', 'start', 'end', 'progress', 'status', 'type', 'priority', 'description', 'blockedReason'] as const) {
    if ((d[k] ?? null) !== (o[k] ?? null)) (out as any)[k] = d[k]
  }
  const links = parseLinks()
  if (JSON.stringify(links) !== JSON.stringify(o.links)) out.links = links
  return out
}

function parseLinks() {
  return linksText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

const dirty = computed(() => isNew.value || Object.keys(diff()).length > 0 || !!note.value.trim())

function onProgress(v: number) {
  draft.value.progress = v
  if (v >= 100) draft.value.status = 'done'
  else if (v > 0 && (draft.value.status === 'todo' || draft.value.status === 'done')) draft.value.status = 'in_progress'
  else if (v === 0 && draft.value.status === 'done') draft.value.status = 'todo'
}
function onStatus() {
  if (draft.value.status === 'done') draft.value.progress = 100
}
function onType() {
  if (draft.value.type === 'milestone') draft.value.end = draft.value.start
}
function onStart() {
  if (draft.value.type === 'milestone' || draft.value.end < draft.value.start) {
    const len = original.value ? duration(original.value.start, original.value.end) - 1 : 6
    draft.value.end = draft.value.type === 'milestone' ? draft.value.start : addDays(draft.value.start, len)
  }
}
function onWorkstream() {
  if (draft.value.parentId && store.byId.get(draft.value.parentId)?.workstreamId !== draft.value.workstreamId) draft.value.parentId = null
}

const error = computed(() => {
  const d = draft.value
  if (!d.name.trim()) return '請輸入任務名稱'
  if (!d.workstreamId) return '請選擇工作流'
  if (!d.start || !d.end) return '請輸入日期'
  if (d.end < d.start) return '結束日不可早於開始日'
  if (d.status === 'blocked' && !d.blockedReason.trim()) return '卡關請填寫原因'
  return ''
})

async function save() {
  if (readonly.value || error.value || saving.value) return
  saving.value = true
  try {
    if (isNew.value) {
      const t = await store.createTask({ ...draft.value, id: undefined, links: parseLinks() } as Partial<Task>)
      if (t) {
        store.toast(`已新增「${t.name}」`, 'success')
        store.drawer = null
        store.selectedId = t.id
      }
    } else if (original.value) {
      const changes = diff()
      const t = await store.updateTask(original.value.id, changes, {
        note: note.value.trim(),
        expectedUpdatedAt: original.value.updatedAt,
        label: 'progress' in changes ? `更新「${draft.value.name}」進度 ${draft.value.progress}%` : undefined,
      })
      if (t) {
        store.toast('已儲存', 'success')
        store.drawer = null
        if (changes.start || changes.end) store.checkCascade(t.id)
      }
    }
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!original.value) return
  if (!confirm(`確定刪除「${original.value.name}」？（可用 Ctrl+Z 復原）`)) return
  await store.deleteTask(original.value.id)
}

async function addPred() {
  if (!newPred.value || !original.value) return
  await store.addDependency(newPred.value, original.value.id)
  newPred.value = ''
}

function close() {
  if (dirty.value && !isNew.value && !readonly.value && Object.keys(diff()).length && !confirm('有未儲存的變更，確定關閉？')) return
  store.drawer = null
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save()
}

const statusLabel = (s: string | null) => (s ? STATUS_LABEL[s as keyof typeof STATUS_LABEL] || s : '')
defineExpose({ close })
</script>

<template>
  <Transition name="drawer">
    <aside v-if="open" class="drawer no-print" :style="{ '--ws': wsColor }" @keydown="onKey">
      <header class="d-head">
        <div class="d-title">
          <span class="ws-bar" />
          <div>
            <div class="d-kicker">
              {{ isNew ? '新增任務' : draft.id }}
              <span v-if="!isNew" class="chip" :class="original?.status">{{ STATUS_LABEL[original?.status || 'todo'] }}</span>
              <span v-if="delayed" class="chip delayed"><Icon name="alert" :size="12" />延遲</span>
              <span v-if="readonly" class="chip"><Icon name="lock" :size="12" />唯讀</span>
            </div>
            <h2>{{ draft.name || '（未命名任務）' }}</h2>
          </div>
        </div>
        <button class="btn ghost icon" title="關閉 (Esc)" @click="close"><Icon name="x" /></button>
      </header>

      <div class="d-body">
        <fieldset :disabled="readonly">
          <!-- 進度（最常用，放最上面） -->
          <section v-if="draft.type !== 'milestone'" class="card progress-card">
            <div class="pc-top">
              <div class="pc-num num">{{ draft.progress }}<small>%</small></div>
              <div class="pc-meta">
                <div>計畫進度 <b class="num">{{ expected }}%</b></div>
                <div :class="draft.progress + 10 < expected ? 'bad' : 'good'">
                  {{ draft.progress >= expected ? '進度正常' : `落後 ${expected - draft.progress}%` }}
                </div>
              </div>
            </div>
            <input
              class="range"
              type="range"
              min="0"
              max="100"
              step="5"
              :value="draft.progress"
              :style="{ '--p': draft.progress + '%' }"
              @input="onProgress(Number(($event.target as HTMLInputElement).value))"
            />
            <div class="quick">
              <button v-for="v in [0, 25, 50, 75, 100]" :key="v" type="button" class="btn sm" :class="{ primary: draft.progress === v }" @click="onProgress(v)">
                {{ v }}%
              </button>
            </div>
          </section>

          <div class="grid2">
            <label class="field">
              <span>狀態</span>
              <select v-model="draft.status" class="select" @change="onStatus">
                <option v-for="(l, k) in STATUS_LABEL" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
            <label class="field">
              <span>優先度</span>
              <select v-model="draft.priority" class="select">
                <option v-for="(l, k) in PRIORITY_LABEL" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
          </div>
          <label v-if="draft.status === 'blocked'" class="field">
            <span>卡關原因 *</span>
            <input v-model="draft.blockedReason" class="input" placeholder="例如：等待 IT 開通防火牆 5050 埠" />
          </label>
          <div v-if="!isNew && original?.lastNote" class="last-note">
            <div class="ln-head">
              <span>最新備註</span>
              <span class="subtle num">{{ original.lastNoteAt ? fmtDateTime(original.lastNoteAt) : '' }}</span>
            </div>
            <div class="ln-body">{{ original.lastNote }}</div>
          </div>
          <label v-if="!isNew" class="field">
            <span>新增進度備註（儲存後加入下方歷程，欄位會清空）</span>
            <textarea v-model="note" class="textarea" rows="2" placeholder="例如：Runner B 已註冊，tag: windows-runner" />
          </label>

          <hr />

          <label class="field">
            <span>任務名稱 *</span>
            <input ref="nameInput" v-model="draft.name" class="input" />
          </label>
          <div class="grid2">
            <label class="field">
              <span>類型</span>
              <select v-model="draft.type" class="select" @change="onType">
                <option value="task">任務</option>
                <option value="milestone">里程碑 ◆</option>
              </select>
            </label>
            <label class="field">
              <span>負責人</span>
              <input v-model="draft.owner" class="input" list="owner-list" placeholder="多人以「、」分隔" />
              <datalist id="owner-list">
                <option v-for="o in owners" :key="o" :value="o" />
              </datalist>
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span>工作流</span>
              <select v-model="draft.workstreamId" class="select" @change="onWorkstream">
                <option v-for="w in store.workstreams" :key="w.id" :value="w.id">{{ w.id }} {{ w.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>上層任務</span>
              <select v-model="draft.parentId" class="select">
                <option :value="null">（無）</option>
                <option v-for="t in parentOptions" :key="t.id" :value="t.id">{{ t.id }} {{ t.name }}</option>
              </select>
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span>{{ draft.type === 'milestone' ? '日期' : '開始日' }}</span>
              <input v-model="draft.start" type="date" class="input" @change="onStart" />
            </label>
            <label v-if="draft.type !== 'milestone'" class="field">
              <span>結束日 <em class="subtle">（{{ days }} 天）</em></span>
              <input v-model="draft.end" type="date" class="input" :min="draft.start" />
            </label>
          </div>
          <label class="field">
            <span>說明 / 完成定義</span>
            <textarea v-model="draft.description" class="textarea" rows="3" />
          </label>
          <label class="field">
            <span>相關連結（一行一個）</span>
            <textarea v-model="linksText" class="textarea" rows="2" placeholder="https://gitlab.local/..." />
          </label>
          <div v-if="draft.links.length && readonly" class="links">
            <a v-for="l in draft.links" :key="l" :href="l" target="_blank" rel="noopener">{{ l }}</a>
          </div>
        </fieldset>

        <!-- 相依 -->
        <template v-if="!isNew">
          <hr />
          <h3>前置任務 <span class="subtle">（完成後才能開始本任務）</span></h3>
          <ul class="deps">
            <li v-for="p in preds" :key="p.dep.id">
              <button class="dep-link" @click="p.t && store.openTask(p.t.id)">
                <span class="subtle">{{ p.dep.from }}</span> {{ p.t?.name }}
                <span class="subtle num">~ {{ p.t ? fmtYMD(p.t.end) : '' }}</span>
              </button>
              <button v-if="!readonly" class="btn ghost icon sm" title="移除相依" @click="store.removeDependency(p.dep.id)"><Icon name="x" :size="14" /></button>
            </li>
            <li v-if="!preds.length" class="subtle">無</li>
          </ul>
          <div v-if="!readonly" class="add-dep">
            <select v-model="newPred" class="select sm">
              <option value="">＋ 新增前置任務…</option>
              <optgroup v-for="g in predCandidates" :key="g.ws.id" :label="`${g.ws.id} ${g.ws.name}`">
                <option v-for="t in g.tasks" :key="t.id" :value="t.id">{{ t.id }} {{ t.name }}</option>
              </optgroup>
            </select>
            <button class="btn sm" :disabled="!newPred" @click="addPred">加入</button>
          </div>

          <h3>後續任務</h3>
          <ul class="deps">
            <li v-for="s in succs" :key="s.dep.id">
              <button class="dep-link" @click="s.t && store.openTask(s.t.id)">
                <span class="subtle">{{ s.dep.to }}</span> {{ s.t?.name }}
                <span class="subtle num">{{ s.t ? fmtYMD(s.t.start) : '' }} ~</span>
              </button>
              <button v-if="!readonly" class="btn ghost icon sm" title="移除相依" @click="store.removeDependency(s.dep.id)"><Icon name="x" :size="14" /></button>
            </li>
            <li v-if="!succs.length" class="subtle">無</li>
          </ul>

          <hr />
          <h3>進度歷程</h3>
          <ol class="logs">
            <li v-for="l in logs" :key="l.id">
              <div class="l-time num">{{ fmtDateTime(l.at) }}</div>
              <div class="l-body">
                <span v-if="l.from_progress !== l.to_progress" class="num">{{ l.from_progress }}% → <b>{{ l.to_progress }}%</b></span>
                <span v-if="l.from_status !== l.to_status">{{ statusLabel(l.from_status) }} → <b>{{ statusLabel(l.to_status) }}</b></span>
                <div v-if="l.note" class="l-note">{{ l.note }}</div>
              </div>
            </li>
            <li v-if="!logs.length" class="subtle">尚無紀錄</li>
          </ol>
          <p v-if="original" class="subtle updated">最後更新：{{ fmtDateTime(original.updatedAt) }}</p>
        </template>
      </div>

      <footer v-if="!readonly" class="d-foot">
        <template v-if="!isNew">
          <button class="btn danger" @click="remove"><Icon name="trash" />刪除</button>
          <button class="btn ghost icon" title="上移" @click="store.moveTask(draft.id, -1)"><Icon name="up" /></button>
          <button class="btn ghost icon" title="下移" @click="store.moveTask(draft.id, 1)"><Icon name="down" /></button>
        </template>
        <span class="spacer" />
        <span v-if="error && dirty" class="err">{{ error }}</span>
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" :disabled="!!error || !dirty || saving" title="Ctrl+Enter" @click="save">
          <Icon name="save" />{{ isNew ? '新增' : '儲存' }}
        </button>
      </footer>
    </aside>
  </Transition>
</template>

<style scoped>
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  width: min(440px, 100vw);
  background: var(--c-surface);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--c-shadow-lg);
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.22s var(--c-ease), opacity 0.22s var(--c-ease);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
.d-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 12px 20px;
  border-bottom: 1px solid var(--c-border);
}
.d-title {
  display: flex;
  gap: 12px;
  min-width: 0;
}
.ws-bar {
  width: 4px;
  align-self: stretch;
  border-radius: 4px;
  background: var(--ws);
  flex: none;
}
.d-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--c-text-subtle);
  font-weight: 600;
}
h2 {
  margin: 4px 0 0;
  font-size: 17px;
  line-height: 1.4;
}
.d-body {
  flex: 1;
  overflow: auto;
  padding: 16px 20px 24px;
}
fieldset {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
fieldset:disabled .input,
fieldset:disabled .select,
fieldset:disabled .textarea {
  background: var(--c-surface-2);
  opacity: 1;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
hr {
  border: 0;
  border-top: 1px solid var(--c-border);
  margin: 18px 0 14px;
}
h3 {
  margin: 14px 0 8px;
  font-size: 13px;
}
.card {
  padding: 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface-2);
}
.pc-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 10px;
}
.pc-num {
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  color: var(--ws);
}
.pc-num small {
  font-size: 16px;
  margin-left: 2px;
}
.pc-meta {
  text-align: right;
  font-size: 12px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.pc-meta .bad {
  color: var(--c-danger);
  font-weight: 600;
}
.pc-meta .good {
  color: var(--c-success);
  font-weight: 600;
}
.range {
  width: 100%;
  height: 8px;
  appearance: none;
  border-radius: 8px;
  background: linear-gradient(to right, var(--ws) var(--p), var(--c-border) var(--p));
  cursor: pointer;
}
.range::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-surface);
  border: 3px solid var(--ws);
  box-shadow: var(--c-shadow-sm);
}
.range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--c-surface);
  border: 3px solid var(--ws);
}
.quick {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.quick .btn {
  flex: 1;
  justify-content: center;
}
.last-note {
  padding: 10px 12px;
  border-radius: var(--c-r-sm);
  border-left: 3px solid var(--ws);
  background: var(--c-surface-2);
  font-size: 13px;
}
.ln-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
}
.ln-body {
  white-space: pre-wrap;
  line-height: 1.5;
}
.deps,
.logs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.deps li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dep-link {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-sm);
  background: var(--c-surface);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dep-link:hover {
  border-color: var(--c-border-strong);
  background: var(--c-surface-3);
}
.add-dep {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.logs li {
  display: grid;
  grid-template-columns: 116px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-border);
}
.l-time {
  font-size: 12px;
  color: var(--c-text-subtle);
}
.l-body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.l-note {
  width: 100%;
  color: var(--c-text-muted);
  white-space: pre-wrap;
}
.links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.links a {
  color: var(--c-info);
  word-break: break-all;
}
.updated {
  margin-top: 12px;
  font-size: 12px;
}
.d-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-2);
}
.spacer {
  flex: 1;
}
.err {
  font-size: 12px;
  color: var(--c-danger);
}
em {
  font-style: normal;
}
</style>
