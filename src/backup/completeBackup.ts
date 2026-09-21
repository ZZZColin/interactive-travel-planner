import { createServiceConfigBackup, type ServiceConfigBackup } from '../config/serviceConfigBackup'

export const COMPLETE_BACKUP_KIND = 'interactive-travel-complete-backup'
export const COMPLETE_BACKUP_VERSION = 1

export interface PlanBackupPayload {
  schemaVersion: 4
  exportedAt: string
  plans: unknown[]
}

export interface CompleteBackupPayload {
  kind: typeof COMPLETE_BACKUP_KIND
  version: typeof COMPLETE_BACKUP_VERSION
  exportedAt: string
  plans: PlanBackupPayload
  services: ServiceConfigBackup
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createCompleteBackup(planBackup: PlanBackupPayload, includeCredentials = true): CompleteBackupPayload {
  return {
    kind: COMPLETE_BACKUP_KIND,
    version: COMPLETE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    plans: planBackup,
    services: createServiceConfigBackup(includeCredentials),
  }
}

export function parseCompleteBackup(value: unknown): CompleteBackupPayload {
  if (!isRecord(value) || value.kind !== COMPLETE_BACKUP_KIND) throw new Error('这不是行途规划的完整迁移文件')
  if (value.version !== COMPLETE_BACKUP_VERSION) throw new Error(`暂不支持完整迁移文件版本 ${String(value.version)}`)
  if (!isRecord(value.plans) || Number(value.plans.schemaVersion) !== 4 || !Array.isArray(value.plans.plans)) throw new Error('完整迁移文件中的旅行计划数据无效')
  if (!isRecord(value.services)) throw new Error('完整迁移文件中缺少服务配置')
  return {
    kind: COMPLETE_BACKUP_KIND,
    version: COMPLETE_BACKUP_VERSION,
    exportedAt: String(value.exportedAt || new Date().toISOString()),
    plans: {
      schemaVersion: 4,
      exportedAt: String(value.plans.exportedAt || value.exportedAt || new Date().toISOString()),
      plans: value.plans.plans,
    },
    services: value.services as ServiceConfigBackup,
  }
}
