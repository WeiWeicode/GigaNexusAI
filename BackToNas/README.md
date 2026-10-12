# GigaNexusAI 專案 NAS 備份與拉取工具 (`BackToNas`)

本目錄提供 GigaNexusAI 全專案至公司內部 NAS (`\\10.10.130.31\docker-folder\code\GigaNexusAI`) 的**鏡像備份**與**同仁拉取**執行工具。

---

## 📁 檔案清單與用途

| 檔案名稱 | 適用對象 | 用途說明 |
| :--- | :--- | :--- |
| **`備份至NAS.bat`** (或 `backup.bat`) | 專案負責人 | **每日下班雙擊執行**。自動以 8 執行緒高速鏡像同步專案至 NAS，並自動清洗 GitHub 設定、保留 GitLab。 |
| **`backup.ps1`** | PowerShell 核心 | 備份底層邏輯（連線驗證、Robocopy 多執行緒鏡像、Git 設定清洗、.env 完整性檢查）。 |
| **`從NAS拉取專案.bat`** (或 `pull.bat`) | 團隊同仁 | **同仁雙擊執行**。會主動詢問同仁欲拉取至本機的目錄路徑（預設 `D:\GigaNexusAI`），自動拉取完整程式與 `.env`。 |
| **`pull.ps1`** | PowerShell 核心 | 拉取底層邏輯（互動詢問目標路徑、路徑合法性檢核、多執行緒拉取、後續開發提示）。 |
| **`README.md`** | 全員 | 本使用說明文件。 |

---

## 🎯 備份與排除規則

依據專案規範與配置，本工具嚴格執行以下規則：

### ✅ 完整備份的項目
1. **全專案核心程式碼**：Gateway & BFF、Portal、GigaItApp、RustIt、giga-observe、giga-file-service、GigaNexusAIPlan、hello-world 等。
2. **所有環境變數檔案 (`.env`)**：完整備份各專案的 `.env`、`.env.*` 設定檔，同仁拉取後無需額外設定連線憑證即可啟動開發環境。
3. **公司 GitLab 設定**：保留所有儲存庫之公司 GitLab remote (`ssh://git@10.10.130.123:2222/giganexus/...`)，並預設將 `origin` 指向 GitLab。
4. **憑證與說明文件**：`companySSL/` 憑證檔、`AGENT.md`、`PROJECT-MAP.md` 等。

### ❌ 嚴格排除的項目
1. **GitHub 個人設定檔**：
   - 自動清除所有 `.git/config` 中指向個人 GitHub 的 remote 區塊 (`github.com/WeiWeicode/...`)。
   - 排除 `.github` 資料夾。
   - 確保備份到 NAS 後，同仁絕不會向個人 GitHub 進行 pull/push。
2. **舊專案與參考用專案**：
   - 舊版 Solar 入口網站：`old_PortalSolar/`
   - 舊版 Solar 拉取腳本：`pull_portal_solar.py`
   - 舊版/參考用 E-Learning 專案：`Elearning_Vue/`
3. **套件庫與編譯產物**（大幅縮短傳輸時間，避免 SMB 傳輸數十萬個瑣碎檔案）：
   - `node_modules/`
   - Rust 編譯目錄：`target/`
   - 前端打包輸出：`dist/`、`dist-arch/`
   - 暫存與快取：`.claude/`、`.gemini/`、`.system_generated/`、`*.tgz`、`*.tar.gz`、`*.tmp`、`*.log`。

---

## 🚀 使用方式

### 1. 每日下班手動備份 (負責人)
1. 每日下班前，雙擊執行 **`備份至NAS.bat`**。
2. 終端機將依序執行：
   - 檢查 NAS 連線 (`\\10.10.130.31\docker-folder`)。
   - 啟動多執行緒鏡像同步（僅傳輸當日異動的檔案，平時約 5 ~ 15 秒即可完成）。
   - 自動清洗 `.git/config` 中的 GitHub 設定，確認 GitLab 完整保留。
   - 逐一驗證各專案 `.env` 完整性。
3. 看到綠色 `🎉 GigaNexusAI 專案備份成功！` 提示後，按任意鍵關閉視窗。

---

### 2. 同仁從 NAS 拉取專案 (團隊同仁)
同仁有兩種方式執行拉取：
- **方式 A (直接在 NAS 上執行)**：
  1. 檔案總管開啟 `\\10.10.130.31\docker-folder\code\GigaNexusAI\BackToNas`
  2. 雙擊 **`從NAS拉取專案.bat`**
- **方式 B (複製檔案後執行)**：
  1. 將 `BackToNas` 資料夾複製到本機任何位置
  2. 雙擊 **`從NAS拉取專案.bat`**

**執行步驟**：
1. 視窗會提示輸入本機目標目錄，例如：
   ```text
   請輸入欲將專案放置於本機的完整目錄路徑
   (建議格式: D:\GigaNexusAI 或 C:\Projects\GigaNexusAI)
   直接按 [Enter] 鍵將採用預設路徑: D:\GigaNexusAI
   目標路徑: 
   ```
2. 直接按 **Enter** 採用預設值（或手動輸入自訂路徑後按 Enter）。
3. 工具自動完成下載、驗證 `.env` 檔案。
4. 拉取完成後，進入您負責的專案安裝套件即可開始開發：
   ```bash
   # 例：啟動架構圖檢視
   cd D:\GigaNexusAI\GigaNexusAIPlan
   npm install
   npm run arch

   # 例：前端 Portal 開發
   cd D:\GigaNexusAI\giga-Portal\frontend
   npm install
   npm run dev
   ```

---

## ⏰ (選用) 設定 Windows 工作排程器每日定時備份

若未來希望在固定時間自動備份（例如每天 18:30），可透過 Windows 工作排程器建立：

1. 按 `Win + R` 輸入 `taskschd.msc` 開啟「工作排程器」。
2. 右側點選「**建立工作**」：
   - **一般**：
     - 名稱：`GigaNexusAI_Backup_To_NAS`
     - 勾選「只有使用者登入時才執行」或「不論使用者登入與否均執行」。
   - **觸發程序**：
     - 新增觸發程序 ->「依排程」->「每天」-> 設定時間為 `18:30:00`。
   - **動作**：
     - 動作：啟動程式
     - 程式或指令碼：`powershell.exe`
     - 新增引數：`-NoProfile -ExecutionPolicy Bypass -File "D:\檔案分享\程式碼\GigaNexusAI\BackToNas\backup.ps1"`
     - 開始位置：`D:\檔案分享\程式碼\GigaNexusAI\BackToNas`
3. 點選「確定」儲存即可。
