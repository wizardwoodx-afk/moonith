import { cloneRolePrompt, type NodeDefinition } from "../domain/nodeLibrary";
import type { NodeInstance } from "../domain/types";

export function createNodeFromDef(def: NodeDefinition, id: string, x: number, y: number): NodeInstance {
  const node: NodeInstance = {
    id,
    definitionId: def.id,
    title: def.title,
    x,
    y,
    purpose: def.defaultPurpose ?? "",
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p })),
    config: Object.fromEntries((def.configSchema ?? []).map((c) => [c.key, c.default ?? ""])),
    rolePrompt: def.rolePrompt
      ? cloneRolePrompt(def.rolePrompt)
      : {
          sections: {
            identity: def.title,
            mission: "",
            operatingPrinciples: "",
            procedures: "",
            toolStrategy: "",
            verificationStrategy: "",
            collaborationRules: "",
            learningRules: "",
            invariants: `You are a ${def.title}. You never act outside this identity.`,
          },
          version: 1,
        },
    feedbackLoop: def.feedbackLoopDefault ?? "OFF",
    evolutionMode: def.evolutionModeDefault ?? "OFF",
    reflection: { enabled: false, maxAttempts: 2, passThreshold: 7 },
    permissions: {
      filesystemRead: false,
      filesystemWrite: false,
      terminalExecute: false,
      networkAccess: false,
      browserControl: false,
      mcpUse: false,
      providerExecute: def.category === "agent",
      workflowModify: false,
      memoryWrite: true,
      skillWrite: true,
      evolutionPropose: true,
      evolutionAccept: false,
      secretResolve: false,
      ...(def.permissions ?? {}),
    },
    contract: {
      requiredCapabilities: def.requiredPermissions ?? [],
      sideEffects: [],
      successCriteria: "Output satisfies the declared output schema and the stated success criteria.",
      failureCriteria: "Output cannot be produced within timeout or fails validation.",
      timeoutMs: def.contractTimeoutMs ?? 180000,
      retryPolicy: { maxAttempts: 2, backoffMs: 1500 },
    },
    providers: def.providers
      ? structuredClone(def.providers)
      : def.category === "agent"
        ? [{ kind: "builtin-agent" }]
        : [],
    allowedMcpServers: [],
    memoryEnabled: true,
  };
  if (def.category === "agent") {
    node.config.harness = node.config.harness || "hermes";
    node.permissions.terminalExecute = true;
    node.permissions.filesystemRead = true;
    node.permissions.mcpUse = true;
    node.permissions.providerExecute = true;
  }
  return node;
}
