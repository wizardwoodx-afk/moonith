/**
 * Qoder parity — the skills and connectors Qoder ships, mapped onto the real
 * catalogues Knight Cowork talks to.
 *
 * Qoder's own catalogue is served by their backend, not bundled in the app, so
 * it cannot be copied verbatim. What *is* recoverable is the shape of it, and the
 * upstream sources it mirrors:
 *
 *   Qoder "Skills"      -> LobeHub Skills Marketplace   (market.lobehub.com)
 *   Qoder "Connectors"  -> Composio toolkits            (backend.composio.dev)
 *   Qoder "MCP"         -> LobeHub MCP plugin marketplace
 *
 * The lists below are the entries Qoder's own Extensions surface showed, keyed
 * to their upstream identifiers so they resolve live instead of being faked.
 */

/** A skill Qoder lists, with the LobeHub identifier it resolves to. */
export interface QoderSkill {
  name: string
  id: string
  desc: string
}

/** A connector Qoder lists, keyed to its Composio toolkit or LobeHub MCP plugin. */
export interface QoderConnector {
  name: string
  app: string
  mcp?: string
  desc: string
}

/** Skills Qoder lists, with the LobeHub identifier they resolve to. */
export const QODER_SKILLS: QoderSkill[] = [
  {
    name: 'deep-research',
    id: 'anthropics-skills-deep-research',
    desc: 'Conduct systematic deep research on technical questions.'
  },
  {
    name: 'drafter-diagram',
    id: 'anthropics-skills-drafter-diagram',
    desc: 'Generate technical diagrams using HTML/CSS.'
  },
  {
    name: 'image-enhancer',
    id: 'anthropics-skills-image-enhancer',
    desc: 'Improves image quality, especially screenshots and diagrams.'
  },
  {
    name: 'create-plan',
    id: 'anthropics-skills-create-plan',
    desc: 'Convert requirements into executable stories with milestones.'
  },
  {
    name: 'responsive-design',
    id: 'anthropics-skills-responsive-design',
    desc: 'Implement modern responsive layouts using container-aware units.'
  },
  {
    name: 'weekly-report-writer',
    id: 'anthropics-skills-weekly-report-writer',
    desc: 'Create weekly reports with an agenda and summary.'
  },
  {
    name: 'render-deploy',
    id: 'anthropics-skills-render-deploy',
    desc: 'Deploy applications by analysing the codebase.'
  },
  {
    name: 'manim-composer',
    id: 'baoyu-skills-manim-composer',
    desc: 'Trigger an educational animation when asked for one.'
  },
  {
    name: 'baoyu-article-illustrator',
    id: 'baoyu-skills-baoyu-article-illustrator',
    desc: 'Analyse article structure and produce matching illustrations.'
  },
  {
    name: 'market-research-reports',
    id: 'gstack-skills-market-research-reports',
    desc: 'Generate comprehensive market research reports.'
  }
]

/**
 * Connectors Qoder lists. `app` is the Composio toolkit slug, `mcp` an optional
 * LobeHub MCP plugin when the connector is better served by MCP.
 */
export const QODER_CONNECTORS: QoderConnector[] = [
  { name: 'GitHub', app: 'github', desc: 'Search repositories and open pull requests.' },
  { name: 'Notion', app: 'notion', desc: 'An integrated workspace for notes and tasks.' },
  { name: 'Figma', app: 'figma', desc: 'Access design files, projects and tokens.' },
  {
    name: 'Microsoft Excel',
    app: 'microsoft_excel',
    desc: 'Read and edit spreadsheets and workbooks.'
  },
  { name: 'Hugging Face', app: 'hugging_face', desc: 'Search models, datasets and spaces.' },
  { name: 'GitLab', app: 'gitlab', desc: 'Access projects and merge requests.' },
  {
    name: 'Postman',
    app: 'postman',
    desc: 'Manage workspaces, collections and environments.'
  },
  {
    name: 'Alibaba Cloud DevOps',
    app: 'alibaba_cloud_devops',
    desc: 'Query pipelines, builds and deployments.'
  },
  { name: 'PolarDB', app: 'polardb', desc: 'Execute SQL statements against a schema.' },
  { name: 'Context7', app: 'context7', desc: 'Version-matched documentation on demand.' },
  {
    name: 'Today Investment Financial Data',
    app: 'today_investment_financial_data',
    desc: 'Financial datasets for analysis.'
  },
  {
    name: 'Qoder Cloud Agents',
    app: '',
    mcp: 'qoder-cloud-agents',
    desc: 'Connect a Qoder Cloud runtime with a personal access token.'
  }
]
