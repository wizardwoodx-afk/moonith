export type PermissionMode = 'plan' | 'manual' | 'auto' | 'skip'
export type TaskMode = 'chat' | 'cowork'
export type TaskStatus = 'draft' | 'running' | 'waiting' | 'paused' | 'done' | 'error'
export type ProviderKind = 'anthropic' | 'openai' | 'compatible'

import type {
  AuditExportResult,
  AuditSummary,
  AuditVerifyResult
} from './audit'
import type {
  AuditEventQuery,
  AuditEventView
} from './audit'
import type {
  AgentRole,
  DlpInspection,
  GovernanceSettings,
  SensitiveDataCategory
} from './governance'
import type {
  EnterpriseAuthorization,
  EnterpriseControlMutation,
  EnterpriseControlSnapshot,
  EnterpriseControlState,
  EnterpriseDecision,
  EnterpriseRevisionInfo
} from './enterpriseControl'
import type { RsiralsSnapshot, RsiralsOctaStatus } from './rsirals'
import type {
  LibraryCollection,
  LibraryPage,
  LibraryPageInput,
  LibraryPagePatch,
  LibrarySnapshot
} from './library'
import type {
  MarketspaceApplyResult,
  MarketspaceCreateInput,
  MarketspaceDetail,
  MarketspaceEntry
} from './marketspace'

export type {
  AuditExportResult,
  AuditSummary,
  AuditVerifyResult
} from './audit'
export type { AgentRole, DlpInspection, GovernanceSettings } from './governance'
export type {
  EnterpriseAuthorization,
  EnterpriseControlMutation,
  EnterpriseControlSnapshot,
  EnterpriseControlState,
  EnterpriseDecision,
  EnterpriseRevisionInfo
} from './enterpriseControl'
export type { RsiralsSnapshot, RsiralsOctaStatus } from './rsirals'
export type {
  LibraryCollection,
  LibraryPage,
  LibraryPageInput,
  LibraryPagePatch,
  LibrarySnapshot
} from './library'
export type {
  MarketspaceApplyResult,
  MarketspaceCreateInput,
  MarketspaceDetail,
  MarketspaceEntry
} from './marketspace'

import type {
  GovernanceRecordView,
  GovernanceSummaryView,
  KillSwitchState,
  MissionStatusView,
  MissionStepView,
  MissionSummaryView,
  ReceiptSummaryView,
  ReceiptVerifyView,
  ReceiptView
} from './enterprise'

export type {
  GovernanceRecordView,
  GovernanceSummaryView,
  KillSwitchState,
  MissionStatusView,
  MissionStepView,
  MissionSummaryView,
  ReceiptSummaryView,
  ReceiptVerifyView,
  ReceiptView
} from './enterprise'

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerConfig {
  id: string
  name: string
  transport?: McpTransport
  command: string
  args: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  enabled: boolean
  preset?: 'rea'
  toolAllowlist?: string[]
  /** Where this server was installed from, when it came from a marketplace. */
  source?: 'manual' | 'lobehub'
  sourceUrl?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpServerStatus {
  id: string
  name: string
  status: 'stopped' | 'starting' | 'ready' | 'error'
  error?: string
  tools: McpToolInfo[]
}

export interface McpMarketSearchResult {
  id: string
  name: string
  description: string
  author: string
  version: string
  icon?: string
  category?: string
  installs: number
  connectionType: 'stdio' | 'http' | 'sse' | 'other'
  validated: boolean
  manifestUrl: string
  siteUrl: string
  tools: string[]
}

export interface McpMarketDetail extends McpMarketSearchResult {
  homepage?: string
  deployment: {
    transport: McpTransport
    command?: string
    args?: string[]
    url?: string
  } | null
  deploymentDescription?: string
  systemDependencies: string[]
}

export interface McpMarketInstallResult {
  config: McpServerConfig
  statuses: McpServerStatus[]
  installed: boolean
  updated: boolean
}

export interface ProviderPublic {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  enabled: boolean
  hasKey: boolean
}

export interface ProviderInput {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  enabled: boolean
  apiKey?: string
  removeKey?: boolean
}

/* ── ImpCodes access ──────────────────────────────────────────────────────── */

/** A provider found in the ImpCodes access file. Never carries the key itself. */
export interface ImpCodesAccessProvider {
  name: string
  baseUrl: string
  models: string[]
  hasKey: boolean
}

/** A tool server found in the ImpCodes access file. Never carries headers or env values. */
export interface ImpCodesAccessServer {
  name: string
  transport: McpTransport
  command: string
  args: string[]
  url?: string
}

export interface ImpCodesAccess {
  available: boolean
  defaultModel?: string
  providers: ImpCodesAccessProvider[]
  servers: ImpCodesAccessServer[]
  error?: string
}

export interface ImpCodesImportResult {
  access: ImpCodesAccess
  providerCount: number
  serverCount: number
  providerId?: string
  providerName?: string
  models: string[]
  /** True when no default existed and the imported provider became the default. */
  becameDefault: boolean
}

/* ── Desktop cockpit posture ─────────────────────────────────────────────── */

export type SecurityPostureState = 'good' | 'attention' | 'off'

export interface SecurityPostureItem {
  id: string
  label: string
  detail: string
  state: SecurityPostureState
  /** Settings pane that can act on this item. */
  pane?: string
}

export interface SecurityPosture {
  items: SecurityPostureItem[]
  sealedSecrets: number
  plaintextSecrets: number
  providerCount: number
  serverCount: number
  channelCount: number
  keychainAvailable: boolean
}

export interface ConnectorsPublic {
  hasKey: boolean
  enabled: boolean
  toolkits: string[]
  userId: string
}

export interface ChannelRecord {
  id: string
  kind: 'webhook' | 'telegram'
  name: string
  enabled: boolean
  hasToken: boolean
  /** Inbound token for the local webhook. Generated by SelfImpulse, shown so it can be used. */
  webhookToken?: string
  webhookPath?: string
  port?: number
  lastMessageAt?: string
  messagesIn: number
  messagesOut: number
  /** Telegram is deny-by-default; an empty list authorizes no inbound chat. */
  allowedChatIds: string[]
  error?: string
}

export interface ChannelInput {
  id?: string
  kind: 'webhook' | 'telegram'
  name: string
  enabled: boolean
  token?: string
  removeToken?: boolean
  allowedChatIds?: string[]
}

export interface ChannelState {
  channels: ChannelRecord[]
  running: boolean
  port: number | null
}

export interface ConnectorsToolkitInfo {
  slug: string
  name: string
  description: string
  categories: string[]
  logo?: string
  connected: boolean
  tools: number
  enabled: boolean
  authScheme?: string
  connectionStatus: 'connected' | 'pending' | 'not_connected' | 'no_auth' | 'error'
  connectedAccountId?: string
  authConfigId?: string
  connectable: boolean
}

export interface ConnectorsToolInfo {
  slug: string
  name: string
  description: string
  toolkit: string
  enabled: boolean
}

export interface ConnectorsState {
  configured: boolean
  enabled: boolean
  userId: string
  toolkits: ConnectorsToolkitInfo[]
  tools: ConnectorsToolInfo[]
  error?: string
}

export interface ConnectorsInput {
  apiKey?: string
  removeKey?: boolean
  enabled?: boolean
  toolkits?: string[]
  userId?: string
}

export interface ConnectorsConnectResult {
  redirectUrl: string
  connectedAccountId?: string
  status: string
  message?: string
}

export type SkillSource = 'registry' | 'marketplace'

/** A tool the agent ships with, described for the capability panel. */
export interface BuiltinToolSummary {
  name: string
  title: string
  description: string
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  source: 'local' | 'installed'
  registry?: SkillSource
  files: number
  updatedAt?: string
}

export interface SkillDetail extends SkillSummary {
  content: string
}

export interface SkillDraft {
  name: string
  description: string
  body: string
}

export interface SkillMarketResult {
  ref: string
  name: string
  summary: string
  author: string
  version: string
  downloads: number
  url: string
  registry: SkillSource
}

/* ── learned-skill proposals awaiting a human decision ───────────────────────
 * The renderer sees these views, never the service's own rows: the stored
 * procedure text and the distiller note are kept in the main process, so a
 * decision list cannot carry a tool name or a document body into the UI. The
 * decision input is a proposal id — the store key is never renderer-supplied. */

export interface KnowledgeProposalView {
  id: string
  title: string
  summary: string
  /** Where the document content actually went: never left the machine, or was
   *  sent to the configured model provider. */
  dataHandling: 'local' | 'provider'
  /** Present only when dataHandling is 'provider'. */
  endpointClass: 'cloud-default' | 'local-configured' | 'unknown' | null
  sourceName: string | null
  sourceSha256: string
  byteLength: number
  distilledAt: string
  /** Whether the structure came from the mechanical extractor alone. */
  distiller: 'mechanical' | 'llm'
  status: 'proposed' | 'approved' | 'discarded'
  decidedBy: string | null
  decidedAt: string | null
}

export interface KnowledgeDecisionInput {
  id: string
  decision: 'approve' | 'discard'
}

export interface KnowledgeDecideResult {
  ok: boolean
  error: string | null
  proposals: KnowledgeProposalView[]
}

export type MemoryScope = 'global' | 'workspace'

export interface MemoryNote {
  id: string
  text: string
  scope: MemoryScope
  /** Folder the note belongs to when scope is “workspace”. */
  scopeRef?: string
  tags: string[]
  source: 'user' | 'captain' | 'import'
  createdAt: string
  updatedAt: string
  /** Optional expiry instant; omitted notes remain until explicitly removed. */
  expiresAt?: string
}

export interface MemoryInput {
  text: string
  scope?: MemoryScope
  scopeRef?: string
  tags?: string[]
  /** Optional retention in whole days, from 1 through 3650. */
  retentionDays?: number
}

export type SubAgentStatus = 'running' | 'done' | 'error' | 'stopped'

export type CrewRunEventType =
  | 'spawned'
  | 'tool_started'
  | 'tool_finished'
  | 'completed'
  | 'stopped'
  | 'error'

export interface CrewRunEvent {
  id: string
  type: CrewRunEventType
  label: string
  at: string
  agentPath: string[]
}

export interface SubAgentStep {
  id: string
  tool: string
  title: string
  detail?: string
  status: 'running' | 'ok' | 'error'
  at: string
}

export interface SubAgentRun {
  id: string
  taskId: string
  taskTitle: string
  name: string
  instruction: string
  status: SubAgentStatus
  steps: SubAgentStep[]
  summary?: string
  error?: string
  provider: string
  model: string
  startedAt: string
  endedAt?: string
  /** Crew Mesh metadata is optional for runs persisted before the upgrade. */
  runtime?: 'crew-mesh'
  /** Present only for runs created with the native isolated coworker boundary. */
  isolation?: { workspace: 'private'; browser: 'per-run' }
  purpose?: string
  agentPath?: string[]
  depth?: number
  batchId?: string
  batchSize?: number
  jobIndex?: number
  usage?: { prompt: number; completion: number; total: number }
  events?: CrewRunEvent[]
}

export interface PublicSettings {
  providers: ProviderPublic[]
  mcpServers: McpServerConfig[]
  connectors: ConnectorsPublic
  channels: ChannelRecord[]
  defaultProviderId?: string
  defaultModel?: string
  defaultPermissionMode: PermissionMode
  /** Who owns the model/tool loop: the bundled execution engine or this process. */
  engineMode: 'engine' | 'internal'
  customInstructions: string
  allowShell: boolean
  onboardingComplete: boolean
  /** The name the user gave their agent. Empty until they choose one. */
  agentName: string
  governance: GovernanceSettings
  /** The transplanted the earlier shell backend: provider registry, tiers, memory, gateway. */
  backend?: BackendSettingsPublic
}

export interface EngineStatusPublic {
  state: 'stopped' | 'starting' | 'running' | 'error'
  version?: string
  port?: number
  providers?: number
  error?: string
  lastLine?: string
}

export interface SettingsPatch {
  providers?: ProviderInput[]
  mcpServers?: McpServerConfig[]
  connectors?: ConnectorsInput
  defaultProviderId?: string
  defaultModel?: string
  defaultPermissionMode?: PermissionMode
  engineMode?: 'engine' | 'internal'
  customInstructions?: string
  allowShell?: boolean
  onboardingComplete?: boolean
  agentName?: string
  governance?: GovernanceSettings
}

export interface TestProviderResult {
  ok: boolean
  message: string
  models?: string[]
}

export interface AttachmentRef {
  id: string
  name: string
  path: string
  relPath?: string
  size?: number
  mimeType?: string
}

/**
 * One clipboard image, base64-encoded, handed to the main process.
 *
 * `AttachmentRef` can only ever point at a file on disk, so a pasted Print
 * Screen image has to be written to a file before the attachment pipeline can
 * carry it. `taskId` is optional because a paste made from the welcome composer
 * happens before any task exists; main stages it until the message is sent.
 */
export interface PastedImageInput {
  taskId?: string
  mimeType: string
  data: string
}

export interface ToolCallInfo {
  id: string
  name: string
  arguments: unknown
  /** See `ProviderToolCall.thoughtSignature`. Persisted with the message so a
   *  resumed task can still complete a Google tool loop. */
  thoughtSignature?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  /** Model reasoning streamed before the visible answer, when the provider sends it. */
  thinking?: string
  toolCalls?: ToolCallInfo[]
  toolCallId?: string
  name?: string
  error?: boolean
  attachments?: AttachmentRef[]
  /** Reactions selected by the local profile, persisted with this message. */
  reactions?: string[]
  /** The local like/dislike on an assistant turn, with the reason when given. */
  feedback?: MessageFeedbackRecord
  hidden?: boolean
}

export const MESSAGE_REACTIONS = ['👍', '❤️', '🎉', '👀', '✅', '💡'] as const

export interface MessageReactionInput {
  taskId: string
  messageId: string
  emoji: string
}

export type MessageVote = 'up' | 'down'

export interface MessageFeedbackRecord {
  vote: MessageVote
  /** Only a downvote carries a reason, and only when the user chose to type one. */
  note?: string
  at: string
}

export interface MessageFeedbackInput {
  taskId: string
  messageId: string
  vote: MessageVote | null
  note?: string
}

export type PlanStatus = 'pending' | 'active' | 'done'

export interface PlanItem {
  id: string
  text: string
  status: PlanStatus
}

export type StepStatus = 'running' | 'waiting' | 'ok' | 'error'

export interface StepRecord {
  id: string
  tool: string
  title: string
  detail?: string
  status: StepStatus
  args?: unknown
  output?: string
  error?: string
  messageId?: string
  startedAt: string
  endedAt?: string
  artifactIds?: string[]
}

export type ArtifactKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'image'
  | 'text'
  | 'code'
  | 'other'

export interface Artifact {
  id: string
  name: string
  relPath: string
  previewRelPath?: string
  kind: ArtifactKind
  mimeType?: string
  size: number
  createdAt: string
  /** The assistant turn that produced this file, so it can be shown there. */
  messageId?: string
}

export interface BrowserState {
  url: string
  title: string
  open?: boolean
  loading?: boolean
  /** Opaque Captain/Crew session scope; never a shared browser profile. */
  scope?: string
  ownerLabel?: string
  screenshotRelPath?: string
  lastAction?: string
  updatedAt: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface UsageDay {
  date: string
  total: number
  level: number
}

export interface UsageTotals {
  input: number
  output: number
  total: number
  calls: number
}

export interface AgentUsage extends UsageTotals {
  agentId: string
  lastUsedAt: string
}

export interface UsageSummary {
  days: UsageDay[]
  totals: UsageTotals
  byAgent: AgentUsage[]
}

export interface Task {
  id: string
  title: string
  objective: string
  mode: TaskMode
  status: TaskStatus
  permissionMode: PermissionMode
  /** The RBAC role this task's agent runs under. Legacy tasks default to executor. */
  agentRole?: AgentRole
  providerId?: string
  model?: string
  folders: string[]
  messages: ChatMessage[]
  steps: StepRecord[]
  plan: PlanItem[]
  artifacts: Artifact[]
  browser?: BrowserState
  error?: string
  /** Session in the execution engine that continues this task's conversation. */
  engineSessionId?: string
  /** Why the last run ended, when it ended for any reason other than answering. */
  stop?: { reason: string; at: string }
  usage?: TokenUsage
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface TaskSummary {
  id: string
  title: string
  objective: string
  status: TaskStatus
  mode: TaskMode
  createdAt: string
  updatedAt: string
  artifactsCount: number
}

export interface CreateTaskInput {
  title?: string
  objective: string
  mode: TaskMode
  providerId?: string
  model?: string
  permissionMode: PermissionMode
  folders?: string[]
  agentRole?: AgentRole
}

export interface SendMessageInput {
  taskId: string
  text: string
  attachments?: AttachmentRef[]
}

export interface EditMessageInput {
  taskId: string
  messageId: string
  content: string
}

export interface UpdateTaskInput {
  taskId: string
  mode?: TaskMode
  permissionMode?: PermissionMode
  providerId?: string
  model?: string
  title?: string
  agentRole?: AgentRole
}

export interface DiffLine {
  /** ' ' unchanged, '-' removed by this action, '+' added by it. */
  sign: ' ' | '-' | '+'
  text: string
}

export type ApprovalReview =
  | { kind: 'library-page'; title: string; content: string; destination: string }
  | {
      kind: 'diff'
      path: string
      added: number
      removed: number
      truncated: boolean
      lines: DiffLine[]
      /** Shown when the change cannot be read as a diff at all. */
      note?: string
    }

export interface ApprovalRequest {
  id: string
  taskId: string
  tool: string
  title: string
  summary: string
  details?: string
  risk: 'low' | 'medium' | 'high'
  allowAlways: boolean
  review?: ApprovalReview
  createdAt: string
}

export interface ApprovalDecision {
  id: string
  approved: boolean
  always?: boolean
}

/** What the undo trail recorded about one path a task touched. */
export interface SnapshotEntry {
  path: string
  state: 'file' | 'directory' | 'missing' | 'moved'
  /** Tool call this capture belongs to; the unit undo and redo move by. */
  stepId?: string
  /** Hash of the bytes the path held before the step. */
  before?: string
  /** Hash after the step, `null` for a folder, absent before it is applied. */
  after?: string | null
  bytes?: number
  movedTo?: string
  /** Set when the change cannot be undone, and why. */
  skipped?: string
  at: string
}

export interface RevertOutcome {
  restored: string[]
  removed: string[]
  left: Array<{ path: string; reason: string }>
}

export interface ScheduleRecord {
  id: string
  title: string
  prompt: string
  cron: string
  enabled: boolean
  providerId?: string
  model?: string
  permissionMode: PermissionMode
  folders: string[]
  createdAt: string
  lastRunAt?: string
  lastTaskId?: string
}

export interface CreateScheduleInput {
  title: string
  prompt: string
  cron: string
  enabled?: boolean
  providerId?: string
  model?: string
  permissionMode: PermissionMode
  folders?: string[]
}

export type TaskEvent =
  | { type: 'task'; task: Task }
  | { type: 'delta'; taskId: string; messageId: string; delta: string }
  | { type: 'thinking'; taskId: string; messageId: string; delta: string }
  | { type: 'status'; taskId: string; status: TaskStatus; error?: string }
  | { type: 'artifact'; taskId: string; artifact: Artifact }
  | { type: 'browser'; taskId: string; browser: BrowserState }
  | { type: 'subagent'; run: SubAgentRun }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; message: string }

export type TableSeat = 'a' | 'b' | 'c' | 'd'
export type TableRole = 'idle' | 'host' | 'guest'
export type TableProposalStatus = 'pending' | 'approved' | 'withdrawn' | 'published'

export interface TablePeer {
  seat: TableSeat
  name: string
  device: string
  online: boolean
  joinedAt: string
}

export interface TableGoal {
  title: string
  detail: string
  due: string
  setBy: TableSeat
  updatedAt: string
}

export interface TableProposal {
  id: string
  title: string
  summary: string
  proposedBy: TableSeat
  keys: Partial<Record<TableSeat, boolean>>
  status: TableProposalStatus
  createdAt: string
  approvedAt?: string
  publishedAt?: string
  /** The seats that were at the table when this was proposed; all must turn a key. */
  seats?: TableSeat[]
  /** Set once published. Each desk marks its own side finished. */
  done?: Partial<Record<TableSeat, boolean>>
  /** Local task id per desk. Only meaningful on the machine that started it. */
  taskIds?: Partial<Record<TableSeat, string>>
}

export type TableLedgerStatus = 'shared' | 'pending' | 'approved' | 'withdrawn'

export interface TableLedgerEntry {
  id: string
  actor: TableSeat | 'joint'
  text: string
  status: TableLedgerStatus
  at: string
}

export interface TableState {
  role: TableRole
  /** This machine's seat at the table. */
  seat?: TableSeat
  code: string | null
  address: string | null
  port: number | null
  peers: TablePeer[]
  goal: TableGoal | null
  proposals: TableProposal[]
  ledger: TableLedgerEntry[]
  connected: boolean
  startedAt: string | null
  error?: string
}

export interface TableHostInput {
  name: string
}

export interface TableJoinInput {
  code: string
  address?: string
  name: string
}

export interface TableGoalInput {
  title: string
  detail?: string
  due?: string
}

export interface TableProposalInput {
  title: string
  summary: string
}

export interface TeamRole {
  id: string
  name: string
  title: string
  isAgent: boolean
  agentType?: string
  skills?: string[]
}

export interface PlaybookStep {
  id: string
  title: string
  roleId: string
  prompt: string
  toolSet?: string[]
  verificationCriteria?: string
  dependencies?: string[]
}

export interface TeamPlaybook {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  roles: TeamRole[]
  steps: PlaybookStep[]
  tags?: string[]
}

export interface ProofOfWorkRecord {
  proofId: string
  teamSessionId: string
  stepOrTaskId: string
  authorName: string
  roleId: string
  isAgent: boolean
  timestamp: string
  summary: string
  inputDigest: string
  outputDigest: string
  verificationPassed: boolean
  verificationDetails?: string
  prevHash: string
  recordHash: string
  signature: string
  keyId: string
}

export interface ProofOfWorkCertificate {
  certificateId: string
  teamSessionId: string
  playbookTitle?: string
  issuedAt: string
  totalProofs: number
  verifiedCount: number
  merkleRoot: string
  proofs: ProofOfWorkRecord[]
  signature: string
  signerKeyId: string
}

export type AgentCapability =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'shell.exec'
  | 'net.fetch'
  | 'browser.control'
  | 'document.create'
  | 'studio.run'
  | 'mission.dispatch'
  | 'memory.read'
  | 'memory.write'
  | 'tool.other'

export interface AgentPassport {
  passportId: string
  agentId: string
  agentRole: string
  principalName: string
  principalKeyId: string
  capabilities: AgentCapability[]
  allowedRoots: string[]
  maxToolCallsPerRun?: number
  validFrom: string
  validUntil: string
  revoked: boolean
  revocationReason?: string
  passportHash: string
  signature: string
  signerKeyId: string
  issuedAt: string
}

export interface IssuePassportInput {
  agentId: string
  agentRole: string
  principalName?: string
  capabilities: AgentCapability[]
  allowedRoots?: string[]
  validityHours?: number
  maxToolCallsPerRun?: number
}

export interface MnemeNode {
  id: string
  title: string
  path: string
  tags: string[]
  links: string[]
  summary: string
  updatedAt: string
}

export interface MnemeGraphSummary {
  nodeCount: number
  linkCount: number
  nodes: MnemeNode[]
  lastIndexedAt: string
}

export interface KubernisInsight {
  id: string
  title: string
  description: string
  severity: 'info' | 'suggestion' | 'warning'
  suggestedAction?: string
  sourceFile?: string
  timestamp: string
}

export type HarmoniaDecisionKind = 'patch' | 'action' | 'insight' | 'review'
export type HarmoniaDecisionStatus = 'pending' | 'accepted' | 'rejected' | 'applied'

export interface HarmoniaDecisionCard {
  cardId: string
  agentId: string
  agentName: string
  title: string
  summary: string
  kind: HarmoniaDecisionKind
  diff?: string
  suggestedAction: string
  status: HarmoniaDecisionStatus
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface HarmoniaDecisionInput {
  agentId: string
  agentName: string
  title: string
  summary: string
  kind: HarmoniaDecisionKind
  diff?: string
  suggestedAction: string
  metadata?: Record<string, unknown>
}

export interface AppInfo {
  version: string
  platform: string
  userDataPath: string
  isDev: boolean
  /** The operating-system account name, used only to seed the local profile. */
  userName?: string
}

export type BackendPermissionRule = 'allow' | 'deny' | 'ask'

export interface BackendProviderInfo {
  id: string
  name: string
  defaultModel: string
  available: boolean
  keyEnv: string | null
}

export interface BackendTierInfo {
  id: string
  name: string
  desc: string
  env: string[]
  model: string
  thinking: boolean
  effort: string | null
  multiplier: string
  context: number
}

export interface BackendAccountPublic {
  name: string
  email: string
  role: string
  planName: string
  planCredits: number
  addOnCredits: number
  creditBudget: number
}

export interface BackendGroundedActionsPublic {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  language: string
  temperature: number
  maxTokens: number
  maxSteps: number
}

export interface BackendSettingsPublic {
  providerId: string
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  model: string
  resolvedModel: string
  systemPrompt: string
  temperature: number
  maxOutputTokens: number
  maxIterations: number
  sandbox: boolean
  memoryEnabled: boolean
  permissions: Record<string, BackendPermissionRule>
  workspace: string | null
  tier: string
  tierConfig: Record<string, unknown>
  permissionMode: string
  computerUse: boolean
  avatar: string
  appIcon: string
  groundedActions: BackendGroundedActionsPublic
  mode: string
  account: BackendAccountPublic
  providers: BackendProviderInfo[]
  [key: string]: unknown
}

export interface BackendThemeStyle {
  id: string
  label: string
  builtin: boolean
  note: string
  accent: string
  swatches: Array<{ name: string; hex: string }>
  modes: string[]
}

export interface BackendModeInfo {
  id: string
  label: string
  greeting: string
  accent: string
  accentSoft: string
  accentText: string
  extras: string[]
}

export interface BackendCredits {
  plan: { used: number; total: number; remaining: number }
  addon: { used: number; total: number; remaining: number }
  tokens: number
  planName: string
}

export interface BackendMemoryNote {
  id: string
  text: string
  scope: string
  tags: string[]
  source: string
  createdAt: number
}

export interface BackendUsageSummary {
  days: Array<{ date: string; total: number; level: number }>
  totals: { prompt: number; completion: number; total: number; calls: number }
  byAgent: Record<string, number>
  monthLabels: Array<{ key: string; label: string }>
}

export interface BackendGatewayState {
  running: boolean
  url: string | null
  port: number | null
  agents: unknown[]
  bindings: unknown[]
  automations: unknown[]
  channels: unknown[]
}

export interface BackendWorkState {
  connected: boolean
  account: { email?: string; name?: string } | null
}

export interface BackendWorkFile {
  id: string
  name: string
  size?: number
  modified?: string
}

export interface BackendWorkMail {
  id: string
  subject: string
  from?: string
  received?: string
}

export type BackendEvent =
  | { type: 'permission'; id: string; tool: string; description?: string }
  | { type: 'provider'; providerId: string; model: string }
  | { type: 'gateway'; message: string }
  | { type: 'notice'; level: 'info' | 'success' | 'error'; message: string }

export interface BackendApi {
  settings: () => Promise<BackendSettingsPublic>
  saveSettings: (patch: Partial<BackendSettingsPublic>) => Promise<BackendSettingsPublic>
  credits: () => Promise<BackendCredits>
  themes: () => Promise<BackendThemeStyle[]>
  modes: () => Promise<BackendModeInfo[]>
  providers: () => Promise<BackendProviderInfo[]>
  tiers: () => Promise<BackendTierInfo[]>
  listMemories: () => Promise<BackendMemoryNote[]>
  addMemory: (input: {
    text: string
    scope?: string
    tags?: string[]
  }) => Promise<BackendMemoryNote[]>
  removeMemory: (id: string) => Promise<BackendMemoryNote[]>
  importMemories: (text: string) => Promise<BackendMemoryNote[]>
  usage: () => Promise<BackendUsageSummary>
  startGateway: () => Promise<BackendGatewayState>
  stopGateway: () => Promise<BackendGatewayState>
  gatewayStatus: () => Promise<BackendGatewayState>
  gatewayToken: () => Promise<string>
  subscriptionStatus: () => Promise<{ connected: boolean }>
  subscriptionModels: () => Promise<string[]>
  workStatus: () => Promise<BackendWorkState>
  workBeginSignIn: (clientId?: string) => Promise<{ prompt: string }>
  workCompleteSignIn: () => Promise<{ ok: boolean; email?: string; error?: string }>
  workDisconnect: () => Promise<{ ok: boolean }>
  workFiles: () => Promise<BackendWorkFile[]>
  workMail: () => Promise<BackendWorkMail[]>
  computerStatus: () => Promise<{ enabled: boolean }>
  groundedActionsStatus: () => Promise<{ enabled: boolean; model: string; baseUrl: string }>
  marketplaceSearch: (query: string) => Promise<unknown[]>
  marketplaceInstall: (id: string) => Promise<{ ok: boolean }>
  registrySearch: (query: string) => Promise<unknown[]>
  externalAgentStatus: () => Promise<{ installed: boolean; version?: string }>
  answerPermission: (id: string, allowed: boolean) => Promise<{ ok: boolean }>
  onEvent: (cb: (event: BackendEvent) => void) => () => void
}

export interface EnterpriseControlApi {
  snapshot: () => Promise<EnterpriseControlSnapshot>
  mutate: (mutation: EnterpriseControlMutation) => Promise<EnterpriseControlSnapshot>
  authorize: (request: EnterpriseAuthorization) => Promise<EnterpriseDecision>
  revision: (revision: number) => Promise<{ info: EnterpriseRevisionInfo; state: EnterpriseControlState }>
}

export interface KnightApi {
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<PublicSettings>
  saveSettings: (patch: SettingsPatch) => Promise<PublicSettings>
  testProvider: (input: ProviderInput) => Promise<TestProviderResult>
  fetchModels: (input: ProviderInput) => Promise<string[]>
  getImpCodesAccess: () => Promise<ImpCodesAccess>
  importImpCodesAccess: () => Promise<ImpCodesImportResult>
  getSecurityPosture: () => Promise<SecurityPosture>
  getEngineStatus: () => Promise<EngineStatusPublic>

  listTasks: () => Promise<TaskSummary[]>
  createTask: (input: CreateTaskInput) => Promise<Task>
  getTask: (id: string) => Promise<Task | null>
  deleteTask: (id: string) => Promise<void>
  sendMessage: (input: SendMessageInput) => Promise<Task>
  steerTask: (input: SendMessageInput) => Promise<Task>
  editMessage: (input: EditMessageInput) => Promise<Task>
  stopTask: (id: string) => Promise<void>
  resumeTask: (id: string) => Promise<void>
  updateTask: (input: UpdateTaskInput) => Promise<Task>
  reactToMessage: (input: MessageReactionInput) => Promise<Task>
  rateMessage: (input: MessageFeedbackInput) => Promise<Task>
  addFolder: (id: string) => Promise<Task | null>
  removeFolder: (id: string, folder: string) => Promise<Task>
  listChanges: (id: string) => Promise<SnapshotEntry[]>
  revertChanges: (id: string, toStep?: string) => Promise<RevertOutcome>
  redoChanges: (id: string, toStep?: string) => Promise<RevertOutcome>
  listSteps: (id: string) => Promise<string[]>
  pickFolder: () => Promise<string | null>
  pickFiles: () => Promise<AttachmentRef[]>
  attachDroppedFiles: (files: File[]) => Promise<AttachmentRef[]>
  /** Writes a clipboard image into this task's attachments and returns its ref. */
  attachPastedImage: (input: PastedImageInput) => Promise<AttachmentRef>
  /** Grabs the current screen in the main process and returns its attachment ref. */
  captureScreen: (taskId?: string) => Promise<AttachmentRef>

  respondApproval: (decision: ApprovalDecision) => Promise<void>
  openArtifact: (taskId: string, relPath: string) => Promise<void>
  revealArtifact: (taskId: string, relPath: string) => Promise<void>

  listSchedules: () => Promise<ScheduleRecord[]>
  createSchedule: (input: CreateScheduleInput) => Promise<ScheduleRecord>
  updateSchedule: (id: string, patch: Partial<CreateScheduleInput> & { enabled?: boolean }) => Promise<ScheduleRecord>
  deleteSchedule: (id: string) => Promise<void>
  runScheduleNow: (id: string) => Promise<void>

  listMcp: () => Promise<McpServerStatus[]>
  upsertMcp: (config: McpServerConfig) => Promise<McpServerStatus[]>
  removeMcp: (id: string) => Promise<void>
  restartMcp: (id?: string) => Promise<McpServerStatus[]>
  addReaPreset: () => Promise<McpServerStatus[]>
  searchMcpMarket: (query: string) => Promise<McpMarketSearchResult[]>
  readMcpMarket: (id: string) => Promise<McpMarketDetail | null>
  installMcpMarket: (id: string) => Promise<McpMarketInstallResult>

  listAgentTools: () => Promise<BuiltinToolSummary[]>
  listSkills: () => Promise<SkillSummary[]>
  searchSkills: (query: string, registry?: SkillSource) => Promise<SkillMarketResult[]>
  installSkill: (ref: string, registry?: SkillSource) => Promise<SkillSummary[]>
  readSkill: (id: string) => Promise<SkillDetail | null>
  createSkill: (draft: SkillDraft) => Promise<SkillSummary[]>
  removeSkill: (id: string) => Promise<SkillSummary[]>

  /** Proposals distilled from documents; a human decision is the only path to a skill. */
  knowledgeList: () => Promise<KnowledgeProposalView[]>
  knowledgeDecide: (input: KnowledgeDecisionInput) => Promise<KnowledgeDecideResult>

  marketspaceList: (query?: string) => Promise<MarketspaceEntry[]>
  marketspaceRead: (id: string) => Promise<MarketspaceDetail | null>
  marketspaceInstall: (id: string) => Promise<MarketspaceDetail>
  marketspaceCreate: (input: MarketspaceCreateInput) => Promise<MarketspaceDetail>
  marketspaceRemove: (id: string) => Promise<MarketspaceEntry[]>
  marketspaceApply: (taskId: string, id: string, overwrite?: boolean) => Promise<MarketspaceApplyResult>

  listMemories: () => Promise<MemoryNote[]>
  addMemory: (input: MemoryInput) => Promise<MemoryNote[]>
  removeMemory: (id: string) => Promise<MemoryNote[]>
  importMemories: (text: string) => Promise<MemoryNote[]>

  getUsageSummary: () => Promise<UsageSummary>

  connectorsState: (refresh?: boolean) => Promise<ConnectorsState>
  saveConnectors: (input: ConnectorsInput) => Promise<ConnectorsState>
  connectConnectors: (toolkit: string) => Promise<ConnectorsConnectResult>
  disconnectConnectors: (toolkit: string) => Promise<ConnectorsState>

  channelState: () => Promise<ChannelState>
  upsertChannel: (input: ChannelInput) => Promise<ChannelState>
  removeChannel: (id: string) => Promise<ChannelState>
  restartChannels: () => Promise<ChannelState>

  listSubAgents: () => Promise<SubAgentRun[]>
  listSpecialists: () => Promise<Record<string, unknown>>
  resolveAwakeable: (id: string, result: unknown) => Promise<boolean>
  rejectAwakeable: (id: string, error: string) => Promise<boolean>

  showBrowser: (taskId: string, scope?: string) => Promise<void>

  librarySnapshot: () => Promise<LibrarySnapshot>
  libraryCreateCollection: (name: string) => Promise<LibraryCollection>
  libraryCreatePage: (input: LibraryPageInput) => Promise<LibraryPage>
  libraryUpdatePage: (id: string, patch: LibraryPagePatch) => Promise<LibraryPage>
  libraryDeletePage: (id: string) => Promise<boolean>
  onLibraryChanged: (cb: () => void) => () => void

  tableGetState: () => Promise<TableState>
  tableHost: (input: TableHostInput) => Promise<TableState>
  tableJoin: (input: TableJoinInput) => Promise<TableState>
  tableSetGoal: (input: TableGoalInput) => Promise<TableState>
  tablePropose: (input: TableProposalInput) => Promise<TableState>
  tableTurnKey: (proposalId: string) => Promise<TableState>
  tableWithdraw: (proposalId: string) => Promise<TableState>
  tablePublish: (proposalId: string) => Promise<TableState>
  tableMarkDone: (proposalId: string) => Promise<TableState>
  tableLeave: () => Promise<TableState>

  onTaskEvent: (cb: (event: TaskEvent) => void) => () => void
  onApprovalRequest: (cb: (request: ApprovalRequest) => void) => () => void

  auditSummary: () => Promise<AuditSummary>
  auditEvents: (query?: AuditEventQuery) => Promise<AuditEventView[]>
  auditExport: () => Promise<AuditExportResult | null>
  auditVerify: () => Promise<AuditVerifyResult | null>
  inspectDlp: (
    text: string,
    categories?: SensitiveDataCategory[]
  ) => Promise<DlpInspection>
  enterpriseControl: EnterpriseControlApi
  rsiralsSnapshot: () => Promise<RsiralsSnapshot>
  rsiralsOctaStatus: () => Promise<RsiralsOctaStatus>
  rsiralsFastLoop: (action: unknown, context?: unknown) => Promise<unknown>
  rsiralsDiagnose: (trace: unknown, failure: unknown) => Promise<unknown>
  rsiralsInduceSkill: (req: unknown) => Promise<unknown>
  rsiralsPublishClaim: (params: unknown) => Promise<unknown>
  rsiralsAcquireCharter: (params: unknown) => Promise<unknown>
  rsiralsMetaEvolve: (candidate: unknown, evidence: unknown) => Promise<unknown>

  /* ── Nomos: the governance gate ─────────────────────────────────────────── */
  governanceSummary: () => Promise<GovernanceSummaryView>
  governanceRecent: (limit?: number) => Promise<GovernanceRecordView[]>
  governanceEngageKill: (reason: string) => Promise<KillSwitchState>
  governanceReleaseKill: () => Promise<KillSwitchState>

  /* ── Sphragis: the signed receipt chain ─────────────────────────────────── */
  receiptSummary: () => Promise<ReceiptSummaryView>
  receiptRecent: (limit?: number) => Promise<ReceiptView[]>
  receiptVerify: () => Promise<ReceiptVerifyView>

  /* ── Aion: the durable missions ─────────────────────────────────────────── */
  missionList: () => Promise<MissionSummaryView[]>
  missionGet: (missionId: string) => Promise<MissionSummaryView | null>
  missionApprove: (input: {
    missionId: string
    approve: boolean
    by: string
    note?: string
  }) => Promise<MissionSummaryView | null>
  missionCancel: (missionId: string) => Promise<MissionSummaryView | null>
  missionResume: (missionId: string) => Promise<MissionSummaryView | null>
  /** Settle a mission interrupted mid-step. With no resolution the step's own
   *  reconcile hook is asked; with one, the human's verdict wins. */
  missionReconcile: (
    missionId: string,
    resolution?: 'done' | 'failed'
  ) => Promise<MissionSummaryView | null>
  missionStartRepoScan: (root: string) => Promise<MissionSummaryView>

  /* ── Team Playbooks & Proof of Work ─────────────────────────────────────── */
  teamPlaybookList: () => Promise<TeamPlaybook[]>
  teamPlaybookGet: (id: string) => Promise<TeamPlaybook | null>
  teamPlaybookSave: (playbook: Omit<TeamPlaybook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<TeamPlaybook>
  teamPlaybookDelete: (id: string) => Promise<boolean>
  teamPlaybookSnapshot: (input: { sessionId: string; title: string; description?: string }) => Promise<TeamPlaybook>
  teamPlaybookInstantiate: (input: { playbookId: string; workspacePath: string }) => Promise<{ taskIds: string[] }>
  proofOfWorkList: (teamSessionId?: string) => Promise<ProofOfWorkRecord[]>
  proofOfWorkExportCertificate: (input: { teamSessionId: string; outputPath?: string; playbookTitle?: string }) => Promise<ProofOfWorkCertificate>
  proofOfWorkVerifyCertificate: (certificate: ProofOfWorkCertificate) => Promise<{ valid: boolean; reason?: string }>

  /* ── Diabaterion: Agent Passport System ─────────────────────────────────── */
  passportList: () => Promise<AgentPassport[]>
  passportGet: (agentId: string) => Promise<AgentPassport | null>
  passportIssue: (input: IssuePassportInput) => Promise<AgentPassport>
  passportRevoke: (input: { passportId: string; reason: string }) => Promise<boolean>
  passportVerify: (passportId: string) => Promise<{ valid: boolean; reason?: string }>

  /* ── Mneme & Kubernis: Local Knowledge Graph & Proactivity ──────────────── */
  mnemeQuery: (query: string) => Promise<MnemeNode[]>
  mnemeSummary: (workspacePath?: string) => Promise<MnemeGraphSummary>
  mnemeSync: (workspacePath?: string) => Promise<MnemeGraphSummary>
  kubernisInsights: (workspacePath?: string) => Promise<KubernisInsight[]>

  /* ── Harmonia: Executive Decision Card Feed (Open-Duet style) ───────────── */
  harmoniaList: (status?: HarmoniaDecisionStatus) => Promise<HarmoniaDecisionCard[]>
  harmoniaCreate: (input: HarmoniaDecisionInput) => Promise<HarmoniaDecisionCard>
  harmoniaDecide: (input: { cardId: string; decision: 'accept' | 'reject'; comment?: string }) => Promise<HarmoniaDecisionCard>

  /* ── ROOK: Unified Dual-Engine & Digital Worker ──────────────────────────── */
  rookStatus: () => Promise<{
    ready: boolean
    permissionMode: 'plan' | 'build' | 'yolo'
    executionTurns: number
    deliverablesCount: number
    changeRequestsCount: number
    pendingGatesCount: number
  }>
  rookSetPermission: (mode: 'plan' | 'build' | 'yolo') => Promise<{ activeRegime: 'plan' | 'build' | 'yolo' }>
  rookListChangeRequests: () => Promise<any[]>
  rookReviewChangeRequest: (id: string, decision: 'approved' | 'rejected') => Promise<any>
  rookApplyChangeRequest: (id: string) => Promise<any>
  rookListDeliverables: () => Promise<any[]>
  rookListPendingGates: () => Promise<any[]>
  rookResolveGate: (id: string, response: { selectedOption?: string; userAnswer?: string }) => Promise<any>
  rookSynthesizeResearch: (topic: string, sources: Array<{ title: string; url: string; snippet: string }>) => Promise<any>

  /* ── Promey: Proactive Executive Duet Substrate ──────────────────────────── */
  promeyStatus: () => Promise<any>
  promeyGenerateBrief: (userName?: string, workspaceName?: string) => Promise<any>
  promeyListTriage: () => Promise<any[]>
  promeyTriageItem: (item: any) => Promise<any>
  promeyResolveTriage: (id: string, note?: string) => Promise<boolean>
  promeyListApprovals: () => Promise<any[]>
  promeySubmitApproval: (id: string, decision: 'allow_once' | 'always_allowed' | 'refused', note?: string) => Promise<any>
  promeyListRoutines: () => Promise<any[]>
  promeyToggleRoutine: (id: string, active: boolean) => Promise<boolean>
  promeySanitize: (text: string) => Promise<any>

  /* ── Cowork: Subsystem & Lobe Skills ─────────────────────────────────────── */
  coworkStatus: () => Promise<any>
  coworkSearchSkills: (query: string) => Promise<any[]>
  coworkEnterpriseSummary: () => Promise<any>
  coworkIssuePassport: (principal: string) => Promise<any>
  coworkGetBlastRadius: () => Promise<any>
  coworkListProofs: () => Promise<any[]>
  coworkListRules: () => Promise<any[]>

  backend: BackendApi
}
