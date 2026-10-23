import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { moveRejection } from './files'

const root = join('/work', 'proj')

describe('moveRejection', () => {
  it('rejects moving a folder into its own descendant', () => {
    expect(moveRejection(root, join(root, 'sub'))).toBe('Cannot move a folder into itself.')
    expect(moveRejection(root, join(root, 'sub', 'deeper'))).toBe(
      'Cannot move a folder into itself.'
    )
  })

  it('allows moving a child up into its parent', () => {
    expect(moveRejection(join(root, 'sub'), root)).toBeNull()
    expect(moveRejection(join(root, 'sub', 'file.txt'), join(root, 'sub'))).toBeNull()
  })

  it('rejects identical source and destination', () => {
    expect(moveRejection(root, root)).toBe('Source and destination are the same path.')
    expect(moveRejection(root, `${root}/`)).toBe('Source and destination are the same path.')
  })

  it('allows an unrelated sibling destination', () => {
    expect(moveRejection(join(root, 'a'), join(root, 'b'))).toBeNull()
  })

  it('allows a destination that only shares a name prefix', () => {
    expect(moveRejection(root, `${root}-archive`)).toBeNull()
  })
})
