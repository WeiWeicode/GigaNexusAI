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
| 程式碼怎麼部署到測試區 / 正式區(GitLab CI/CD、合併與手動上架規則、各專案現況) | [`GigaNexusAIPlan/architecture/deployment.json`](GigaNexusAIPlan/architecture/deployment.json);圖在架構圖網站左側「部署流程(CI/CD)」 |
| 上面幾個檔案的欄位意義與維護規則 | [`GigaNexusAIPlan/architecture/README.md`](GigaNexusAIPlan/architecture/README.md) |
| 用圖看(專案關係 / 內部架構 / 資料庫) | 雙擊 `GigaNexusAIPlan/start-architecture.cmd`,或在 `GigaNexusAIPlan/` 執行 `npm install` → `npm run arch`(http://localhost:5191) |
| 全專案總圖(文字版、流量與權限說明) | [`PROJECT-MAP.md`](PROJECT-MAP.md) |

架構資料是純 JSON,**不進資料庫**;AI 直接讀檔即可,不必啟動任何服務。

## 3. 專案導航

| 資料夾 | 定位 | 先讀 |
| --- | --- | --- |
| `giga-api-gateway-bff/` | Gateway:Nginx、BFF、路由表、`@giganexus/web-kit`、`@giganexus/backend-sdk`。**所有專案的上位規範** | `AGENT.md`(跨專案規則在 §10)、`docs/PROJECT-MAP.md` |
| `giga-Portal/` | 員工入口網(`/`,含 `/login`);應用切換起點。前端框架已上測試區(2026-10-12),下一階段 portal-api | `AGENT.md`、`docs/HANDOFF.md`、`docs/PROJECT-MAP.md` |
| `GigaItApp/` | IT 管理系統(`/it/`);應用 / 選單 / Tab / 按鈕權限設定、端點管理 | `AGENT.md`、`docs/PROJECT-MAP.md` |
| `RustIt/` | Windows 端點資產蒐集與控管:`RustAgent/`(Rust:Agent、托盤)、`ItAgentBack/`(Node.js:Endpoint Server,測試區 2026-10-07 起運作) | `AGENT.md`、`docs/PROJECT-MAP.md`、`docs/INTEGRATION-PLAN.md` |
| `giga-observe/` | 觀測服務(W9,測試區已上線):API / Nginx / 前端監控的資料後端,由 DevOpsDiagram 複製;畫面在 GigaItApp | `AGENT.md`、`giga-api-gateway-bff/docs/MONITORING-PLAN.md` |
| `giga-file-service/` | 附件服務(W11,2026-10-08 測試區上線:F1 檔案 API、F2 NAS 備份、F6 BPM 附件 191 / 190;F4 / F7 規劃):`file-api` :51272,UUID 上傳 / 下載、WSL + NAS 備份、BPM 附件唯讀、舊系統對照與舊格式相容層;畫面在 GigaItApp「Gateway 管理 › 檔案管理」 | `AGENT.md`、`docs/HANDOFF.md`、`docs/PRD.md`、`docs/PROJECT-MAP.md` |
| `GigaNexusAIPlan/` | 平台建置甘特圖(NexusPlan)與**架構圖網站**、架構資料 | `README.md`、`architecture/README.md` |
| `hello-world/` | 驗證公司 GitLab CI/CD 的範例 | `README.md` |

- 某個資料夾不在你的工作區(沒有 clone)時,明確說明「未讀取」,不要猜內容。
- 規劃中的元件(Rust Watchdog、托盤;各業務系統)記錄在 `workspace.json`,`status` 為 `planned`;RustIt `ItAgentBack`(endpoint-server)於 2026-10-07 改為 `active`。
- **時程以 NexusPlan 甘特圖為準**(`GigaNexusAIPlan`,`npm run serve` → http://localhost:5190);各專案文件不另列日期,只記錄狀態。

## 4. 工作規則(摘要)

1. **上位規範**:介面、路由、權限代碼、錯誤代碼、port 以 `giga-api-gateway-bff/docs/` 為準;各專案文件與之不一致時,先指出差異再處理。
2. **只改任務所屬的 repo**;要動其他 repo 先說明並取得同意(`giga-api-gateway-bff/AGENT.md` §10.5)。
3. **找別的系統的 API 先查 BFF 路由表**,不直接連對方主機或資料庫(§10.4)。
4. **架構有變就更新架構資料**:新增專案 / 關係、模組搬移、資料表變更後,同步修改 `GigaNexusAIPlan/architecture/*.json`,並執行 `npm run arch:check`(在 `GigaNexusAIPlan/`)。
5. **AI 分工**:寫程式、寫測試、寫文件交給 Claude;Gemini 只執行測試、寫報告與做非邏輯性修改,不能動 CI/CD、Docker(見 §7)。
6. **Claude 子代理**:Claude 開工前確認 `~/.claude/agents/` 有 6 個子代理,缺少時先詢問使用者是否建立(見 §8)。
7. **Git 分支與推送**:開發在 `feature/*` 等工作分支;`develop`(測試區)/ `main`(正式區)只透過 GitLab Merge Request 由 Maintainer 合併,AI 不得推送 `develop` / `main`、不得 force push(`giga-api-gateway-bff/AGENT.md` §10.10)。同仁第一次設定與流程見 [`BackToNas/同仁開發指南.md`](BackToNas/同仁開發指南.md)。
8. **多人協作**:開發新功能前先拉取最新程式碼再建分支;合併遇到衝突時 AI 先停下,列出影響的功能與邏輯,由開發者告知專案擁有者討論後再處理(見 §9)。

## 5. 公司主機連線

| 主機 | IP | 系統 | 用途 | 帳號 |
| --- | --- | --- | --- | --- |
| 主機 1 | 10.10.130.123 | Ubuntu 22.04 | GitLab(`:80`)、Registry(`:5050`)、GitLab git SSH(`:2222`)、Portainer(`:9443`) | `user` |
| 主機 2 | 10.10.130.124 | Windows 10(WSL2 跑 Docker、Runner) | 測試區 Gateway(Traefik 80 / 443 / 9443;`:9443` 防火牆暫時只開放 10.10.112.13 與 10.10.130.124(本機 Hyper-V 測試 VM 經 Default Switch NAT 後的來源))、GitLab Runner、RustIt endpoint-server | `user` |
| 主機 3 | 10.10.130.122 | Windows 10(`DESKTOP-26TER17`;WSL2 Ubuntu 跑 Docker) | 正式區主機(`giganexus.gigasolar.com.tw`):Gateway(Traefik 80 / 443 / 9443;`:9443` 防火牆只開放 `10.10.0.0/16`)、giga-observe-prod、舊系統容器(BPM、MESWeb、GeneralBackend 等,port 5121–5210、RustDesk 21115–21119) | `user` |

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

Host host3 10.10.130.122
    HostName 10.10.130.122
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
- 主機 3(`10.10.130.122`)登入帳號為 `user`(屬於本機 Administrators 群組,所以公鑰放在 `C:\ProgramData\ssh\administrators_authorized_keys`);用 `Administrator` 登入會被中斷連線(`Connection reset`)。SSH 登入後預設是 PowerShell;Docker 在 WSL Ubuntu 內,和主機 2 一樣用 `wsl -u root -e docker ...` 執行。
- 主機 3 的 WSL **查不到外部 DNS**(`apt-get`、Docker Hub 都不通);映像從 GitLab Registry(`10.10.130.123:5050`)拉,系統套件要從主機 2 的 apt 快取複製 `.deb` 安裝。
- 主機 3 的 **舊系統不能受影響**:改防火牆或 Docker 設定前,先確認舊系統的 port 仍可連線。防火牆規則 `Docker-WSL2-AllServices-TCP`(舊系統 port,來源不限)、`Docker-Portainer`(8000、9000、9444,只開放 `10.10.112.0/24`)、`GigaNexus-Agent-9443`;2026-10-29 收緊前的完整備份在 `C:\Users\user\fw-backup-20261029.wfw`(`netsh advfirewall import` 還原)。
- 主機 3 的 NAS 掛載(`/etc/fstab`):`/mnt/nas-docker`(`docker-backup`,file-api 備份寫 `giga-files/prod/`)、`/srv/giganexus/nas-rustit`(RustIT 唯讀,`rustit-upload`,兩區共用帳號見 RustIt `docs/S1-SIGNING-DESIGN.md` §1)。

## 6. 本 repo(工作區文件)收錄範圍

GitLab `giganexus/giganexusai` 只收:本檔 `AGENT.md`(與指向它的 `GEMINI.md`、`CLAUDE.md`)、`PROJECT-MAP.md`、`GigaNexusAIPlan/`、`BackToNas/`。其他專案各自是獨立 repo,不收進來(見 `.gitignore`)。

工程師下載本 repo 只為看架構時,使用 `npm run arch`:只顯示架構圖,不顯示專案進度、不能編輯,也不需要資料庫。

## 7. AI 分工(Claude / Gemini)

適用本工作區所有專案(各專案 `AGENT.md` 同步收錄;以 `giga-api-gateway-bff/AGENT.md` §10.8 為準)。

寫程式、寫測試、寫文件由 **Claude** 負責;**Gemini** 只負責執行測試、撰寫測試報告,以及非邏輯性的修改。Gemini 開始動手前,先確認工作在下表 Gemini 欄是 ✅。

| 工作 | Claude | Gemini |
| --- | --- | --- |
| 寫程式(新功能、業務邏輯、API、權限、資料存取、狀態管理、修 bug、重構) | ✅ | ❌ |
| 寫測試(單元 / 整合 / E2E 測試碼、測試用 fixture 的邏輯) | ✅ | ❌ |
| 寫文件(`AGENT.md`、`README.md`、`docs/`、`PROJECT-MAP.md`、架構 JSON、修正紀錄) | ✅ | ❌(測試報告除外) |
| 執行測試(既有的 `npm test`、`test:int`、E2E、`cargo test` 等)並撰寫測試報告 | ✅ | ✅ |
| 非邏輯性修改:前端 mock / 假資料、版面與樣式(CSS、間距、顏色、排版)、畫面文案錯字 | ✅ | ✅ |
| CI/CD 與容器、部署設定 | ✅ | ❌ **禁止** |

**Gemini 禁止修改**(即使只改一行):

- CI/CD:`.gitlab-ci.yml`、`ci-templates/`、Runner 設定。
- 容器與部署:`Dockerfile*`、`docker-compose*`、`.dockerignore`、`deploy/`、`nginx/`、部署腳本、`.env*`、`Web.config` / 發佈設定。
- 相依與建置設定:`package.json`(含 scripts)、lock 檔、`Cargo.toml`、`tsconfig*.json`、`vite.config.*`。
- 資料庫:schema、migration、seed。
- 測試程式碼:測試失敗時**不得**為了讓測試通過而修改測試或程式、跳過測試、調整門檻;把失敗寫進報告,交給 Claude 處理。

**測試報告**(Gemini 執行測試後必寫):

- 位置:該 repo 的 `docs/test-reports/YYYY-MM-DD-<主題>.md`。
- 內容:1. 環境(分支 / commit、部署區、執行的指令)2. 結果(通過 / 失敗 / 略過數量)3. 失敗項目(測試名稱、錯誤訊息摘錄)4. **可能問題**:推測原因、相關檔案與行號、重現步驟、影響範圍 5. 建議交給 Claude 處理的項目。
- 測試全部通過也要寫,並列出觀察到的潛在風險(警告訊息、偶發失敗、執行過慢等)。

**判斷不了是否屬於「非邏輯性」時,一律視為邏輯修改**:不動程式,寫進報告交給 Claude。

## 8. Claude 子代理

適用本工作區所有專案(各專案 `AGENT.md` 同步收錄;以 `giga-api-gateway-bff/AGENT.md` §10.9 為準)。**只適用 Claude Code**,Gemini 等其他 AI 略過本節。

子代理定義放在**使用者層級** `~/.claude/agents/`(Windows:`%USERPROFILE%\.claude\agents\`),所有專案共用;範本在 `giga-api-gateway-bff/docs/claude-agents/`。

| 子代理 | 用途 | 模型 | 權限 |
| --- | --- | --- | --- |
| `explore` | 快速搜尋、分析大型程式碼庫結構 | `haiku`(Haiku 5.5) | 唯讀 |
| `code-reviewer` | 檢查程式碼品質、命名與最佳實踐 | `sonnet`(Sonnet 5.5) | 唯讀 |
| `security-auditor` | 偵測安全漏洞(硬編碼密鑰、注入、權限缺漏、不安全的 API) | `opus`(Opus 5.5) | 唯讀 |
| `debugger` | 追蹤錯誤日誌,做根本原因分析 | `sonnet`(Sonnet 5.5) | 唯讀 |
| `test-runner` | 執行既有測試並分析覆蓋率 | `haiku`(Haiku 5.5) | 唯讀(只執行指令,不改檔) |
| `refactor-assistant` | 安全地重構與拆分模組 | `sonnet`(Sonnet 5.5) | 可修改檔案 |

**開工前檢查**(每個工作階段一次):

1. 確認 `~/.claude/agents/` 有上表 6 個檔案(檔名是「子代理名稱 + `.md`」)。
2. 缺少任何一個時,**先列出缺少的子代理,詢問使用者是否建立**;未經同意不要建立。使用者不建立時照常工作,改由主對話自己做。
3. 使用者同意後,從範本複製缺少的檔案;**已存在的同名檔不覆蓋**(內容不同時列出差異,詢問是否更新)。在工作區根目錄執行:

   ```bash
   mkdir -p ~/.claude/agents && cp -n giga-api-gateway-bff/docs/claude-agents/*.md ~/.claude/agents/
   ```

   沒有 clone `giga-api-gateway-bff` 時,說明「範本未讀取」,詢問使用者要先 clone,還是依上表欄位建立。
4. 建立後告訴使用者:**重新開啟 Claude Code 工作階段**後子代理才會載入。

何時使用哪個子代理、委派時要交代的規則,見 `giga-api-gateway-bff/AGENT.md` §10.9。

## 9. Git 協作規範(多人開發)

適用本工作區所有 repo,開發者與 AI(Claude / Gemini)都要遵守。分支與推送權限仍以 §4 第 7 點與 `giga-api-gateway-bff/AGENT.md` §10.10 為準。

### 9.1 開發新功能前,先拉取最新程式碼

1. 確認工作目錄乾淨(`git status`)。有未提交的變更時,先 commit 到自己的工作分支或詢問開發者;**AI 不得自行 `stash`、`reset`、`checkout --` 丟棄變更**。
2. 取得遠端最新狀態,並從**最新的基準分支**建立工作分支(有 `develop` 的 repo 以 `develop` 為基準,沒有的以 `main` 為基準):

   ```bash
   git fetch gitlab
   git switch -c feature/<主題> gitlab/develop   # 沒有 develop 的 repo 改用 gitlab/main
   ```

3. 不要從別人的工作分支或過期的本機分支開新功能;接續既有分支時,先 `git pull --ff-only` 更新到遠端最新。
4. 開發期間基準分支有新的合併時,在開 MR 前把基準分支合進自己的分支(`git fetch gitlab && git merge gitlab/develop`),在本機先處理衝突與測試,不要把衝突留給 Maintainer。
5. AI 接到開發任務時,第一步先 `git fetch` 並回報目前分支落後基準分支多少個 commit;落後時先更新再動手。

### 9.2 合併遇到衝突:AI 先停下,列出影響,由開發者與專案擁有者討論

`merge`、`rebase`、`pull`、`cherry-pick`,或 GitLab MR 顯示衝突時,一律依下列步驟:

1. **AI 立即停止**:不自行解衝突、不使用 `-X ours` / `-X theirs` 或整檔取某一方、不 `--abort`、不 force push,保持衝突狀態等候指示。
2. **AI 列出衝突報告**給開發者,內容包含:
   - 衝突檔案清單,以及每個衝突區塊雙方各改了什麼(來源分支 / commit / 作者)。
   - **影響哪些功能或邏輯**:例如 API 介面、路由、權限代碼、錯誤代碼、資料庫 schema / migration、設定檔、CI/CD、共用套件(`@giganexus/*`),以及會受影響的畫面或其他 repo。
   - 可行的解法選項(保留哪一方、如何整合)與各自的風險;不替開發者做決定。
3. **開發者先告知專案擁有者**,討論並確認要保留哪些變更、影響哪些項目後,再指示 AI(或自行)解衝突。
4. 解完衝突後:執行該 repo 的測試(與 `npm run arch:check`,若動到架構資料),並在 commit message 或 MR 說明記錄**衝突檔案、決議內容與參與討論的人**。
