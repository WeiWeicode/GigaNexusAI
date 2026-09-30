<script setup lang="ts">
// 架構圖獨立網站(npm run arch):只看架構,不含甘特圖進度與編輯,不需要 API 服務
import { ref } from 'vue'
import ArchitectureView from './components/arch/ArchitectureView.vue'
import Icon from './components/Icon.vue'

const KEY = 'nexusplan.theme'
function initialTheme(): 'light' | 'dark' {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* 無法讀取時依系統設定 */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const theme = ref(initialTheme())
document.documentElement.dataset.theme = theme.value

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  try {
    localStorage.setItem(KEY, JSON.stringify(theme.value))
  } catch {
    /* 只影響偏好記憶 */
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <a class="brand" href="#/arch">
        <div class="logo">
          <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="currentColor" /><circle cx="10" cy="10" r="3.2" fill="#fff" /><circle cx="22" cy="10" r="3.2" fill="#fff" opacity=".8" /><circle cx="16" cy="22" r="3.2" fill="#fff" /><path d="M10 10 22 10M10 10 16 22M22 10 16 22" stroke="#fff" stroke-width="1.6" opacity=".7" /></svg>
        </div>
        <div>
          <div class="b-title">GigaNexus 架構圖</div>
          <div class="b-sub">專案關係 · 內部架構 · 資料庫 — 保持架構一致</div>
        </div>
      </a>
      <button class="btn ghost icon" :title="theme === 'dark' ? '淺色模式' : '深色模式'" @click="toggleTheme">
        <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
      </button>
    </header>
    <div class="body">
      <ArchitectureView :theme="theme" />
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
  flex: none;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.logo {
  width: 32px;
  height: 32px;
  flex: none;
  color: var(--c-brand-500);
}
.b-title {
  font-weight: 700;
  font-size: 16px;
}
.b-sub {
  font-size: 12px;
  color: var(--c-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.body {
  flex: 1;
  min-height: 0;
}
@media (max-width: 600px) {
  .b-sub {
    display: none;
  }
}
</style>
