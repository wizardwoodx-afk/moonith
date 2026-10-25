import { join } from 'node:path'
import { getDefaultAuditKey } from '../../audit/keyProvider'
import { runtimeAudit } from '../../audit/runtime'
import { requireLocalEnterprise } from '../../enterpriseControl/runtime'
import { getPaths } from '../../paths'
import { VerifiedOutcomeService } from './service'

let instance: VerifiedOutcomeService | undefined

/** Lazy in-process singleton; no service, sidecar, listener, or second agent loop. */
export function verifiedOutcomes(): VerifiedOutcomeService {
  if (!instance) {
    instance = new VerifiedOutcomeService({
      file: join(getPaths().root, 'enterprise', 'verified-outcomes.json'),
      loadKey: getDefaultAuditKey,
      authorizeAdmin: () =>
        requireLocalEnterprise('enterprise.manage', 'enterprise', 'verified-outcomes'),
      audit: (event) => {
        const { actor = 'system', actorId = 'verified-outcomes', ...rest } = event
        return runtimeAudit.record({ actor, actorId, ...rest })
      }
    })
  }
  return instance
}
