<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlan } from '../stores/plan'
import { api } from '../api'
import type { ProgressLog } from '../types'
import { STATUS_LABEL } from '../types'
import { addDays, fmtDateTime, fmtMD, fmtYMD, toDay } from '../utils/date'
import { expectedProgress, isDelayed, summarize, weighted } from '../utils/metrics'
import Icon from './Icon.vue'

const store = usePlan()

const overall = computed(() => weighted(store.tasks, store.today))
const counts = computed(() => {
  const ts = store.tasks.filter((t) => t.type !== 'milestone')
  return {
    total: ts.length,
    done: ts.filter((t) => t.status === 'done').length,
    doing: ts.filter((t) => t.status === 'in_progress').length,
    delayed: store.tasks.filter((t) => isDelayed(t, store.today)).length,
    blocked: ts.filter((t) => t.status === 'blocked').length,
  }
})
const wsSummaries = computed(() => [...store.workstreams].sort((a, b) => a.sort - b.sort).map((w) => summarize(w, store.tasks, store.today)))

const milestones = computed(() =>
  store.tasks
    .filter((t) => t.type === 'milestone' && t.status !== 'done')
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(0, 4)
    .map((t) => ({ t, days: toDay(t.end) - toDay(store.today), ws: store.workstreams.find((w) => w.id === t.workstreamId) }))
)

const risks = computed(() =>
  store.tasks
    .filter((t) => t.status === 'blocked' || isDelayed(t, store.today))
    .map((t) => ({ t, gap: expectedProgress(t, store.today) - t.progress }))
    .sort((a, b) => Number(b.t.status === 'blocked') - Number(a.t.status === 'blocked') || b.gap - a.gap)
)

const PERIODS = [
  { label: '近 7 天', days: 7 },
  { label: '近 14 天', days: 14 },
  { label: '近 30 天', days: 30 },
]
const period = ref(7)
const since = computed(() => addDays(store.today, -period.value))
const changes = ref<ProgressLog[]>([])
async function loadChanges() {
  changes.value = await api.changes(since.value).catch(() => [])
}
watch([since, () => store.revision], loadChanges, { immediate: true })

const statusLabel = (s: string | null) => (s ? STATUS_LABEL[s as keyof typeof STATUS_LABEL] || s : '')
const wsOf = (taskId: string) => store.workstreams.find((w) => w.id === store.byId.get(taskId)?.workstreamId)
</script>

<template>
  <section class="report">
    <!-- 整體 -->
    <div class="card overall">
      <div class="k">整體完成度</div>
      <div class="big num">{{ overall.actual }}<small>%</small></div>
      <div class="meter">
        <div class="fill" :style="{ width: overall.actual + '%' }" />
        <div class="plan" :style="{ left: overall.planned + '%' }" :title="`計畫 ${overall.planned}%`" />
      </div>
      <div class="sub">
        計畫 <b class="num">{{ overall.planned }}%</b>
        <span :class="overall.actual + 3 < overall.planned ? 'bad' : 'good'">
          {{ overall.actual >= overall.planned ? '符合進度' : `落後 ${overall.planned - overall.actual}%` }}
        </span>
      </div>
      <div class="stats">
        <div><b class="num">{{ counts.done }}<small>/{{ counts.total }}</small></b><span>已完成</span></div>
        <div><b class="num">{{ counts.doing }}</b><span>進行中</span></div>
        <div :class="{ bad: counts.delayed }"><b class="num">{{ counts.delayed }}</b><span>延遲</span></div>
        <div :class="{ bad: counts.blocked }"><b class="num">{{ counts.blocked }}</b><span>卡關</span></div>
      </div>
      <div class="asof subtle">統計基準日 {{ fmtYMD(store.today) }}</div>
    </div>

    <!-- 工作流 -->
    <div class="card">
      <div class="k">各工作流進度 <span class="subtle">（▲ 為今日計畫進度）</span></div>
      <ul class="ws-list">
        <li v-for="s in wsSummaries" :key="s.ws.id" :style="{ '--ws': s.ws.color }">
          <span class="dot" />
          <span class="name ellipsis" :title="s.ws.name">{{ s.ws.name }}</span>
          <div class="meter sm">
            <div class="fill" :style="{ width: s.actual + '%' }" />
            <div class="plan" :style="{ left: s.planned + '%' }" />
          </div>
          <b class="num pct">{{ s.actual }}%</b>
          <Icon v-if="s.delayed || s.blocked" name="alert" :size="13" class="warn" />
        </li>
      </ul>
    </div>

    <!-- 里程碑 + 風險 -->
    <div class="card">
      <div class="k">接下來的里程碑</div>
      <ul class="ms-list">
        <li v-for="m in milestones" :key="m.t.id" :style="{ '--ws': m.ws?.color }" @click="store.openTask(m.t.id)">
          <span class="diamond" />
          <span class="ellipsis">{{ m.t.name.replace(/^◆\s*/, '') }}</span>
          <span class="when num" :class="{ bad: m.days < 0 }">
            {{ fmtMD(m.t.end) }} · {{ m.days < 0 ? `逾期 ${-m.days} 天` : m.days === 0 ? '今天' : `${m.days} 天後` }}
          </span>
        </li>
        <li v-if="!milestones.length" class="subtle">所有里程碑皆已完成</li>
      </ul>
      <div class="k mt">延遲 / 卡關</div>
      <ul class="risk-list">
        <li v-for="r in risks.slice(0, 5)" :key="r.t.id" @click="store.openTask(r.t.id)">
          <span class="chip" :class="r.t.status === 'blocked' ? 'blocked' : 'delayed'">{{ r.t.status === 'blocked' ? '卡關' : '延遲' }}</span>
          <span class="ellipsis" :title="r.t.blockedReason || r.t.name">{{ r.t.name }}</span>
          <span class="subtle num">{{ r.t.owner }} · {{ r.t.progress }}%</span>
        </li>
        <li v-if="risks.length > 5" class="subtle">另有 {{ risks.length - 5 }} 項…</li>
        <li v-if="!risks.length" class="good">目前沒有延遲或卡關項目</li>
      </ul>
    </div>

    <!-- 本期更新 -->
    <div class="card changes">
      <div class="k row">
        本期更新
        <div class="seg">
          <button v-for="p in PERIODS" :key="p.days" :class="{ on: period === p.days }" @click="period = p.days">{{ p.label }}</button>
        </div>
      </div>
      <ol>
        <li v-for="c in changes" :key="c.id" :style="{ '--ws': wsOf(c.task_id)?.color }" @click="store.byId.has(c.task_id) && store.openTask(c.task_id)">
          <div class="c-line">
            <span class="dot" />
            <b class="ellipsis">{{ c.task_name }}</b>
            <span v-if="c.from_progress !== c.to_progress" class="num delta">{{ c.from_progress }}→{{ c.to_progress }}%</span>
            <span v-else-if="c.from_status !== c.to_status" class="delta">{{ statusLabel(c.to_status) }}</span>
          </div>
          <div v-if="c.note" class="c-note">{{ c.note }}</div>
          <div class="c-time subtle num">{{ fmtDateTime(c.at) }}</div>
        </li>
        <li v-if="!changes.length" class="subtle">{{ fmtYMD(since) }} 之後沒有進度更新</li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.report {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(280px, 1.2fr) minmax(280px, 1.1fr) minmax(280px, 1.1fr);
  gap: 12px;
  padding: 12px 16px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
  max-height: 48vh;
  overflow: auto;
  flex: none;
}
@media (max-width: 1100px) {
  .report {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 700px) {
  .report {
    grid-template-columns: 1fr;
  }
}
.card {
  min-width: 0;
  max-height: 250px;
  overflow: auto;
  padding: 14px 16px;
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  box-shadow: var(--c-shadow-xs);
}
.k {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
  margin-bottom: 10px;
}
.k.mt {
  margin-top: 16px;
}
.k.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.big {
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
  color: var(--c-brand-500);
}
.big small {
  font-size: 20px;
}
.meter {
  position: relative;
  height: 10px;
  margin: 12px 0 8px;
  border-radius: 10px;
  background: var(--c-surface-3);
}
.meter .fill {
  height: 100%;
  border-radius: 10px;
  background: var(--ws, var(--c-brand-500));
}
.meter .plan {
  position: absolute;
  top: 100%;
  width: 0;
  height: 0;
  margin-left: -5px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 6px solid var(--c-text);
}
.meter.sm {
  flex: 1;
  height: 8px;
  margin: 0;
}
.sub {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--c-text-muted);
}
.bad {
  color: var(--c-danger) !important;
  font-weight: 600;
}
.good {
  color: var(--c-success);
  font-weight: 600;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 14px;
}
.stats > div {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-2);
  font-size: 12px;
  color: var(--c-text-muted);
}
.stats b {
  font-size: 18px;
  color: var(--c-text);
}
.stats b small {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-subtle);
}
.stats .bad b {
  color: var(--c-danger);
}
.asof {
  margin-top: 10px;
  font-size: 11px;
}
ul,
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.ws-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ws-list .name {
  width: 42%;
  flex: none;
}
.ws-list .pct {
  width: 38px;
  text-align: right;
  font-size: 12px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--ws);
  flex: none;
}
.warn {
  color: var(--c-danger);
  flex: none;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.ms-list li,
.risk-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.ms-list li:hover .ellipsis,
.risk-list li:hover .ellipsis {
  text-decoration: underline;
}
.diamond {
  width: 9px;
  height: 9px;
  transform: rotate(45deg);
  border: 2px solid var(--ws);
  flex: none;
}
.when {
  font-size: 12px;
  color: var(--c-text-muted);
  white-space: nowrap;
}
.risk-list .subtle {
  font-size: 12px;
  white-space: nowrap;
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
}
.seg button {
  border: 0;
  background: transparent;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--c-text-muted);
}
.seg button.on {
  background: var(--c-surface);
  color: var(--c-text);
  box-shadow: var(--c-shadow-xs);
}
.changes li {
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--c-border);
  cursor: pointer;
}
.c-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.c-line b {
  font-weight: 600;
}
.delta {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-brand-600);
  white-space: nowrap;
}
.c-note {
  margin: 4px 0 0 15px;
  color: var(--c-text-muted);
  white-space: pre-wrap;
}
.c-time {
  margin: 2px 0 0 15px;
  font-size: 11px;
}
</style>
