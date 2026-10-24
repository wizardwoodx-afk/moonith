/**
 * A no-op stand-in for the SelfTrace tracing client.
 *
 * WHY THIS EXISTS
 * ---------------
 * SelfImpulse Core imports SelfTrace for tracing. SelfImpulse does not trace to
 * SelfTrace and must not: a hosted trace of a mission would be a second record
 * of that mission, kept somewhere the owner cannot verify it and cannot delete
 * it. Every SelfImpulse run already lands in the receipt chain, which verifies
 * offline with one command and no state — that is the record, and it is the
 * only one.
 *
 * So this module answers every call honestly and does nothing: no run tree is
 * created, nothing is queued, nothing leaves the machine.
 */
export class RunTree {
  constructor(config = {}) {
    this.name = config.name ?? "run";
    this.tracingEnabled = false;
    this.extra = {};
    this.id = config.id ?? null;
    this.startTime = Date.now();
    this.endTime = null;
    this.runId = config.runId ?? null;
    this.parentRunId = config.parentRunId ?? null;
    this.tags = config.tags ?? [];
    this.metadata = config.metadata ?? {};
    this.outputs = {};
    this.error = undefined;
  }
  addMetadata() { return this; }
  addTags() { return this; }
  addEvent() { return this; }
  end(outputs) { this.endTime = Date.now(); this.outputs = outputs ?? {}; return this; }
  async endRun(outputs) { return this.end(outputs); }
  toJSON() { return { name: this.name, id: this.id, extra: this.extra }; }
}

/** A client that would talk to SelfTrace, and does not. */
export class Client {
  constructor(config = {}) {
    this.apiKey = config.apiKey ?? null;
    this.apiUrl = config.apiUrl ?? null;
  }
  async createRun() { return null; }
  async updateRun() { return null; }
  async readRun() { return null; }
  async listRuns() { return []; }
  async *listExamples() {
    throw new Error("hosted dataset loading is not available in SelfImpulse; use the local document and mission stores instead.");
  }
  async hasProject() { return false; }
  async flush() { return undefined; }
}

/** Ordering helper — a pass-through, because there is no trace to order. */
export function convertToDottedOrderFormat(order) { return order; }

/** There is never a current run tree, because no run tree is ever created. */
export function getCurrentRunTree() { return undefined; }

/** Nothing in this tree is a SelfTrace run tree. */
export function isRunTree() { return false; }

/** Nothing in this tree was decorated with @traceable. */
export function isTraceableFunction() { return false; }

export default { RunTree, Client, convertToDottedOrderFormat, getCurrentRunTree, isRunTree, isTraceableFunction };
