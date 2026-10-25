import { getPaths } from '../../paths'
import { sendLibraryChanged } from '../../emitter'
import { LibraryService } from './service'

let instance: LibraryService | undefined

/** Lazy so importing the tool registry never touches Electron app paths early. */
export function getLibraryService(): LibraryService {
  instance ??= new LibraryService({ file: getPaths().libraryFile, onChange: sendLibraryChanged })
  return instance
}

export { LibraryError, LibraryService } from './service'
