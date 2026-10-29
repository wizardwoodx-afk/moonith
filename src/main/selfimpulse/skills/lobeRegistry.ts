/**
 * ImpulseSkillRegistry: LobeChat Skills & Plugin Index for SelfImpulse.
 *
 * Integrates the open-source LobeChat plugin ecosystem schema and index model
 * (inspired by lobehub/lobe-chat-plugins), branded with Impulse ("Impulse Skill Hub" / "Self Skills").
 * Enables the agent to query, inspect, and execute tools dynamically from a local-first
 * index of developer, designer, and automation capabilities with zero latency and full offline support.
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

export const BUILTIN_IMPULSE_SKILLS: ImpulseSkillManifest[] = [
  {
    identifier: 'impulse_web_search',
    name: 'Impulse Web Intelligence Search',
    description: 'Real-time search engine crawler and web intelligence extractor with structured summary synthesis.',
    author: 'SelfImpulse',
    category: 'productivity',
    version: '2.1.0',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query or target URL' },
        depth: { type: 'string', enum: ['standard', 'deep', 'academic'], description: 'Search depth' },
        maxResults: { type: 'number', description: 'Number of results to retrieve (default: 5)' }
      },
      required: ['query']
    }
  },
  {
    identifier: 'impulse_code_sandbox',
    name: 'Impulse Code Interpreter Sandbox',
    description: 'Isolated computation sandbox for executing Python, JavaScript, and data analytics algorithms.',
    author: 'SelfImpulse',
    category: 'developer',
    version: '2.4.0',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'typescript', 'bash'], description: 'Runtime language' },
        code: { type: 'string', description: 'Source code snippet to execute' },
        timeoutSeconds: { type: 'number', description: 'Execution timeout in seconds' }
      },
      required: ['language', 'code']
    }
  },
  {
    identifier: 'impulse_arxiv_scholar',
    name: 'Impulse ArXiv Scholar Inspector',
    description: 'Query ArXiv research papers, inspect paper abstracts, extract methodologies, and generate citations.',
    author: 'SelfImpulse',
    category: 'analysis',
    version: '1.5.0',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Academic subject, DOI, or keyword' },
        sortBy: { type: 'string', enum: ['relevance', 'lastUpdatedDate', 'submittedDate'] },
        maxResults: { type: 'number', description: 'Max papers to return' }
      },
      required: ['query']
    }
  },
  {
    identifier: 'impulse_chart_generator',
    name: 'Impulse AntV & Mermaid Visualizer',
    description: 'Renders dynamic AntV charts (bar, line, radar, scatter) and Mermaid diagrams (flowcharts, sequence, ERDs).',
    author: 'SelfImpulse',
    category: 'creative',
    version: '2.0.0',
    parameters: {
      type: 'object',
      properties: {
        chartType: { type: 'string', enum: ['antv_bar', 'antv_line', 'antv_pie', 'mermaid_flow', 'mermaid_sequence', 'mermaid_er'] },
        title: { type: 'string', description: 'Chart title' },
        data: { type: 'object', description: 'Dataset or Mermaid markup string' }
      },
      required: ['chartType', 'title', 'data']
    }
  },
  {
    identifier: 'impulse_figma_inspector',
    name: 'Impulse Figma Design Tokens Inspector',
    description: 'Inspects Figma files, extracts design token hierarchies (OKLCH, spacing, typography), and generates CSS.',
    author: 'SelfImpulse',
    category: 'design',
    version: '1.3.0',
    parameters: {
      type: 'object',
      properties: {
        fileKey: { type: 'string', description: 'Figma file key from URL' },
        nodeId: { type: 'string', description: 'Optional specific frame or component ID' }
      },
      required: ['fileKey']
    }
  },
  {
    identifier: 'impulse_github_ops',
    name: 'Impulse GitHub Repository Ops',
    description: 'Inspects repositories, queries pull request diffs, manages issues, and tracks branch histories.',
    author: 'SelfImpulse',
    category: 'developer',
    version: '2.2.0',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository in format owner/repo' },
        action: { type: 'string', enum: ['list_prs', 'get_diff', 'read_file', 'create_issue', 'commit_history'] },
        issueOrPrNumber: { type: 'number', description: 'Target issue or PR number' }
      },
      required: ['repo', 'action']
    }
  },
  {
    identifier: 'impulse_wolfram_compute',
    name: 'Impulse Wolfram Computational Engine',
    description: 'Solves complex mathematical equations, scientific calculus, unit conversions, and physical calculations.',
    author: 'SelfImpulse',
    category: 'analysis',
    version: '1.1.0',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math formula, equation, or physical quantity query' },
        assumptions: { type: 'string', description: 'Optional mathematical assumptions' }
      },
      required: ['expression']
    }
  },
  {
    identifier: 'impulse_media_flux',
    name: 'Impulse Multimodal Asset & Image Generator',
    description: 'Generates UI graphic assets, icons, posters, and photographic visuals with precise prompt control.',
    author: 'SelfImpulse',
    category: 'creative',
    version: '1.8.0',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Visual asset description' },
        aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:2'] },
        style: { type: 'string', enum: ['photorealistic', 'vector_flat', '3d_isometric', 'minimalist_line'] }
      },
      required: ['prompt']
    }
  },
  {
    identifier: 'impulse_whisper_transcriber',
    name: 'Impulse Speech & Audio Transcriber',
    description: 'Transcribes audio recordings, voice memos, and video audio into structured text with timestamps.',
    author: 'SelfImpulse',
    category: 'productivity',
    version: '2.0.0',
    parameters: {
      type: 'object',
      properties: {
        audioPath: { type: 'string', description: 'Path to audio or video file' },
        language: { type: 'string', description: 'Language code e.g. en, es, fr, auto' },
        includeTimestamps: { type: 'boolean', description: 'Whether to return word-level timestamps' }
      },
      required: ['audioPath']
    }
  },
  {
    identifier: 'impulse_sql_explorer',
    name: 'Impulse SQL Database Explorer',
    description: 'Introspects database schemas, runs read-only analytics queries, and optimizes query execution plans.',
    author: 'SelfImpulse',
    category: 'developer',
    version: '1.9.0',
    parameters: {
      type: 'object',
      properties: {
        connectionUri: { type: 'string', description: 'SQLite path or database connection URI' },
        sql: { type: 'string', description: 'SQL query to execute' },
        readOnly: { type: 'boolean', description: 'Enforce read-only transaction (default: true)' }
      },
      required: ['connectionUri', 'sql']
    }
  },
  {
    identifier: 'impulse_weather_meteorology',
    name: 'Impulse Global Meteorological Engine',
    description: 'Fetches high-precision weather forecasts, air quality indices, and meteorological radar data.',
    author: 'SelfImpulse',
    category: 'productivity',
    version: '1.0.0',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name or coordinates (latitude, longitude)' },
        days: { type: 'number', description: 'Forecast days (1-7)' }
      },
      required: ['location']
    }
  },
  {
    identifier: 'impulse_document_rag',
    name: 'Impulse Semantic Document Search (RAG)',
    description: 'Performs chunking, dense vector embedding, and cosine similarity search over local workspace documents.',
    author: 'SelfImpulse',
    category: 'analysis',
    version: '2.1.0',
    parameters: {
      type: 'object',
      properties: {
        targetDir: { type: 'string', description: 'Directory containing source files' },
        query: { type: 'string', description: 'Natural language search query' },
        topK: { type: 'number', description: 'Number of relevant chunks to retrieve' }
      },
      required: ['targetDir', 'query']
    }
  },
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
   * Return all registered skills as an array.
   */
  list(): ImpulseSkillManifest[] {
    return Array.from(this.skills.values())
  }

  /**
   * Get a specific skill by identifier.
   */
  get(identifier: string): ImpulseSkillManifest | undefined {
    return this.skills.get(identifier)
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
   * Return all skills formatted as agent tool specifications.
   */
  toAllProviderToolSpecs(): ImpulseToolDefinition[] {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.identifier,
      description: skill.description,
      parameters: skill.parameters
    }))
  }

  /**
   * Count total registered skills in the local index.
   */
  get size(): number {
    return this.skills.size
  }
}

export const impulseSkillRegistry = new ImpulseSkillRegistry()
