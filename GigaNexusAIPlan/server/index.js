// NexusPlan 本機服務：提供 Vue 靜態頁面 + REST API，資料存於本機 SQLite
// 監聽 0.0.0.0，讓同一區網的筆電可用 http://<本機IP>:5190 連線
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces, hostname } from 'node:os'
import * as store from './db.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 5190)
const HOST = process.env.HOST || '0.0.0.0'

// 只信任本機反向代理（vite dev proxy）帶來的 X-Forwarded-For
const app = Fastify({ logger: { level: 'warn' }, trustProxy: ['127.0.0.1', '::1'], bodyLimit: 20 * 1024 * 1024 })

// ---------- 區網資訊 ----------
function lanAddresses() {
  const list = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|Loopback/i.test(name)
      list.push({ name, address: a.address, virtual })
    }
  }
  // 實體網卡優先，其次 10.x / 192.168.x
  const rank = (x) => (x.virtual ? 10 : 0) + (/^(10\.|192\.168\.)/.test(x.address) ? 0 : 1)
  return list.sort((a, b) => rank(a) - rank(b))
}

const selfIps = () => new Set(['127.0.0.1', '::1', ...lanAddresses().map((x) => x.address)])
const normalizeIp = (ip) => String(ip || '').replace(/^::ffff:/, '')
const isLocal = (req) => selfIps().has(normalizeIp(req.ip))
function headerPin(req) {
  try {
    return decodeURIComponent(String(req.headers['x-edit-pin'] || ''))
  } catch {
    return ''
  }
}
const canEdit = (req) => isLocal(req) || store.checkPin(headerPin(req))

// ---------- 寫入保護 ----------
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.method === 'GET' || req.url.startsWith('/api/auth/')) return
  if (!canEdit(req)) return reply.code(403).send({ error: '唯讀模式：請輸入編輯 PIN 後再修改' })
})

// 回傳目前資料版本，讓前端判斷是否有其他裝置更新
app.addHook('onSend', async (req, reply, payload) => {
  if (req.url.startsWith('/api/')) reply.header('x-revision', String(store.getRevision()))
  return payload
})

app.setErrorHandler((err, req, reply) => {
  const status = err.status || err.statusCode || 500
  if (status >= 500) req.log.error(err)
  reply.code(status).send({ error: err.message, ...(err.extra || {}) })
})

// ---------- API ----------
app.get('/api/plan', async () => store.getPlan())
app.get('/api/revision', async () => ({ revision: store.getRevision() }))

app.get('/api/server-info', async (req) => ({
  hostname: hostname(),
  port: PORT,
  addresses: lanAddresses(),
  hasPin: store.hasPin(),
  isLocal: isLocal(req),
  canEdit: canEdit(req),
  dbFile: isLocal(req) ? store.DB_FILE : undefined,
}))

app.post('/api/auth/check', async (req) => ({ ok: store.checkPin(req.body?.pin) }))

app.put('/api/settings/pin', async (req, reply) => {
  if (!isLocal(req)) return reply.code(403).send({ error: '只能在主機本機設定 PIN' })
  store.setPin(req.body?.pin || '')
  return { hasPin: store.hasPin() }
})

app.post('/api/tasks', async (req) => store.createTask(req.body?.task || {}, req.body?.dependencies || []))
app.patch('/api/tasks/:id', async (req) => {
  const { changes = {}, note = '', expectedUpdatedAt } = req.body || {}
  return store.updateTask(req.params.id, changes, note, expectedUpdatedAt)
})
app.post('/api/tasks/:id/progress', async (req) => {
  const { progress, status, note = '' } = req.body || {}
  const changes = {}
  if (progress != null) changes.progress = progress
  if (status) changes.status = status
  return store.updateTask(req.params.id, changes, note)
})
app.post('/api/tasks/batch', async (req) => store.updateTasks(req.body?.items || []))
app.delete('/api/tasks/:id', async (req) => store.deleteTask(req.params.id))
app.get('/api/tasks/:id/logs', async (req) => store.getLogs(req.params.id))

app.post('/api/dependencies', async (req) => store.createDependency(req.body?.from, req.body?.to))
app.delete('/api/dependencies/:id', async (req) => {
  store.deleteDependency(Number(req.params.id))
  return { ok: true }
})

app.post('/api/workstreams', async (req) => store.upsertWorkstream({ ...req.body, id: undefined }))
app.put('/api/workstreams/:id', async (req) => store.upsertWorkstream({ ...req.body, id: req.params.id }))
app.delete('/api/workstreams/:id', async (req) => {
  store.deleteWorkstream(req.params.id)
  return { ok: true }
})

app.get('/api/changes', async (req) => store.getChanges(String(req.query.since || '1970-01-01')))

app.get('/api/export', async (req, reply) => {
  const stamp = new Date().toISOString().slice(0, 10)
  reply.header('Content-Disposition', `attachment; filename="nexusplan-${stamp}.json"`)
  return store.exportPlan()
})
app.post('/api/import', async (req) => store.importPlan(req.body))
app.post('/api/backup', async () => ({ file: store.backup('manual') }))

// ---------- 靜態頁面（npm run build 後） ----------
if (existsSync(DIST)) {
  await app.register(fastifyStatic, { root: DIST })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

// ---------- 自動備份 ----------
store.backup('startup')
setInterval(() => store.backup('daily'), 24 * 60 * 60 * 1000).unref()

try {
  await app.listen({ port: PORT, host: HOST })
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✖ 連接埠 ${PORT} 已被佔用：NexusPlan 可能已在執行（例如另一個 npm start / npm run dev 視窗）。`)
    console.error(`    請先關閉那個視窗，或查出佔用的程式：netstat -ano | findstr :${PORT}`)
    console.error(`    也可改用其他埠：set PORT=5191 && npm start\n`)
    process.exit(1)
  }
  throw err
}

const urls = lanAddresses()
console.log('\n  NexusPlan 已啟動')
console.log(`  本機：   http://localhost:${PORT}`)
for (const a of urls) console.log(`  區網：   http://${a.address}:${PORT}   (${a.name}${a.virtual ? '，虛擬網卡' : ''})`)
console.log(`  資料庫： ${store.DB_FILE}${store.seeded ? '（已載入初始計畫）' : ''}`)
if (!existsSync(DIST)) console.log('  ※ 尚未 build 前端；開發請用 npm run dev（http://localhost:5173）')
console.log('')
