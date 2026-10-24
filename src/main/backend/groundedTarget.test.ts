import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeGroundedApplicationPath, safeGroundedWebUrl } from './groundedTarget'

describe('grounded open targets', () => {
  it('allows only absolute HTTP(S) URLs without credentials or control characters', () => {
    expect(safeGroundedWebUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(safeGroundedWebUrl('file:///etc/passwd')).toBeNull()
    expect(safeGroundedWebUrl('javascript:alert(1)')).toBeNull()
    expect(safeGroundedWebUrl('https://user:secret@example.com/')).toBeNull()
    expect(safeGroundedWebUrl('https://example.com/\ncalc')).toBeNull()
  })

  it('rejects application names while allowing a literal absolute path', () => {
    expect(safeGroundedApplicationPath('notepad & calc')).toBeNull()
    const path = resolve('/tmp/application & literal-name')
    expect(safeGroundedApplicationPath(path)).toBe(path)
  })
})
