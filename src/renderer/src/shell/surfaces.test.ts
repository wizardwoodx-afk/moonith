import { describe, expect, it } from 'vitest'
import { SURFACES, modeForSurface, spaceForSurface } from './surfaces'

describe('surfaces', () => {
  it('has four surfaces and two spaces', () => {
    expect(SURFACES.map((item) => item.id)).toEqual(['chat', 'company', 'table', 'library'])
    expect(new Set(SURFACES.map((item) => spaceForSurface(item.id))).size).toBe(2)
  })

  it('keeps private surfaces in Study and the shared surface in Table', () => {
    expect(spaceForSurface('chat')).toBe('study')
    expect(spaceForSurface('library')).toBe('study')
    expect(spaceForSurface('company')).toBe('study')
    expect(spaceForSurface('table')).toBe('table')
  })

  it('labels the shared surface as Collab and private surfaces as Self', () => {
    expect(modeForSurface('chat')).toBe('Self')
    expect(modeForSurface('library')).toBe('Self')
    expect(modeForSurface('company')).toBe('Self')
    expect(modeForSurface('table')).toBe('Collab')
  })
})
