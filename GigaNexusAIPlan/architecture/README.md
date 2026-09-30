# 架構圖資料(architecture/)

GigaNexus 全專案架構圖的**唯一資料來源**。純 JSON 檔、不進資料庫,AI 與工程師直接讀檔就能掌握架構;網站(`npm run arch` 或甘特圖「報告模式 → 架構圖」)由這些檔案即時產生 Mermaid 圖。

> 本資料是各專案 `docs/` 的**摘要**,不是上位規範。與 `giga-api-gateway-bff/docs/`(PRD、ARCHITECTURE、DATABASE)或 `bff/src/db/schema/*.ts` 不一致時,以原始文件 / 程式為準,並回頭修正這裡。

## 1. 檔案

| 檔案 | 內容 | 對應的圖 |
| --- | --- | --- |
| `workspace.json` | 分類、所有專案 / 系統節點、專案之間的關係 | ① 專案彼此的關係(整體架構、各專案的「專案關係」分頁) |
| `projects/<專案 id>.json` | 單一專案的分層、元件、流向;資料庫、資料表、關聯、Redis 鍵 | ② 專案裡面的架構(「內部架構」分頁)③ 資料庫的架構(「資料庫」分頁) |

目前有詳細檔的專案:`giga-api-gateway-bff`。其他專案只在 `workspace.json` 有節點(`"detail": null`),網站上的內部架構 / 資料庫分頁顯示「尚未建立」。

## 2. `workspace.json`

```jsonc
{
  "updated": "2026-09-30",              // 最後更新日期
  "categories": [                        // 左側導覽與圖上配色的分類
    { "id": "platform", "name": "平台核心", "color": "#12a57c", "description": "…" }
  ],
  "relationTypes": [                     // 關係類型;style = solid | thick | dotted(線型)
    { "id": "api", "name": "API 呼叫", "style": "solid", "description": "…" }
  ],
  "nodes": [
    {
      "id": "giga-api-gateway-bff",      // 穩定 ID;是 repo 就用資料夾名稱(Gateway AGENT.md §10.2)
      "name": "giga-api-gateway-bff",
      "label": "Gateway & BFF",          // 圖上第二行短說明
      "category": "platform",            // → categories[].id
      "kind": "repo",                    // repo | service | datastore | external(決定圖形)
      "status": "active",                // active | planned(規劃中畫虛線)
      "repo": "giga-api-gateway-bff",    // 工作區資料夾;不是 repo 填 null
      "detail": "projects/giga-api-gateway-bff.json",  // 沒有詳細檔填 null
      "summary": "…", "tech": ["…"], "endpoints": ["…"], "docs": ["工作區相對路徑"]
    }
  ],
  "relations": [
    { "from": "giga-Portal", "to": "giga-api-gateway-bff", "type": "api", "label": "/api/auth/*", "status": "active" }
  ]
}
```

- 關係方向:`from` 呼叫 / 依賴 / 託管 `to`。同一對專案可有多條不同 `type` 的關係。
- 節點 ID 可作為 Gateway `gw.upstream.archatlas_node_id` 的值,讓路由表連回架構圖。

## 3. `projects/<id>.json`

```jsonc
{
  "id": "giga-api-gateway-bff",          // 必須等於檔名,且在 workspace.json 有同 ID 節點
  "updated": "2026-09-30",
  "summary": "…",
  "sources": ["整理依據的文件 / 程式路徑"],
  "architecture": {
    "direction": "LR",                   // 預設方向 LR | TB
    "layers": [{ "id": "core", "name": "核心邏輯", "description": "…" }],   // 依陣列順序畫
    "components": [{
      "id": "rbac", "name": "RBAC 權限計算", "layer": "core",
      "type": "module",                  // client | gateway | config | api | module | worker | infra | package | datastore | external
      "status": "active", "path": "bff/src/modules/rbac/permission.ts", "description": "…"
    }],
    "flows": [{ "from": "router-plugin", "to": "rbac", "label": "權限", "status": "active" }]
  },
  "database": {
    "notes": ["資料庫限制與慣例"],
    "commonColumns": [{ "name": "created_at", "type": "DATETIME2(3)" }],  // 資料表 audit=true 時附加
    "stores": [{ "id": "gw", "name": "giganexus_gw", "engine": "SQL Server 2012", "access": "讀寫", "description": "…" }],
    "groups": [{ "id": "api", "name": "API 管理", "description": "…" }],
    "tables": [{
      "id": "gw.upstream",               // <schema>.<表名>
      "store": "gw", "group": "api", "status": "active", "audit": true,
      "description": "…",
      "columns": [{ "name": "upstream_id", "type": "INT", "key": "PK", "note": "…", "status": "planned" }]
      //            key:PK | FK | UQ | "PK,FK";status 只在欄位本身尚未建立時填
    }],
    "relations": [{
      "from": "gw.upstream", "to": "gw.api_route",
      "card": "1:N",                     // 1:N | 1:0..1 | 1:1 | N:1(from 對 to)
      "column": "upstream_id", "label": "serves",
      "fk": false,                       // 選填:false = 沒有實體外鍵的邏輯關聯(畫虛線)
      "status": "planned"                // 選填
    }],
    "redisKeys": [{ "key": "gw:routes:version", "type": "String", "ttl": "—", "purpose": "…" }]
  }
}
```

## 4. 維護規則(給 AI 與工程師)

1. **什麼時候要改**:新增 / 移除專案、專案間新增呼叫或相依、模組職責或目錄搬移、資料表 / 欄位 / 外鍵 / Redis 鍵變更(對應各專案 `docs/PROJECT-MAP.md` 需要更新的時機)。
2. **先改原始規範,再改這裡**:例如 Gateway 資料表以 `bff/src/db/schema/*.ts` 與 `docs/DATABASE.md` 為準;規格有、程式還沒做的標 `"status": "planned"`。
3. **ID 不要改名**:其他檔案、網址(`#/arch/<id>/<分頁>`)與 `archatlas_node_id` 會參照它。
4. **新增子專案的詳細架構**:複製 `projects/giga-api-gateway-bff.json` 的結構成 `projects/<id>.json`,再把 `workspace.json` 對應節點的 `detail` 改成 `"projects/<id>.json"`;網站會自動載入,不需改程式。
5. **改完檢查**:在 `GigaNexusAIPlan/` 執行 `npm run arch:check`(參照、ID 重複、分類是否存在),並更新檔案內的 `updated`。
6. 只寫結構與職責,不複製規格全文;細節放在 `docs`、`sources` 指向原始文件。
