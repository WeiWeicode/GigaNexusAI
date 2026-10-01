# NexusPlan — GigaNexus AI 平台建置甘特圖與架構圖

可編輯的甘特圖，追蹤 [PRD](docs/PRD.md) §8 的 8 大工作流（CI/CD → SSL → Gateway/BFF → IT 管理介面 → 員工入口網 → IT 端點 Agent（Rust + WebSocket）→ AI → 整合舊有服務）。**時程以甘特圖為準**，文件不另列日期。
資料存在本機 SQLite（`data/nexusplan.db`），不連公司資料庫；同一區網的筆電可用 IP 連線做進度報告。

> **只想看架構圖?** 雙擊 `start-architecture.cmd`,或 `npm install` → `npm run arch`(http://localhost:5191)。
> 只顯示架構圖,不顯示專案進度、不能編輯,也不需要資料庫。詳見下方「架構圖」。

## 快速開始

需求：Node.js 22.13 以上（使用內建 `node:sqlite`，不需編譯原生模組）。

```bash
npm install
npm run serve
```

或直接雙擊 `start-nexusplan.cmd`。啟動後終端機會列出網址：

```
本機：   http://localhost:5190
區網：   http://10.10.112.13:5190   (乙太網路)
```

第一次啟動會自動載入 `seed/plan.json` 的初始計畫。

### 讓筆電連得進來（只需做一次）

以**系統管理員**身分開啟 PowerShell，執行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1
```

只開放 TCP 5190 的「網域 / 私人」網路。之後筆電開 `http://<本機IP>:5190`，或畫面右上角「連線」裡的網址 / QR Code。

### 開發模式

```bash
npm run dev
```

- API：`http://localhost:5190`（`node --watch`）
- 前端：`http://localhost:5173`（Vite，已開 `--host`，/api 轉給 5190）

## 操作

| 動作 | 方式 |
| --- | --- |
| 調整日期 | 拖曳甘特條；拖曳左右邊緣調整工期 |
| 更新進度 | 拖曳條下方 ▲，或點任務開側欄（滑桿、快速 0/25/50/75/100%、進度備註） |
| 建立相依 | 滑到任務條，拖曳右側 ○ 到另一個任務 |
| 新增任務 | 「新增任務」按鈕，或在時間軸空白處雙擊 |
| 連動順延 | 移動前置任務造成重疊時，底部提示「一併順延」 |
| 復原 / 重做 | Ctrl+Z / Ctrl+Y |
| 捲到今天 | T |
| 報告模式 | R（全螢幕 F）：整體 / 各工作流完成度、延遲、里程碑、本期更新；頂列切換「架構圖」 |
| 匯出 | PNG、列印 / PDF、CSV（Excel）、JSON 完整備份；JSON 匯入 |

### 延遲判定

- 計畫進度 = 今天在工期中的比例（例如工期過半 → 50%）。
- 實際進度落後計畫超過 10 個百分點，或過了結束日還沒完成 → 標為延遲（⚠）。

## 編輯權限（PIN）

- 主機本機一律可編輯。
- 在「連線」視窗可設定編輯 PIN：設了以後，其他裝置預設唯讀，要輸入 PIN 才能修改（避免會議中誤改）。
- 沒設 PIN 時，同一區網內任何人都能編輯。

## 資料與備份

- 資料庫：`data/nexusplan.db`（WAL 模式）。
- 每次啟動與每 24 小時自動備份到 `data/backup/`，保留最近 30 份；匯入 JSON 前也會先備份。
- 搬到其他電腦：把整個資料夾（含 `data/`）複製過去即可。
- 要重新開始：停止服務後刪除 `data/nexusplan.db*`，下次啟動會重新載入 `seed/plan.json`。

## 專案結構

```
server/        Fastify 服務（API + 靜態頁面）、SQLite 資料層
seed/          初始計畫（由甘特圖匯出，PRD §8）
src/           Vue 3 + TypeScript 前端
  components/  GanttChart、TaskDrawer、ReportSummary、ConnectDialog…
  stores/      Pinia（狀態、復原/重做、同步）
  utils/       日期、進度 / 延遲計算
architecture/  架構圖資料(workspace.json、projects/<專案>.json、README 格式說明)
src/arch/      架構圖資料載入與 Mermaid 產生器;components/arch/ 架構圖頁面
scripts/       防火牆設定、架構資料檢查(check-architecture.mjs)
docs/PRD.md    產品需求文件
```
