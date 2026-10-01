# GigaNexus 工作區入口(AGENT.md)

> AI 助手與工程師進入本工作區時**先讀這份**。這裡只做說明與導航;各專案的開發規範寫在各自的 `AGENT.md`。

## 1. 這是什麼

GigaNexus 是公司地端的單一入口平台:員工與系統的流量都經 **Gateway(Nginx + BFF)** 進入,由 BFF 統一登入(AD / 本機帳號)、權限(RBAC)與動態路由,再轉給各應用系統;端點電腦經 `:9443` mTLS 通道連線。

工作區由多個**獨立 repo** 放在同一層目錄組成,彼此以「上一層 + 資料夾名稱」的相對路徑參照。

## 2. 先看架構(最快的方式)

| 想知道 | 看哪裡 |
| --- | --- |
| 有哪些專案、彼此怎麼連 | [`GigaNexusAIPlan/architecture/workspace.json`](GigaNexusAIPlan/architecture/workspace.json) |
| 某個專案內部的模組、分層、請求流向與資料庫 | [`GigaNexusAIPlan/architecture/projects/`](GigaNexusAIPlan/architecture/projects/)`<專案>.json`(目前:`giga-api-gateway-bff`) |
| 上面兩個檔案的欄位意義與維護規則 | [`GigaNexusAIPlan/architecture/README.md`](GigaNexusAIPlan/architecture/README.md) |
| 用圖看(專案關係 / 內部架構 / 資料庫) | 雙擊 `GigaNexusAIPlan/start-architecture.cmd`,或在 `GigaNexusAIPlan/` 執行 `npm install` → `npm run arch`(http://localhost:5191) |
| 全專案總圖(文字版、流量與權限說明) | [`PROJECT-MAP.md`](PROJECT-MAP.md) |

架構資料是純 JSON,**不進資料庫**;AI 直接讀檔即可,不必啟動任何服務。

## 3. 專案導航

| 資料夾 | 定位 | 先讀 |
| --- | --- | --- |
| `giga-api-gateway-bff/` | Gateway:Nginx、BFF、路由表、`@giganexus/web-kit`、`@giganexus/backend-sdk`。**所有專案的上位規範** | `AGENT.md`(跨專案規則在 §10)、`docs/PROJECT-MAP.md` |
| `giga-Portal/` | 員工入口網(`/`,含 `/login`);應用切換起點 | `AGENT.md`、`docs/PROJECT-MAP.md` |
| `GigaItApp/` | IT 管理系統(`/it/`);應用 / 選單 / Tab / 按鈕權限設定、端點管理 | `AGENT.md`、`docs/PROJECT-MAP.md` |
| `RustIt/` | Windows 端點資產蒐集與控管(Agent、托盤) | `README.md`、`docs/PROJECT-MAP.md` |
| `GigaNexusAIPlan/` | 平台建置甘特圖(NexusPlan)與**架構圖網站**、架構資料 | `README.md`、`architecture/README.md` |
| `hello-world/` | 驗證公司 GitLab CI/CD 的範例 | `README.md` |

- 某個資料夾不在你的工作區(沒有 clone)時,明確說明「未讀取」,不要猜內容。
- 規劃中的元件(RustIt 內的 Endpoint Server、Rust Watchdog;各業務系統)記錄在 `workspace.json`,`status` 為 `planned`。
- **時程以 NexusPlan 甘特圖為準**(`GigaNexusAIPlan`,`npm run serve` → http://localhost:5190);各專案文件不另列日期,只記錄狀態。

## 4. 工作規則(摘要)

1. **上位規範**:介面、路由、權限代碼、錯誤代碼、port 以 `giga-api-gateway-bff/docs/` 為準;各專案文件與之不一致時,先指出差異再處理。
2. **只改任務所屬的 repo**;要動其他 repo 先說明並取得同意(`giga-api-gateway-bff/AGENT.md` §10.5)。
3. **找別的系統的 API 先查 BFF 路由表**,不直接連對方主機或資料庫(§10.4)。
4. **架構有變就更新架構資料**:新增專案 / 關係、模組搬移、資料表變更後,同步修改 `GigaNexusAIPlan/architecture/*.json`,並執行 `npm run arch:check`(在 `GigaNexusAIPlan/`)。

## 5. 公司主機連線

| 主機 | IP | 系統 | 用途 | 帳號 |
| --- | --- | --- | --- | --- |
| 主機 1 | 10.10.130.123 | Ubuntu 22.04 | GitLab(`:80`)、Registry(`:5050`)、GitLab git SSH(`:2222`)、Portainer(`:9443`) | `user` |
| 主機 2 | 10.10.130.124 | Windows 10(WSL2 跑 Docker、Runner) | 測試區 Gateway、GitLab Runner | `user` |

AI 以 SSH 金鑰 `~/.ssh/giganexus_ops`(公鑰已放入兩台 `user` 帳號)登入下指令。開發機 `~/.ssh/config` 建議設定:

```sshconfig
# GitLab git 推送(進 GitLab 容器)
Host 10.10.130.123
    Port 2222
    User git
    IdentityFile ~/.ssh/giganexus_ops
    IdentitiesOnly yes

# 主機本身
Host host1
    HostName 10.10.130.123
    Port 22
    User user
    IdentityFile ~/.ssh/giganexus_ops
    IdentitiesOnly yes

Host host2
    HostName 10.10.130.124
    Port 22
    User user
    IdentityFile ~/.ssh/giganexus_ops
    IdentitiesOnly yes
```

- **登入主機 1 用 `ssh host1`,不要用 `ssh user@10.10.130.123`**:後者會套用上面的 `Port 2222`,連進 GitLab 容器的 sshd(OpenSSH 9.6 / Ubuntu 24.04),出現 `Permission denied (publickey)`,主機 1 的 `journalctl -u ssh` 也不會有紀錄。
- 主機 1 的 `user` 執行 sudo 需要密碼;AI 無法自行執行需要 root 的指令,請本人執行。
- 主機 1 開著 **ufw(INPUT 預設 DROP)**,新增對外服務 port 要 `ufw allow`。2026-10-01 已放行 `3389/tcp`(xrdp)給 `10.10.0.0/16`。
- SSH 登不進主機 1 時的救援方式:Portainer(`https://10.10.130.123:9443`)的 `host-rescue` 容器(特權,主機根目錄掛在 `/host`)→ Console 執行 `nsenter --mount=/host/proc/1/ns/mnt --uts=/host/proc/1/ns/uts --ipc=/host/proc/1/ns/ipc --net=/host/proc/1/ns/net -- bash`,即取得主機 root shell(提示字元為 `root@user-virtual-machine`)。
- 主機 2 SSH 登入後預設是 PowerShell;Docker 在 WSL 內,用 `wsl -u root -e docker ...` 執行(WSL 預設帳號沒有 docker 權限)。

## 6. 本 repo(工作區文件)收錄範圍

GitLab `giganexus/giganexusai` 只收:本檔 `AGENT.md`、`PROJECT-MAP.md`、`GigaNexusAIPlan/`。其他專案各自是獨立 repo,不收進來(見 `.gitignore`)。

工程師下載本 repo 只為看架構時,使用 `npm run arch`:只顯示架構圖,不顯示專案進度、不能編輯,也不需要資料庫。
