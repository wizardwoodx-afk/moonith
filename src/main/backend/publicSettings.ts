/**
 * Secret-safe projection for the legacy backend settings surface.
 *
 * This is deliberately a pure function: the renderer must never receive a
 * credential merely because a new nested integration was added to settings.
 */

const SECRET_KEY = /(?:^|[_-])(api[_-]?key|token|secret|password|passwd|private[_-]?key|authorization|credential)(?:$|[_-])/i

export function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2')
  return SECRET_KEY.test(normalized) || /^(?:apikey|accesstoken|refreshtoken|clientsecret)$/i.test(key)
}

/** Deeply clone settings while replacing every credential-shaped value. */
export function redactBackendSecrets(value: unknown, key = ''): unknown {
  if (isSecretKey(key)) return maskSecret(value)
  if (Array.isArray(value)) return value.map((entry) => redactBackendSecrets(entry))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    output[childKey] = redactBackendSecrets(childValue, childKey)
  }
  return output
}
