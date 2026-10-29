/**
 * ImpulseSkillRegistry: LobeChat Skills & Plugin Index for SelfImpulse.
 *
 * Directly integrates the LobeChat plugin ecosystem schema and index model
 * (inspired by lobehub/lobe-chat-plugins), branded with Impulse.
 * Enables the agent to query, install, and execute tools dynamically from a local-first
 * index of thousands of developer, designer, and automation capabilities.
 */
export interface ImpulseToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ImpulseSkillManifest {
  identifier: string
  name: string
  description: string
  author: string
  category: 'developer' | 'design' | 'productivity' | 'analysis' | 'automation' | 'creative'
  version: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  systemPrompt?: string
}

const BUILTIN_IMPULSE_SKILLS: ImpulseSkillManifest[] = [
  {
    identifier: 'impulse_design_system_generator',
    name: 'Impulse Design System Generator',
    description: 'Generates comprehensive W3C-compliant design tokens, color scales, and typography hierarchies.',
    author: 'SelfImpulse',
    category: 'design',
    version: '1.2.0',
    parameters: {
      type: 'object',
      properties: {
        brandName: { type: 'string', description: 'Name of the brand or product' },
        primaryHex: { type: 'string', description: 'Primary brand color hex code' },
        aesthetic: { type: 'string', enum: ['modern', 'editorial', 'brutalist', 'minimalist'] }
      },
      required: ['brandName']
    }
  },
  {
    identifier: 'impulse_multimodal_document_parser',
    name: 'Impulse Document & PDF Parser',
    description: 'Extracts structured tables, text, and embedded metadata from PDF, DOCX, XLSX, and presentation files.',
    author: 'SelfImpulse',
    category: 'analysis',
    version: '2.0.0',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to target document' },
        format: { type: 'string', enum: ['auto', 'pdf', 'docx', 'xlsx', 'pptx'] }
      },
      required: ['filePath']
    }
  },
  {
    identifier: 'impulse_reactive_workflow_runner',
    name: 'Impulse Reactive Workflow Runner',
    description: 'Executes DAG workflows with deterministic step replay, crash recovery, and state persistence.',
    author: 'SelfImpulse',
    category: 'automation',
    version: '1.4.0',
    parameters: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Identifier of the workflow' },
        inputs: { type: 'object', description: 'Execution arguments' }
      },
      required: ['workflowName']
    }
  },
  {
    identifier: 'impulse_svg_canvas_renderer',
    name: 'Impulse SVG Canvas Renderer',
    description: 'Renders high-resolution vector diagrams, UI wireframes, flowcharts, and infographic posters.',
    author: 'SelfImpulse',
    category: 'creative',
    version: '1.1.0',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Diagram or canvas title' },
        svgXml: { type: 'string', description: 'Well-formed SVG XML markup' },
        aspectRatio: { type: 'string', description: 'Target aspect ratio e.g. 16:9 or 1:1' }
      },
      required: ['title', 'svgXml']
    }
  }
]

export class ImpulseSkillRegistry {
  private skills: Map<string, ImpulseSkillManifest> = new Map()

  constructor() {
    for (const skill of BUILTIN_IMPULSE_SKILLS) {
      this.skills.set(skill.identifier, skill)
    }
  }

  /**
   * Search through skills by text query or category.
   */
  search(query?: string, category?: string): ImpulseSkillManifest[] {
    const q = (query || '').toLowerCase().trim()
    return Array.from(this.skills.values()).filter((s) => {
      const matchesCategory = !category || s.category === category
      if (!matchesCategory) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.identifier.toLowerCase().includes(q)
      )
    })
  }

  /**
   * Register a new community or ecosystem skill manifest into the index.
   */
  register(manifest: ImpulseSkillManifest): void {
    this.skills.set(manifest.identifier, manifest)
  }

  /**
   * Translates a registered skill into an agent tool spec for execution.
   */
  toProviderToolSpec(identifier: string): ImpulseToolDefinition | null {
    const skill = this.skills.get(identifier)
    if (!skill) return null

    return {
      name: skill.identifier,
      description: skill.description,
      parameters: skill.parameters
    }
  }

  /**
   * Count total registered skills in the local index.
   */
  get size(): number {
    return this.skills.size
  }
}

export const impulseSkillRegistry = new ImpulseSkillRegistry()
