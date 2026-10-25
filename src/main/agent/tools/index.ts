import type { TaskMode } from '@shared/types'
import type { AgentTool } from './types'
import { fileTools } from './files'
import { shellTools } from './shell'
import { webTools } from './web'
import { planTools } from './plan'
import { documentTools } from './documents'
import { browserTools } from './browser'
import { memoryTools } from './memory'
import { studioTools } from './studio'
import { libraryTools } from './library'

export function getBuiltinTools(mode: TaskMode): AgentTool[] {
  if (mode === 'chat') {
    const readOnlyFiles = fileTools.filter((tool) =>
      ['list_files', 'read_file', 'search_files'].includes(tool.name)
    )
    return [...readOnlyFiles, ...webTools, ...browserTools, ...planTools, ...memoryTools, ...libraryTools]
  }
  return [
    ...fileTools,
    ...shellTools,
    ...webTools,
    ...planTools,
    ...documentTools,
    ...studioTools,
    ...browserTools,
    ...memoryTools,
    ...libraryTools
  ]
}

export type { AgentTool } from './types'
