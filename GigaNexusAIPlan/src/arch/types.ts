// 架構圖資料型別:對應 architecture/*.json(格式說明見 architecture/README.md)

export type ArchStatus = 'active' | 'planned'

export interface Category {
  id: string
  name: string
  color: string
  description: string
}

export interface RelationType {
  id: string
  name: string
  style: 'solid' | 'thick' | 'dotted'
  description: string
}

export interface WsNode {
  id: string
  name: string
  label: string
  category: string
  kind: 'repo' | 'service' | 'datastore' | 'external'
  status: ArchStatus
  repo: string | null
  detail: string | null
  summary: string
  tech: string[]
  endpoints: string[]
  docs: string[]
}

export interface WsRelation {
  from: string
  to: string
  type: string
  label: string
  status: ArchStatus
}

export interface Workspace {
  version: number
  updated: string
  title: string
  summary: string
  sources: string[]
  categories: Category[]
  relationTypes: RelationType[]
  nodes: WsNode[]
  relations: WsRelation[]
}

export interface Layer {
  id: string
  name: string
  description: string
}

export interface Component {
  id: string
  name: string
  layer: string
  type: 'client' | 'gateway' | 'config' | 'api' | 'module' | 'worker' | 'infra' | 'package' | 'datastore' | 'external'
  status: ArchStatus
  path?: string
  description: string
}

export interface Flow {
  from: string
  to: string
  label?: string
  status: ArchStatus
}

export interface Column {
  name: string
  type: string
  key?: string
  note?: string
  status?: ArchStatus
}

export interface Table {
  id: string
  store: string
  group: string
  status: ArchStatus
  audit?: boolean
  description: string
  columns: Column[]
}

export interface TableRelation {
  from: string
  to: string
  card: '1:N' | '1:0..1' | '1:1' | 'N:1'
  column?: string
  label: string
  fk?: boolean
  status?: ArchStatus
}

export interface RedisKey {
  key: string
  type: string
  ttl: string
  purpose: string
}

export interface ProjectDetail {
  version: number
  id: string
  name: string
  updated: string
  summary: string
  sources: string[]
  architecture: {
    direction: 'LR' | 'TB'
    layers: Layer[]
    components: Component[]
    flows: Flow[]
  }
  database: {
    notes: string[]
    commonColumns: Column[]
    stores: { id: string; name: string; engine: string; access: string; description: string }[]
    groups: { id: string; name: string; description: string }[]
    tables: Table[]
    relations: TableRelation[]
    redisKeys: RedisKey[]
  }
}

export type ArchTab = 'relations' | 'internal' | 'database'

/** 詳細面板顯示的項目 */
export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'component'; projectId: string; id: string }
  | { kind: 'table'; projectId: string; id: string }
