<script setup lang="ts">
// 部署流程頁:程式碼 → GitLab → 測試區 / 正式區(資料來源 architecture/deployment.json)
import { computed, ref } from 'vue'
import { deployment as d, nodeOf } from '../../arch/data'
import { deployDiagram } from '../../arch/diagrams'
import type { DeployEnv, DeployProjectEnv, DeployStep } from '../../arch/types'
import DiagramCanvas from './DiagramCanvas.vue'

const props = defineProps<{ theme: 'light' | 'dark' }>()
const emit = defineEmits<{ openProject: [id: string] }>()

const ENVS: { id: DeployEnv | 'all'; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'dev', name: '開發' },
  { id: 'test', name: '測試區' },
  { id: 'prod', name: '正式區' },
]
const ENV_NAME: Record<DeployEnv, string> = { dev: '開發', test: '測試區', prod: '正式區' }
const TRIGGER: Record<DeployStep['trigger'], string> = { auto: '自動', manual: '人工', mr: 'MR 合併' }
const STATE: Record<DeployProjectEnv['state'], string> = { auto: '自動', manual: '手動 ▶', pending: '待合併', none: '未設定', hand: '主機手動' }
const RULE: Record<string, string> = { must: '必守', warn: '注意', info: '說明' }

const env = ref<DeployEnv | 'all'>('all')
const selected = ref<string | null>(null)
const textColor = computed(() => (props.theme === 'dark' ? '#e8f0ed' : '#10231d'))

const diagram = computed(() => deployDiagram(d, { env: env.value, steps: d.steps, textColor: textColor.value }))
const steps = computed(() => (env.value === 'all' ? d.steps : d.steps.filter((s) => s.env === env.value)))

const selNode = computed(() => d.nodes.find((n) => n.id === selected.value))
const selLane = computed(() => d.lanes.find((l) => l.id === selNode.value?.lane))
const selSteps = computed(() => d.steps.filter((s) => selected.value && s.nodes.includes(selected.value)))
const near = computed(() => d.edges.filter((e) => e.from === selected.value || e.to === selected.value).map((e) => (e.from === selected.value ? e.to : e.from)))

function goStep(no: number) {
  document.getElementById(`deploy-step-${no}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
</script>

<template>
  <div class="deploy">
    <header class="head">
      <h1>{{ d.title }}</h1>
      <p class="lead">{{ d.summary }}</p>
    </header>

    <div class="filters">
      <span class="f-label">強調</span>
      <div class="seg">
        <button v-for="e in ENVS" :key="e.id" :class="{ on: env === e.id }" @click="env = e.id">{{ e.name }}</button>
      </div>
      <span class="subtle hint">點圖上節點看說明與對應步驟;滾輪縮放、拖曳平移</span>
    </div>

    <DiagramCanvas
      class="diagram"
      :code="diagram.code"
      :ids="diagram.ids"
      :theme="props.theme"
      :selected="selected"
      :near="near"
      name="deployment-flow"
      @select="(id) => (selected = id)"
    />

    <div class="legend subtle">
      <span><i class="ln solid" />自動</span>
      <span><i class="ln manual" />人工操作(審核、按 ▶)</span>
      <span><i class="ln dotted" />同步 / 備份</span>
      <span><i class="sh stadium" />人</span><span><i class="sh round" />分支</span><span><i class="sh hex" />Merge Request</span>
      <span><i class="sh rect" />Pipeline job</span><span><i class="sh sub" />Runner</span><span><i class="sh para" />部署區</span><span><i class="sh cyl" />Registry</span>
    </div>

    <div v-if="selNode" class="sel">
      <button class="x" title="關閉" @click="selected = null">×</button>
      <div class="p-kicker"><i class="dot" :style="{ background: selLane?.color }" />{{ selLane?.name }}</div>
      <b>{{ selNode.name }}</b>
      <p>{{ selNode.detail }}</p>
      <div v-if="selSteps.length" class="sel-steps">
        對應步驟:
        <a v-for="s in selSteps" :key="s.no" href="#" @click.prevent="goStep(s.no)">{{ s.no }}. {{ s.title }}</a>
      </div>
    </div>

    <!-- 規則 -->
    <section class="block">
      <h2>部署規則</h2>
      <div class="rules">
        <div v-for="r in d.rules" :key="r.title" class="rule" :class="r.level">
          <span class="lv">{{ RULE[r.level] }}</span>
          <b>{{ r.title }}</b>
          <p>{{ r.body }}</p>
        </div>
      </div>
    </section>

    <!-- 步驟 -->
    <section class="block">
      <h2>部署步驟 <span class="subtle">{{ steps.length }}</span></h2>
      <ol class="steps">
        <li
          v-for="s in steps"
          :id="`deploy-step-${s.no}`"
          :key="s.no"
          class="step"
          :class="[s.env, { lit: selected && s.nodes.includes(selected) }]"
        >
          <div class="no">{{ s.no }}</div>
          <div class="body">
            <div class="s-h">
              <b>{{ s.title }}</b>
              <span class="pill env">{{ ENV_NAME[s.env] }}</span>
              <span class="pill" :class="s.trigger">{{ TRIGGER[s.trigger] }}</span>
            </div>
            <div class="meta subtle">誰:{{ s.who }} · 在哪:{{ s.where }}</div>
            <ul>
              <li v-for="a in s.actions" :key="a">{{ a }}</li>
            </ul>
            <pre v-if="s.commands?.length" class="cmd">{{ s.commands.join('\n') }}</pre>
          </div>
        </li>
      </ol>
    </section>

    <!-- 各專案現況 -->
    <section class="block">
      <h2>各專案 CI/CD 現況 <span class="subtle">資料更新 {{ d.updated }}</span></h2>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>專案</th><th>測試區(develop)</th><th>正式區(main)</th><th>備註</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in d.projects" :key="p.id">
              <td class="w-name">
                <a href="#" @click.prevent="emit('openProject', p.id)">{{ nodeOf(p.id)?.name || p.id }}</a>
              </td>
              <td><span class="st" :class="p.test.state">{{ STATE[p.test.state] }}</span>{{ p.test.text }}</td>
              <td><span class="st" :class="p.prod.state">{{ STATE[p.prod.state] }}</span>{{ p.prod.text }}</td>
              <td class="muted">{{ p.notes }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 回滾 -->
    <section class="block">
      <h2>回滾</h2>
      <div class="tbl-wrap">
        <table class="tbl">
          <tbody>
            <tr v-for="r in d.rollback" :key="r.target">
              <td class="w-name"><b>{{ r.target }}</b></td>
              <td>{{ r.how }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="subtle src">資料依據:{{ d.sources.join('、') }}</p>
    </section>
  </div>
</template>

<style scoped>
.head h1 {
  margin: 4px 0 6px;
  font-size: 22px;
  line-height: 1.3;
}
.lead {
  max-width: 980px;
  margin: 0 0 14px;
  color: var(--c-text-muted);
  line-height: 1.6;
}
.rules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.rule {
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-left: 4px solid var(--c-info);
  border-radius: var(--c-r-sm);
  background: var(--c-surface);
  font-size: 13px;
}
.rule.must {
  border-left-color: var(--c-danger);
}
.rule.warn {
  border-left-color: var(--c-warning);
}
.rule p {
  margin: 4px 0 0;
  color: var(--c-text-muted);
  line-height: 1.55;
  font-size: 12.5px;
}
.lv {
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: var(--c-r-full);
  font-size: 11px;
  font-weight: 600;
  background: var(--c-info-soft);
  color: var(--c-info);
}
.must .lv {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.warn .lv {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-bottom: 10px;
}
.f-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-muted);
}
.hint {
  font-size: 12px;
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
}
.seg button {
  padding: 4px 12px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--c-text-muted);
  font-size: 12.5px;
  cursor: pointer;
}
.seg button.on {
  background: var(--c-surface);
  color: var(--c-text);
  font-weight: 600;
  box-shadow: var(--c-shadow-xs);
}
.diagram {
  height: max(420px, calc(100vh - 300px));
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
.ln {
  display: inline-block;
  width: 22px;
  border-top: 2px solid var(--c-text-muted);
}
.ln.manual {
  border-top: 3px solid #ea580c;
}
.ln.dotted {
  border-top-style: dotted;
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
.sel {
  position: relative;
  margin-top: 12px;
  padding: 12px 36px 12px 14px;
  border: 1px solid var(--c-brand-500);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  font-size: 13px;
}
.sel p {
  margin: 4px 0;
  color: var(--c-text-muted);
}
.sel .x {
  position: absolute;
  top: 6px;
  right: 8px;
  border: 0;
  background: none;
  font-size: 18px;
  color: var(--c-text-muted);
  cursor: pointer;
}
.p-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-subtle);
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.sel-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12.5px;
}
.block {
  margin-top: 26px;
}
.block h2 {
  margin: 22px 0 10px;
  font-size: 16px;
}
.block h2 .subtle {
  font-size: 12px;
  font-weight: 400;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-r-md);
  background: var(--c-surface);
  transition: border-color var(--c-dur) var(--c-ease);
}
.step.lit {
  border-color: var(--c-brand-500);
  box-shadow: var(--c-ring);
}
.no {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-weight: 700;
  font-size: 13px;
  color: #fff;
  background: #64748b;
}
.test .no {
  background: #2563eb;
}
.prod .no {
  background: #12a57c;
}
.body {
  min-width: 0;
  flex: 1;
  font-size: 13px;
}
.s-h {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.meta {
  margin-top: 2px;
  font-size: 12px;
}
.body ul {
  margin: 6px 0 0;
  padding-left: 18px;
  line-height: 1.6;
}
.pill {
  padding: 1px 7px;
  border-radius: var(--c-r-full);
  font-size: 11px;
  font-weight: 600;
  background: var(--c-surface-3);
  color: var(--c-text-muted);
}
.pill.auto {
  background: var(--c-info-soft);
  color: var(--c-info);
}
.pill.manual,
.pill.mr {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}
.cmd {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
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
  line-height: 1.55;
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
  width: 180px;
  white-space: nowrap;
}
.st {
  display: inline-block;
  margin-right: 6px;
  padding: 0 7px;
  border-radius: var(--c-r-full);
  font-size: 11px;
  font-weight: 600;
  background: var(--c-surface-3);
  color: var(--c-text-muted);
}
.st.auto,
.st.manual {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.st.pending,
.st.hand {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}
.st.none {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.src {
  margin-top: 10px;
  font-size: 12px;
}
@media (max-width: 600px) {
  .rules {
    grid-template-columns: 1fr;
  }
  .tbl .w-name {
    white-space: normal;
  }
}
</style>
