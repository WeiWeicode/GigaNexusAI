<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import QRCode from 'qrcode'
import { usePlan } from '../stores/plan'
import { api } from '../api'
import Modal from './Modal.vue'
import Icon from './Icon.vue'

const store = usePlan()
const s = computed(() => store.server)
const port = computed(() => (location.port ? Number(location.port) : s.value?.port || 5190))
const urls = computed(() => (s.value?.addresses || []).map((a) => ({ ...a, url: `http://${a.address}:${port.value}` })))
const hostUrl = computed(() => (s.value ? `http://${s.value.hostname}:${port.value}` : ''))
const primary = computed(() => urls.value.find((u) => !u.virtual) || urls.value[0])
const qr = ref('')

watchEffect(async () => {
  if (!primary.value) return
  qr.value = await QRCode.toDataURL(primary.value.url, { margin: 1, width: 180, color: { dark: '#10231d', light: '#ffffff' } })
})

const pinInput = ref('')
const newPin = ref('')
const msg = ref('')

async function unlock() {
  msg.value = ''
  if (await store.unlock(pinInput.value)) {
    store.toast('已解鎖編輯', 'success')
    pinInput.value = ''
  } else msg.value = 'PIN 不正確'
}

async function savePin(clear = false) {
  const r = await store.run(() => api.setPin(clear ? '' : newPin.value))
  if (!r) return
  store.server = await api.serverInfo()
  newPin.value = ''
  store.toast(clear ? '已取消編輯 PIN，區網內皆可編輯' : '已設定編輯 PIN，遠端連線預設為唯讀', 'success')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    store.toast('已複製網址')
  } catch {
    prompt('複製此網址：', text)
  }
}
</script>

<template>
  <Modal title="區網連線資訊" :width="560" @close="store.connectOpen = false">
    <p class="muted intro">筆電與這台主機在同一個網路（公司內網）時，用瀏覽器開啟以下網址即可檢視與報告。</p>

    <div class="connect">
      <img v-if="qr" :src="qr" alt="連線 QR Code" class="qr" />
      <ul class="urls">
        <li v-for="u in urls" :key="u.address" :class="{ virtual: u.virtual }">
          <code>{{ u.url }}</code>
          <span class="nic">{{ u.name }}{{ u.virtual ? '（虛擬網卡，筆電通常連不到）' : '' }}</span>
          <button class="btn sm" @click="copy(u.url)">複製</button>
        </li>
        <li v-if="hostUrl">
          <code>{{ hostUrl }}</code>
          <span class="nic">以電腦名稱連線（IP 變動時仍可用）</span>
          <button class="btn sm" @click="copy(hostUrl)">複製</button>
        </li>
      </ul>
    </div>

    <details class="help">
      <summary>筆電連不上？</summary>
      <ol>
        <li>確認服務以 <code>npm start</code> 執行中，且主機未進入睡眠。</li>
        <li>
          Windows 防火牆需允許 TCP {{ port }} 輸入（僅網域 / 私人網路）。請以<b>系統管理員</b>身分在 PowerShell 執行：
          <pre>New-NetFirewallRule -DisplayName "NexusPlan {{ port }}" -Direction Inbound -Protocol TCP -LocalPort {{ port }} -Action Allow -Profile Domain,Private</pre>
        </li>
        <li>若 IP 常變動，可向 IT 申請保留 IP，或改用電腦名稱網址。</li>
      </ol>
    </details>

    <hr />

    <div class="pin">
      <div class="pin-head">
        <Icon :name="s?.canEdit ? 'unlock' : 'lock'" />
        <b>編輯權限</b>
        <span class="chip" :class="s?.canEdit ? 'done' : 'blocked'">{{ s?.canEdit ? '可編輯' : '唯讀' }}</span>
        <span class="subtle">{{ s?.isLocal ? '（主機本機免 PIN）' : '' }}</span>
      </div>

      <template v-if="s?.isLocal">
        <p class="muted">
          {{ s.hasPin ? '已設定 PIN：其他裝置需輸入 PIN 才能修改，未輸入者為唯讀。' : '尚未設定 PIN：區網內任何人開啟都能修改。建議在會議報告前設定。' }}
        </p>
        <div class="row">
          <input v-model="newPin" class="input sm" type="password" placeholder="輸入新的 PIN（4 碼以上）" @keydown.enter="newPin.length >= 4 && savePin()" />
          <button class="btn" :disabled="newPin.length < 4" @click="savePin()">{{ s.hasPin ? '變更 PIN' : '設定 PIN' }}</button>
          <button v-if="s.hasPin" class="btn danger" @click="savePin(true)">取消 PIN</button>
        </div>
      </template>
      <template v-else-if="s?.hasPin">
        <div v-if="!s.canEdit" class="row">
          <input v-model="pinInput" class="input sm" type="password" placeholder="輸入編輯 PIN" @keydown.enter="unlock" />
          <button class="btn primary" @click="unlock">解鎖編輯</button>
        </div>
        <button v-else class="btn" @click="store.lock()"><Icon name="lock" />鎖定（改回唯讀）</button>
        <p v-if="msg" class="err">{{ msg }}</p>
      </template>
      <p v-else class="muted">主機未設定 PIN，此裝置可直接編輯。</p>
    </div>

    <p v-if="s?.dbFile" class="subtle db">資料庫：{{ s.dbFile }}</p>
  </Modal>
</template>

<style scoped>
.intro {
  margin: 0;
  line-height: 1.6;
}
.connect {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.qr {
  width: 132px;
  height: 132px;
  border-radius: var(--c-r-md);
  border: 1px solid var(--c-border);
  flex: none;
}
@media (max-width: 520px) {
  .qr {
    display: none;
  }
}
.urls {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.urls li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  align-items: center;
}
.urls code {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-brand-600);
  word-break: break-all;
}
.urls .virtual code {
  color: var(--c-text-muted);
  font-weight: 500;
  font-size: 13px;
}
.urls .btn {
  grid-row: span 2;
}
.nic {
  font-size: 12px;
  color: var(--c-text-subtle);
}
.help {
  font-size: 13px;
  color: var(--c-text-muted);
}
.help summary {
  cursor: pointer;
  color: var(--c-text);
}
.help ol {
  padding-left: 18px;
  line-height: 1.7;
}
.help pre {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 8px 10px;
  border-radius: var(--c-r-sm);
  background: var(--c-surface-3);
  font-size: 12px;
  user-select: all;
}
hr {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--c-border);
  margin: 4px 0;
}
.pin {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pin-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pin p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
.row {
  display: flex;
  gap: 8px;
}
.row .input {
  flex: 1;
}
.err {
  color: var(--c-danger);
}
.db {
  margin: 0;
  font-size: 11px;
  word-break: break-all;
}
</style>
