export const SURFACES = [
  { id: 'chat', label: 'Chat' },
  { id: 'company', label: 'Company' },
  { id: 'table', label: 'Table' },
  { id: 'library', label: 'Library' }
] as const

export type Surface = (typeof SURFACES)[number]['id']
export type Space = 'study' | 'table'

export function spaceForSurface(surface: Surface): Space {
  return surface === 'table' ? 'table' : 'study'
}

export function spaceClass(surface: Surface): string {
  return spaceForSurface(surface) === 'table' ? 'space-table' : 'space-study'
}
