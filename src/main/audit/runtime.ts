import { join } from 'node:path'
import type { AuditEventQuery, RuntimeAuditEvent } from '@shared/audit'
import { getPaths } from '../paths'
import { RuntimeAuditService } from './runtimeService'

let instance: RuntimeAuditService | undefined

function service(): RuntimeAuditService {
  if (!instance) {
    /* The ledger creates its own `audit/` directory on first append, so this
     * path needs no entry in paths.ts — see the deferred note in the report. */
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
  events: (query: AuditEventQuery = {}) => service().events(query),
  /** Pin the signed head anchor. `src/main/index.ts` should call this during
   *  its shutdown sequence so a truncated tail cannot hide in the anchor gap —
   *  see the deferred-change note in the task report. */
  flush: () => service().flush()
}
