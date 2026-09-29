<script setup lang="ts">
import Icon from './Icon.vue'
defineProps<{ title: string; width?: number }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="overlay no-print" @mousedown.self="emit('close')">
    <div class="modal" :style="{ width: `min(${width || 440}px, calc(100vw - 32px))` }" role="dialog" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <button class="btn ghost icon" title="關閉" @click="emit('close')"><Icon name="x" /></button>
      </header>
      <div class="m-body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: var(--c-overlay);
}
.modal {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
  border-radius: var(--c-r-lg);
  background: var(--c-surface);
  box-shadow: var(--c-shadow-lg);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px 20px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
.m-body {
  padding: 4px 20px 20px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-2);
}
</style>
