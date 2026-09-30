// 架構圖資料:建置時直接打包 architecture/*.json(不經資料庫、不經 API)
// 新增子專案 = 新增 architecture/projects/<id>.json,並在 workspace.json 的節點填 detail
import workspaceJson from '../../architecture/workspace.json'
import type { ProjectDetail, Workspace } from './types'

export const workspace = workspaceJson as Workspace

const files = import.meta.glob<ProjectDetail>('../../architecture/projects/*.json', { eager: true, import: 'default' })

export const projects: Record<string, ProjectDetail> = {}
for (const p of Object.values(files)) projects[p.id] = p

export const categoryOf = (id: string) => workspace.categories.find((c) => c.id === id)
export const nodeOf = (id: string) => workspace.nodes.find((n) => n.id === id)
