import { agentName } from './localProfile'
export const SETTINGS_PANES = [
  'profile',
  'general',
  'mode-config',
  'permissions',
  'task-monitor',
  'shortcuts',
  'appearance',
  'colors',
  'moon',
  'providers',
  'instructions',
  'agent',
  'agent-team',
  'rook',
  'skills',
  'learning',
  'sub-agents',
  'mcp',
  'impdesk',
  'connectors',
  'design-systems',
  'channels',
  'gateway',
  'work-files',
  'desktop',
  'enterprise',
  'audit',
  'about'
] as const

export type SettingsPaneId = (typeof SETTINGS_PANES)[number]

export type SettingsGroup = 'Personal' | 'Agents' | 'Integrations' | 'SelfImpulse'

export type SettingsStatus = 'live' | 'preview' | 'planned'

export interface SettingsNavItem {
  id: SettingsPaneId
  label: string
  group: SettingsGroup
  summary: string
  keywords: string[]
  status: SettingsStatus
  badge?: string
  hidden?: boolean
  parent?: SettingsPaneId
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: 'profile',
    label: 'Profile',
    group: 'Personal',
    summary: 'Your name, seat, and activity on this device.',
    keywords: ['account', 'avatar', 'name', 'identity', 'usage', 'stats', 'activity', 'local'],
    status: 'live'
  },
  {
    id: 'general',
    label: 'General',
    group: 'Personal',
    summary: 'Defaults for new work.',
    keywords: ['overview', 'home', 'defaults', 'model', 'provider', 'workspace', 'summary'],
    status: 'live'
  },
  {
    id: 'mode-config',
    label: 'Modes',
    group: 'Personal',
    summary: 'Self and Collab.',
    keywords: ['self', 'collab', 'team', 'mode', 'captain', 'peer', 'table', 'seats'],
    status: 'live',
    hidden: true,
    parent: 'general'
  },
  {
    id: 'permissions',
    label: 'Permissions',
    group: 'Personal',
    summary: 'What runs without asking.',
    keywords: [
      'approval',
      'gates',
      'shell',
      'terminal',
      'commands',
      'safety',
      'manual',
      'auto',
      'skip',
      'integrated acceptance'
    ],
    status: 'live'
  },
  {
    id: 'task-monitor',
    label: 'Tasks',
    group: 'Personal',
    summary: 'Local task history.',
    keywords: ['tasks', 'runs', 'history', 'queue', 'status', 'monitor', 'sessions'],
    status: 'live',
    hidden: true,
    parent: 'profile'
  },
  {
    id: 'shortcuts',
    label: 'Keyboard',
    group: 'Personal',
    summary: 'Every key.',
    keywords: ['keys', 'keyboard', 'bindings', 'hotkeys', 'ctrl'],
    status: 'live',
    hidden: true,
    parent: 'about'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    group: 'Personal',
    summary: 'Colors and the Moon theme.',
    keywords: [
      'theme',
      'moonlight',
      'bee',
      'pulsidian',
      'patina',
      'celadon',
      'heliodor',
      'color',
      'colour',
      'look',
      'contrast',
      'light',
      'dark'
    ],
    status: 'live'
  },
  {
    id: 'colors',
    label: 'Colors',
    group: 'Personal',
    summary: 'Six palettes for every surface.',
    keywords: [
      'theme',
      'themes',
      'palette',
      'color',
      'colour',
      'moonlight',
      'bee',
      'pulsidian',
      'patina',
      'celadon',
      'heliodor',
      'moon',
      'dark',
      'light'
    ],
    status: 'live',
    hidden: true,
    parent: 'appearance'
  },
  {
    id: 'moon',
    label: 'Moon',
    group: 'Personal',
    summary: 'The deep night theme.',
    keywords: ['moon', 'exclusive', 'night', 'black', 'glow', 'theme', 'moonlight'],
    status: 'live',
    hidden: true,
    parent: 'appearance'
  },
  {
    id: 'providers',
    label: 'Models',
    group: 'Personal',
    summary: 'Endpoints and keys.',
    keywords: ['api key', 'models', 'direct', 'hosted', 'compatible', 'endpoint', 'llm', 'local'],
    status: 'live'
  },
  {
    id: 'instructions',
    label: 'Memory',
    group: 'Personal',
    summary: `What the ${agentName()} remembers.`,
    keywords: [
      'custom',
      'prompt',
      'style',
      'preferences',
      'notes',
      'voice',
      'writing',
      'remember',
      'recall',
      'memory',
      'instructions'
    ],
    status: 'live'
  },
  {
    id: 'agent',
    label: 'Agent',
    group: 'Agents',
    summary: `The ${agentName()} and the ladder behind it.`,
    keywords: ['captain', 'envoy', 'operator', 'team', 'engine', 'executor', 'ladder'],
    status: 'live'
  },
  {
    id: 'agent-team',
    label: 'Agent Teams',
    group: 'Agents',
    summary: `Up to four ${agentName()}s, one Table.`,
    keywords: ['team', 'peer', 'captains', 'collab', 'agents', 'joint', 'table', 'pairing'],
    status: 'live'
  },
  {
    id: 'rook',
    label: 'Autonomous worker',
    group: 'Agents',
    summary: 'Background work, change requests, and skills.',
    keywords: ['rook', 'worker', 'yolo', 'build', 'plan', 'skills', 'change requests', 'deliverables', 'gitops'],
    status: 'live'
  },
  {
    id: 'skills',
    label: 'Skills',
    group: 'Agents',
    summary: 'Installed procedures and the skill catalog.',
    keywords: ['skill', 'skills', 'catalog', 'bundle', 'playbook', 'install', 'skill.md'],
    status: 'live'
  },
  {
    id: 'learning',
    label: 'Learning',
    group: 'Agents',
    summary: 'Measured runtime policies, utility memory, verified skills, and learning receipts.',
    keywords: ['learning', 'self-improving', 'strategy', 'lessons', 'receipts'],
    status: 'live',
    hidden: true,
    parent: 'agent'
  },
  {
    id: 'sub-agents',
    label: 'Team runs',
    group: 'Agents',
    summary: 'Supervised team runs and parallel teammates.',
    keywords: ['team', 'subagent', 'delegate', 'workers', 'parallel', 'agents', 'runs', 'live'],
    status: 'live',
    hidden: true,
    parent: 'agent-team'
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    group: 'Integrations',
    summary: 'Installed tool servers and the catalog.',
    keywords: ['tools', 'stdio', 'http', 'sse', 'server', 'rea', 'reverse engineering', 'protocol', 'extensions', 'mcp', 'marketplace'],
    status: 'live'
  },
  {
    id: 'impdesk',
    label: 'ImpDesk',
    group: 'Integrations',
    summary: 'Protection, connections and behaviour for this machine.',
    keywords: [
      'impdesk',
      'cockpit',
      'protection',
      'security',
      'posture',
      'desktop',
      'connections',
      'behaviour',
      'behavior',
      'engine',
      'keys'
    ],
    status: 'live'
  },
  {
    id: 'connectors',
    label: 'Connectors',
    group: 'Integrations',
    summary: `Connect app accounts and expose their tools to the ${agentName()}.`,
    keywords: ['connectors', 'composio', 'apps', 'integrations', 'toolkit', 'oauth', 'connect', 'account', 'tasks', 'mail', 'docs', 'tools', 'extensions'],
    status: 'live'
  },
  {
    id: 'design-systems',
    label: 'Design systems',
    group: 'Agents',
    summary: `Native Marketspace DESIGN.md systems the ${agentName()} can apply to real work.`,
    keywords: ['marketspace', 'design', 'design.md', 'system', 'preview', 'install', 'native', 'brand', 'ui', 'interface'],
    status: 'live'
  },
  {
    id: 'channels',
    label: 'Channels',
    group: 'Integrations',
    summary: `Reach the ${agentName()} from another app.`,
    keywords: ['channel', 'webhook', 'telegram', 'bot', 'inbound', 'messages', 'remote', 'api'],
    status: 'live'
  },
  {
    id: 'gateway',
    label: 'Gateway',
    group: 'Integrations',
    summary: 'Reach the backend from anywhere.',
    keywords: [
      'gateway',
      'moon',
      'http',
      'webhook',
      'token',
      'router',
      'automation',
      'remote',
      'api'
    ],
    status: 'live',
    hidden: true,
    parent: 'channels'
  },
  {
    id: 'work-files',
    label: 'Work Files',
    group: 'Integrations',
    summary: 'Files, mail and the calendar.',
    keywords: [
      'work-files',
      '365',
      'office',
      'outlook',
      'graph',
      'mail',
      'calendar',
      'onedrive',
      'sharepoint'
    ],
    status: 'live',
    hidden: true,
    parent: 'channels'
  },
  {
    id: 'desktop',
    label: 'Desktop',
    group: 'Integrations',
    summary: 'Screen control and GUI actions.',
    keywords: [
      'computer',
      'desktop',
      'screen',
      'mouse',
      'keyboard',
      'grounded',
      'actions',
      'grounding',
      'automation'
    ],
    status: 'live',
    hidden: true,
    parent: 'channels'
  },
  {
    id: 'enterprise',
    label: 'Enterprise controls',
    group: 'SelfImpulse',
    summary: 'Agent roles, data-loss prevention, and signed runtime evidence.',
    keywords: [
      'enterprise',
      'rbac',
      'role',
      'policy',
      'least privilege',
      'dlp',
      'data loss',
      'redact',
      'block',
      'secrets',
      'compliance',
      'governance'
    ],
    status: 'live'
  },
  {
    id: 'audit',
    label: 'Audit log',
    group: 'SelfImpulse',
    summary: 'Export and verify the signed record of every decision the agent made.',
    keywords: [
      'audit',
      'compliance',
      'export',
      'verify',
      'receipts',
      'signed',
      'log',
      'trail',
      'governance',
      'impulse'
    ],
    status: 'live'
  },
  {
    id: 'about',
    label: 'About',
    group: 'SelfImpulse',
    summary: 'Version and storage.',
    keywords: ['version', 'platform', 'data folder', 'license', 'electron', 'storage'],
    status: 'live'
  }
]

export const SETTINGS_GROUPS: SettingsGroup[] = ['Personal', 'Agents', 'Integrations', 'SelfImpulse']

export function visibleSettingsNav(): SettingsNavItem[] {
  return SETTINGS_NAV.filter((item) => !item.hidden)
}

export function searchSettingsNav(query: string): SettingsNavItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return SETTINGS_NAV
  return SETTINGS_NAV.filter((item) =>
    [item.label, item.summary, ...item.keywords].some((value) =>
      value.toLowerCase().includes(normalized)
    )
  )
}

export function groupSettingsNav(
  items: SettingsNavItem[]
): { group: SettingsGroup; items: SettingsNavItem[] }[] {
  return SETTINGS_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group)
  })).filter((section) => section.items.length > 0)
}

export function settingsPane(id: SettingsPaneId): SettingsNavItem {
  return SETTINGS_NAV.find((item) => item.id === id) ?? SETTINGS_NAV[0]
}

export function settingsPaneLabel(id: SettingsPaneId): string {
  return settingsPane(id).label
}

export function settingsParent(id: SettingsPaneId): SettingsPaneId {
  return settingsPane(id).parent ?? id
}
