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
  'skills',
  'sub-agents',
  'mcp',
  'composio',
  'channels',
  'about'
] as const

export type SettingsPaneId = (typeof SETTINGS_PANES)[number]

export type SettingsGroup = 'Personal' | 'Agents' | 'Integrations' | 'Knight'

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
    keywords: ['api key', 'models', 'anthropic', 'openai', 'compatible', 'endpoint', 'llm', 'local'],
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
    keywords: ['skill', 'skills', 'clawhub', 'bundle', 'playbook', 'marketplace', 'install', 'skill.md'],
    status: 'live'
  },
  {
    id: 'sub-agents',
    label: 'Sub-agents',
    group: 'Agents',
    summary: 'Crew runs, live.',
    keywords: ['crew', 'subagent', 'delegate', 'workers', 'parallel', 'agents', 'runs', 'live'],
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
    id: 'composio',
    label: 'Composio',
    group: 'Integrations',
    summary: 'App toolkits for the Captain.',
    keywords: ['composio', 'apps', 'integrations', 'toolkit', 'github', 'gmail', 'slack', 'tools', 'extensions'],
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
    id: 'about',
    label: 'About',
    group: 'Knight',
    summary: 'Version and storage.',
    keywords: ['version', 'platform', 'data folder', 'license', 'electron', 'storage'],
    status: 'live'
  }
]

export const SETTINGS_GROUPS: SettingsGroup[] = ['Personal', 'Agents', 'Integrations', 'Knight']

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
