import crypto from 'node:crypto'

export interface EnterpriseAgentPassport {
  passportId: string;
  principal: string;
  agentRole: string;
  issuedAt: number;
  expiresAt: number;
  allowedScopes: string[];
  publicKey: string;
  signature: string;
  revoked: boolean;
}

export interface BlastRadiusBudget {
  maxTokensPerRun: number;
  maxSpendDollars: number;
  maxFileWritesPerHour: number;
  maxNetworkRequestsPerHour: number;
  currentTokens: number;
  currentSpendDollars: number;
  currentWrites: number;
  currentNetworkCalls: number;
  escalationLevel: 'normal' | 'caution' | 'quarantined';
  lastResetAt: number;
}

export interface ToolAttestedProof {
  proofId: string;
  toolName: string;
  inputDigest: string;
  outputDigest: string;
  timestamp: number;
  attestationSignature: string;
  verified: boolean;
}

export interface MemoryPartition {
  partitionId: string;
  namespace: string;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  allowedRoles: string[];
  entryCount: number;
  tamperSealHash: string;
}

export interface HarnessEvolutionRule {
  ruleId: string;
  domain: string;
  patternDetected: string;
  distilledStrategy: string;
  confidenceScore: number;
  appliedRunsCount: number;
  createdAt: number;
}
