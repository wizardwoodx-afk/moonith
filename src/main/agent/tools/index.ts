import type { TaskMode } from '@shared/types'
import type { AgentTool } from './types'
import { fileTools } from './files'
import { patchTools } from './patch'
import { shellTools } from './shell'
import { verifyTools } from './verify'
import { webTools } from './web'
import { planTools } from './plan'
import { documentTools } from './documents'
import { browserTools } from './browser'
import { memoryTools } from './memory'
import { studioTools } from './studio'
import { libraryTools } from './library'
import { marketspaceTools, marketspaceReadTools } from './marketspace'
import { codingTools } from './codingTools'
import { archiveTools, listArchiveTool } from './archive'
import { creativeStudioTools } from './creativeStudio'
import { opendesignTools } from './opendesignTools'
import { coworkTools, coworkSearchSkillsTool, coworkQuarantineCheckTool, coworkPerceiveDomTool } from './coworkTools'
import { 
  rookTools, 
  rookVisualGroundTool, 
  rookPermissionModeTool,
  rookSynthesizeResearchTool,
  rookAskClarificationTool
} from './rookTools'
import { 
  rsiralsTools, 
  rsiralsQueryBeliefTool, 
  rsiralsEvaluateRiskTool, 
  rsiralsSimulateActionTool 
} from './rsiralsTools'
import { 
  promeyTools, 
  promeyGenerateBriefTool, 
  promeyTriageStreamTool, 
  promeyRequestApprovalTool, 
  promeyScanDlpTool 
} from './promeyTools'

export function getBuiltinTools(mode: TaskMode): AgentTool[] {
  if (mode === 'chat') {
    const readOnlyFiles = fileTools.filter((tool) =>
      ['list_files', 'read_file', 'search_files'].includes(tool.name)
    )
    /* A Library page is the user's own data, so Chat never saves one directly.
     * Chat may list, read, and hand a draft to review_library_page, which is
     * the only Library write that reaches Chat: with approval 'always' and
     * allowAlways false, the human sees the rendered draft and decides. */
    const gatedLibrary = libraryTools.filter((tool) =>
      ['list_library_pages', 'read_library_page', 'review_library_page'].includes(tool.name)
    )
    /* Chat can read, create, and convert documents: those tools only write
     * artifacts inside the task workspace, never the user's own files. */
    const readOnlyCoding = codingTools.filter((tool) =>
      ['read_file_chunk', 'outline_symbols'].includes(tool.name)
    )
    const readOnlyOpenDesign = opendesignTools.filter((tool) =>
      ['opendesign_compile_tokens', 'impulse_search_skills', 'composio_list_connectors'].includes(tool.name)
    )
    return [
      ...readOnlyFiles,
      ...documentTools,
      ...readOnlyCoding,
      listArchiveTool,
      ...webTools,
      ...browserTools,
      ...planTools,
      ...memoryTools,
      ...marketspaceReadTools,
      ...gatedLibrary,
      ...readOnlyOpenDesign,
      coworkSearchSkillsTool,
      coworkQuarantineCheckTool,
      coworkPerceiveDomTool,
      rookVisualGroundTool,
      rookPermissionModeTool,
      rookSynthesizeResearchTool,
      rookAskClarificationTool,
      rsiralsQueryBeliefTool,
      rsiralsEvaluateRiskTool,
      rsiralsSimulateActionTool,
      promeyGenerateBriefTool,
      promeyTriageStreamTool,
      promeyRequestApprovalTool,
      promeyScanDlpTool
    ]
  }
  return [
    ...fileTools,
    ...patchTools,
    ...codingTools,
    ...archiveTools,
    ...shellTools,
    ...verifyTools,
    ...webTools,
    ...planTools,
    ...documentTools,
    ...studioTools,
    ...creativeStudioTools,
    ...browserTools,
    ...memoryTools,
    ...marketspaceTools,
    ...libraryTools,
    ...opendesignTools,
    ...coworkTools,
    ...rookTools,
    ...rsiralsTools,
    ...promeyTools
  ]
}

export { creativeStudioTools } from './creativeStudio'
export { coworkTools } from './coworkTools'
export { rookTools } from './rookTools'
export { rsiralsTools } from './rsiralsTools'
export { promeyTools } from './promeyTools'
export type { AgentTool } from './types'
