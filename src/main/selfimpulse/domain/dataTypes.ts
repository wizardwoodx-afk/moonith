import type { DataType } from "./types";

const COMPAT: Record<DataType, DataType[]> = {
  any: [],
  Text: ["Text", "Markdown", "JSON", "URL", "Number", "Boolean"],
  Markdown: ["Markdown", "Text"],
  JSON: ["JSON", "Object", "Array", "Text"],
  Object: ["Object", "JSON", "WorkflowContext", "RepositoryContext", "AgentResult"],
  Array: ["Array", "JSON"],
  Image: ["Image", "File"],
  File: ["File", "Image"],
  URL: ["URL", "Text"],
  BrowserSession: ["BrowserSession"],
  AgentResult: ["AgentResult", "Text", "Markdown", "Object"],
  Evaluation: ["Evaluation", "JSON", "Object", "Text", "Markdown", "AgentResult"],
  Boolean: ["Boolean", "Text", "Number"],
  Number: ["Number", "Text"],
  Stream: ["Stream", "Text"],
  Event: ["Event", "JSON"],
  // V6 fix: a mission/workflow payload is routinely handed to an agent as its brief.
  // Without Text/Markdown/JSON here, every Start -> Agent wire was silently dropped.
  WorkflowContext: ["WorkflowContext", "Object", "Text", "Markdown", "JSON", "URL", "any"],
  RepositoryContext: ["RepositoryContext", "Object"],
  Error: ["Error", "Text"],
};

export function portsCompatible(source: DataType, target: DataType): boolean {
  if (source === "any" || target === "any") return true;
  if (source === target) return true;
  return (COMPAT[source] ?? []).includes(target);
}

export const DATA_TYPE_COLORS: Record<DataType, string> = {
  // v13.0 — mineral wire tones (muted mid-luminance so they read on every
  // palette, dark or light). No violet, no neon: steel / moss / bronze /
  // ochre / slate / bone stay inside the OBSIDIAN system's rare-mineral voice.
  any: "#7B7770",
  Text: "#7E97A5",
  Markdown: "#7E97A5",
  JSON: "#63907B",
  Object: "#63907B",
  Array: "#63907B",
  Image: "#B08D5B",
  File: "#B08D5B",
  URL: "#7E97A5",
  BrowserSession: "#C3A453",
  AgentResult: "#CFC7B6",
  Evaluation: "#97A874",
  Boolean: "#8B9AA6",
  Number: "#B58A66",
  Stream: "#E2DCCE",
  Event: "#7EB38A",
  WorkflowContext: "#8AA3B3",
  RepositoryContext: "#8AA3B3",
  Error: "#E8341C",
};
