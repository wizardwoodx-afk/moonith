export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  providerTest: 'provider:test',
  providerFetchModels: 'provider:fetch-models',

  tasksList: 'tasks:list',
  taskCreate: 'task:create',
  taskGet: 'task:get',
  taskDelete: 'task:delete',
  taskSend: 'task:send',
  taskSteer: 'task:steer',
  taskStop: 'task:stop',
  taskResume: 'task:resume',
  taskUpdate: 'task:update',
  taskAddFolder: 'task:add-folder',
  taskRemoveFolder: 'task:remove-folder',
  pickFolder: 'dialog:pick-folder',
  pickFiles: 'dialog:pick-files',

  approvalRespond: 'approval:respond',
  artifactOpen: 'artifact:open',
  artifactReveal: 'artifact:reveal',

  scheduleList: 'schedule:list',
  scheduleCreate: 'schedule:create',
  scheduleUpdate: 'schedule:update',
  scheduleDelete: 'schedule:delete',
  scheduleRun: 'schedule:run',

  mcpList: 'mcp:list',
  mcpUpsert: 'mcp:upsert',
  mcpRemove: 'mcp:remove',
  mcpRestart: 'mcp:restart',
  mcpReaPreset: 'mcp:rea-preset',

  browserShow: 'browser:show',

  skillsList: 'skills:list',
  skillsSearch: 'skills:search',
  skillsInstall: 'skills:install',
  skillsRead: 'skills:read',
  skillsCreate: 'skills:create',
  skillsRemove: 'skills:remove',

  memoryList: 'memory:list',
  memoryAdd: 'memory:add',
  memoryRemove: 'memory:remove',
  memoryImport: 'memory:import',

  usageSummary: 'usage:summary',

  composioState: 'composio:state',
  composioSave: 'composio:save',

  channelState: 'channels:state',
  channelUpsert: 'channels:upsert',
  channelRemove: 'channels:remove',
  channelRestart: 'channels:restart',

  subAgentsList: 'subagents:list',

  tableGetState: 'table:get-state',
  tableHost: 'table:host',
  tableJoin: 'table:join',
  tableSetGoal: 'table:set-goal',
  tablePropose: 'table:propose',
  tableTurnKey: 'table:turn-key',
  tableWithdraw: 'table:withdraw',
  tablePublish: 'table:publish',
  tableLeave: 'table:leave',

  eventTask: 'event:task',
  eventApproval: 'event:approval'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
