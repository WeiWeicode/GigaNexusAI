<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlan } from '../stores/plan'
import Modal from './Modal.vue'
import Icon from './Icon.vue'

const store = usePlan()
const ws = store.wsDialog?.ws || null
const name = ref(ws?.name || '')
const color = ref(ws?.color || '#3a6fd8')
const PALETTE = ['#3a6fd8', '#d97706', '#7c3aed', '#0891b2', '#12a57c', '#e11d48', '#c026d3', '#65a30d', '#475569', '#ea580c']
const taskCount = computed(() => (ws ? store.tasks.filter((t) => t.workstreamId === ws.id).length : 0))

function close() {
  store.wsDialog = null
}

async function save() {
  if (!name.value.trim()) return
  const r = await store.saveWorkstream({ ...(ws || {}), name: name.value.trim(), color: color.value })
  if (r) {
    store.toast(ws ? '已更新工作流' : `已新增工作流 ${r.id}`, 'success')
    close()
  }
}

async function remove() {
  if (!ws) return
  const msg = taskCount.value
    ? `「${ws.name}」底下有 ${taskCount.value} 個任務，將一併刪除且無法用 Ctrl+Z 復原（系統已有自動備份）。確定刪除？`
    : `確定刪除「${ws.name}」？`
  if (!confirm(msg)) return
  await store.deleteWorkstream(ws.id)
  close()
}
</script>

<template>
  <Modal :title="ws ? `編輯工作流 ${ws.id}` : '新增工作流'" @close="close">
    <label class="field">
      <span>名稱</span>
      <input v-model="name" class="input" autofocus @keydown.enter="save" />
    </label>
    <div class="field">
      <span>顏色</span>
      <div class="swatches">
        <button
          v-for="c in PALETTE"
          :key="c"
          class="sw"
          :class="{ on: color === c }"
          :style="{ background: c }"
          :title="c"
          @click="color = c"
        />
        <input v-model="color" type="color" class="picker" title="自訂顏色" />
      </div>
    </div>
    <template #footer>
      <template v-if="ws">
        <button class="btn danger" @click="remove"><Icon name="trash" />刪除</button>
        <button class="btn ghost icon" title="上移" @click="store.moveWorkstream(ws.id, -1)"><Icon name="up" /></button>
        <button class="btn ghost icon" title="下移" @click="store.moveWorkstream(ws.id, 1)"><Icon name="down" /></button>
      </template>
      <span style="flex: 1" />
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" :disabled="!name.trim()" @click="save">{{ ws ? '儲存' : '新增' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.sw {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
}
.sw.on {
  border-color: var(--c-surface);
  box-shadow: 0 0 0 2px var(--c-text);
}
.picker {
  width: 36px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: none;
  cursor: pointer;
}
</style>
