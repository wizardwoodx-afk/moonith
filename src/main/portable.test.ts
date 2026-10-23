import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { portableDataDir } from './portable'

const exec = join('C:', 'apps', 'selfimpulse', 'app', 'SelfImpulse.exe')

describe('portableDataDir', () => {
  it('returns null when the flag is absent', () => {
    expect(portableDataDir(exec, () => false)).toBeNull()
  })

  it('returns the data folder beside the app folder', () => {
    expect(portableDataDir(exec, () => true)).toBe(join('C:', 'apps', 'selfimpulse', 'data'))
  })

  it('looks for the flag beside the app folder', () => {
    const seen: string[] = []
    portableDataDir(exec, (path) => {
      seen.push(path)
      return true
    })
    expect(seen).toEqual([join('C:', 'apps', 'selfimpulse', 'portable.flag')])
  })
})
