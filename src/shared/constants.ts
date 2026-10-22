export const REA_PRESET_TOOLS = [
  'open_binary',
  'binary_overview',
  'list_procedures',
  'search_procedures',
  'procedure_info',
  'procedure_pseudo_code',
  'procedure_assembly',
  'procedure_callees',
  'procedure_callers',
  'batch_decompile',
  'get_call_graph',
  'list_strings',
  'search_strings',
  'list_names',
  'xrefs',
  'read_bytes',
  'search_bytes',
  'read_function_instructions',
  'inspect_native_instruction',
  'resolve_native_call_targets'
]

export const REA_SERVER_CONFIG = {
  id: 'mcp-rea',
  name: 'rea',
  command: 'npx',
  args: ['-y', 'rea-agents@6.7.0', 'mcp'],
  enabled: true,
  preset: 'rea' as const,
  toolAllowlist: REA_PRESET_TOOLS
}

export const APP_NAME = 'SelfImpulse'
export const APP_VERSION = '0.1.0'
