import { portsCompatible } from "../domain/dataTypes";
import type { Connection, DataType, NodeInstance, WorkflowGraph } from "../domain/types";

export interface ValidationIssue {
  nodeId?: string;
  portId?: string;
  connectionId?: string;
  severity: "error" | "warning";
  message: string;
}

export function validateWorkflow(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const conns = graph.connections;

  if (graph.nodes.length === 0) {
    issues.push({ severity: "warning", message: "Workflow is empty." });
    return issues;
  }

  for (const node of graph.nodes) {
    for (const port of node.inputs) {
      if (port.required && !conns.some((c) => c.targetNodeId === node.id && c.targetPortId === port.id)) {
        issues.push({
          nodeId: node.id,
          portId: port.id,
          severity: "error",
          message: `Node "${node.title}" is missing required input "${port.label}" (${port.dataType}).`,
        });
      }
    }
    if (node.purpose.trim() === "" && node.inputs.length > 0 && node.definitionId.startsWith("agent.")) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `Agent node "${node.title}" has no Purpose set.`,
      });
    }
    if (!node.contract || typeof node.contract.timeoutMs !== "number" || node.contract.timeoutMs <= 0) {
      issues.push({
        nodeId: node.id,
        severity: "error",
        message: `Node "${node.title}" has an invalid execution timeout.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const conn of conns) {
    const key = `${conn.sourceNodeId}:${conn.sourcePortId}->${conn.targetNodeId}:${conn.targetPortId}`;
    if (seen.has(key)) {
      issues.push({ connectionId: conn.id, severity: "error", message: "Duplicate connection between the same ports." });
    }
    seen.add(key);

    const src = nodes.get(conn.sourceNodeId);
    const tgt = nodes.get(conn.targetNodeId);
    if (!src || !tgt) {
      issues.push({ connectionId: conn.id, severity: "error", message: "Connection references missing nodes." });
      continue;
    }
    const srcPort = src.outputs.find((p) => p.id === conn.sourcePortId);
    const tgtPort = tgt.inputs.find((p) => p.id === conn.targetPortId);
    if (!srcPort) {
      issues.push({
        nodeId: src.id,
        portId: conn.sourcePortId,
        connectionId: conn.id,
        severity: "error",
        message: `Source port not found on "${src.title}".`,
      });
    }
    if (!tgtPort) {
      issues.push({
        nodeId: tgt.id,
        portId: conn.targetPortId,
        connectionId: conn.id,
        severity: "error",
        message: `Target port not found on "${tgt.title}".`,
      });
    }
    if (srcPort && tgtPort) {
      if (!portsCompatible(srcPort.dataType as DataType, tgtPort.dataType as DataType)) {
        issues.push({
          nodeId: tgt.id,
          portId: tgtPort.id,
          connectionId: conn.id,
          severity: "error",
          message: `Type mismatch: "${src.title}.${srcPort.label}" emits ${srcPort.dataType} but "${tgt.title}.${tgtPort.label}" expects ${tgtPort.dataType}.`,
        });
      }
      if (!tgtPort.multiple) {
        const duplicates = conns.filter(
          (c) => c !== conn && c.targetNodeId === conn.targetNodeId && c.targetPortId === conn.targetPortId,
        );
        if (duplicates.length > 0) {
          issues.push({
            nodeId: tgt.id,
            portId: tgtPort.id,
            severity: "error",
            message: `Input "${tgtPort.label}" on "${tgt.title}" accepts a single connection but receives multiple.`,
          });
        }
      }
    }
  }

  const cycle = findCycle(graph.nodes, conns);
  if (cycle) {
    issues.push({
      severity: "error",
      message: `Cycle detected: ${cycle.map((id) => nodes.get(id)?.title ?? id).join(" → ")}`,
    });
  }

  const consumed = new Set<string>([...conns.map((c) => c.sourceNodeId), ...conns.map((c) => c.targetNodeId)]);
  for (const node of graph.nodes) {
    if (!consumed.has(node.id) && graph.nodes.length > 1) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `Node "${node.title}" is isolated (no connections).`,
      });
    }
  }

  return issues;
}

function findCycle(nodes: NodeInstance[], conns: Connection[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const c of conns) {
    if (adj.has(c.sourceNodeId)) adj.get(c.sourceNodeId)!.push(c.targetNodeId);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const dfs = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) {
        stack.push(next);
        return true;
      }
      if (s === 0 && dfs(next)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };

  for (const n of nodes) {
    if ((state.get(n.id) ?? 0) === 0) {
      stack.length = 0;
      if (dfs(n.id)) {
        const last = stack[stack.length - 1];
        const at = stack.indexOf(last);
        return stack.slice(at);
      }
    }
  }
  return null;
}

export function topoSort(nodes: NodeInstance[], conns: Connection[]): string[] {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const c of conns) {
    adj.get(c.sourceNodeId)?.push(c.targetNodeId);
    indeg.set(c.targetNodeId, (indeg.get(c.targetNodeId) ?? 0) + 1);
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) throw new Error("graph contains a cycle");
  return order;
}
