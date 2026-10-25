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
  'tiers',
  'instructions',
  'agent',
  'agent-team',
  'skills',
  'learning',
  'sub-agents',
  'mcp',
  'connectors',
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
    status: 'live'
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
    status: 'live'
  },
  {
    id: 'shortcuts',
    label: 'Keyboard',
    group: 'Personal',
    summary: 'Every key.',
    keywords: ['keys', 'keyboard', 'bindings', 'hotkeys', 'ctrl'],
    status: 'live'
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
    summary: 'The exclusive theme.',
    keywords: ['moon', 'exclusive', 'night', 'black', 'glow', 'theme', 'moonlight'],
    status: 'live',
    badge: 'Exclusive',
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
    id: 'tiers',
    label: 'Tiers',
    group: 'Personal',
    summary: 'How much a turn may spend.',
    keywords: [
      'tier',
      'tiers',
      'reasoning',
      'thinking',
      'effort',
      'budget',
      'tokens',
      'swift',
      'balanced',
      'deep',
      'agentic',
      'lean',
      'auto'
    ],
    status: 'live'
  },
  {
    id: 'instructions',
    label: 'Memory',
    group: 'Personal',
    summary: 'What the Captain remembers.',
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
    summary: 'The Captain and the ladder behind it.',
    keywords: ['captain', 'consul', 'adept', 'crew', 'engine', 'executor', 'ladder'],
    status: 'live'
  },
  {
    id: 'agent-team',
    label: 'Agent Teams',
    group: 'Agents',
    summary: 'Two Captains, one Table.',
    keywords: ['team', 'peer', 'captains', 'collab', 'agents', 'joint', 'table', 'pairing'],
    status: 'live'
  },
  {
    id: 'skills',
    label: 'Skills',
    group: 'Agents',
    summary: 'Procedures the Captain can load.',
    keywords: ['skill', 'skills', 'registry', 'bundle', 'playbook', 'marketplace', 'install', 'skill.md'],
    status: 'live'
  },
  {
    id: 'learning',
    label: 'RSIRALS learning',
    group: 'Agents',
    summary: 'Measured runtime policies, utility memory, verified skills, and learning receipts.',
    keywords: ['rsirals', 'recursive', 'learning', 'self-improving', 'strategy', 'lessons', 'receipts'],
    status: 'live'
  },
  {
    id: 'sub-agents',
    label: 'Crew Mesh',
    group: 'Agents',
    summary: 'Supervised Crew runs and parallel teams.',
    keywords: ['crew', 'mesh', 'subagent', 'delegate', 'workers', 'parallel', 'agents', 'runs', 'live'],
    status: 'live'
  },
  {
    id: 'mcp',
    label: 'MCP',
    group: 'Integrations',
    summary: 'Local tool servers.',
    keywords: ['tools', 'stdio', 'server', 'rea', 'reverse engineering', 'protocol', 'extensions', 'mcp'],
    status: 'live'
  },
  {
    id: 'connectors',
    label: 'Connectors',
    group: 'Integrations',
    summary: 'App toolkits for the Captain.',
    keywords: ['connectors', 'apps', 'integrations', 'toolkit', 'tasks', 'mail', 'docs', 'tools', 'extensions'],
    status: 'live'
  },
  {
    id: 'channels',
    label: 'Channels',
    group: 'Integrations',
    summary: 'Reach the Captain from another app.',
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
    status: 'live'
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
    status: 'live'
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
    status: 'live'
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
