import { join } from 'node:path'
import type { AuditEventQuery, RuntimeAuditEvent } from '@shared/audit'
import { getPaths } from '../paths'
import { RuntimeAuditService } from './runtimeService'

let instance: RuntimeAuditService | undefined

function service(): RuntimeAuditService {
  if (!instance) {
    instance = new RuntimeAuditService({
      file: join(getPaths().root, 'audit', 'runtime.jsonl')
    })
  }
  return instance
}

/** Lazy application singleton; userData is not resolved during module evaluation. */
export const runtimeAudit = {
  record: (event: RuntimeAuditEvent) => service().record(event),
  status: () => service().status(),
  entries: () => service().entries(),
  events: (query: AuditEventQuery = {}) => service().events(query)
}
