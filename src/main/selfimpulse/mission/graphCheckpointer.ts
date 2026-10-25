/**
 * §GRAPH CHECKPOINTS — the graph runtime's durability, recorded in SelfImpulse's own
 * tamper-evident run chain.
 *
 * WHY THIS EXISTS
 * ---------------
 * The graph runtime is the one piece of machinery this project borrows rather than
 * writes: a graph runtime with checkpointed execution. Its value to
 * SelfImpulse is not the graph — it is the CHECKPOINT. A run that pauses for
 * a human, or that a crash interrupts half way through, must be able to pick
 * up exactly where it stopped rather than start over.
 *
 * But a checkpoint that lives only in the runtime's own memory is a checkpoint
 * a crash loses, and a checkpoint stored somewhere unverifiable is a claim
 * rather than evidence. SelfImpulse already has the right answer for this
 * shape of problem — the run chain in `runCheckpoints.ts`: an append-only,
 * digest-linked series of steps that any auditor can recompute, that refuses
 * to resume into a state nobody can prove, and that survives a restart
 * because the journal reaches storage the moment it is written.
 *
 * So this module is an ADAPTER, not a store. Every super-step the graph
 * takes lands in the run chain as a normal checkpoint, digest-linked to the
 * step before it, and the graph's own checkpoint payload travels inside that
 * checkpoint's state. The result is that:
 *
 *   • a graph run's history is the run's history — one chain, one story;
 *   • `verifyRunChain(runId)` recomputes and refuses an edited graph step
 *     exactly as it refuses an edited label;
 *   • `resumeRunFrom(runId)` returns the graph's own resume point, verified;
 *   • the graph's durability survives a restart with no new machinery.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not add a second journal, a second chain, or a second source of
 * truth. It does not silently keep its own copy of the state either: every
 * read goes back to the chain, so the chain stays the only record. And it
 * does not delete: `deleteThread` refuses in words, because a run chain in
 * this product is evidence, and evidence is not deleted by a library call.
 */
import { BaseCheckpointSaver } from "../roi/checkpoint/index.js";
import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  ChannelVersions,
  PendingWrite,
} from "../roi/checkpoint/index.js";
import type { RunnableConfig } from "../roi/core/runnables/index.js";
import {
  chainFor,
  checkpoint as recordChainCheckpoint,
  runJournal,
  verifyRunChain,
} from "./runCheckpoints";

/** The chain-entry label prefix for a graph super-step. */
const STEP_LABEL = "lg:step";
/** The chain-entry label prefix for a super-step's pending writes. */
const WRITES_LABEL = "lg:writes";

/** The payload this adapter stores in the chain's state slot. */
interface ChainPayload {
  /** The graph's own checkpoint. */
  lg?: Checkpoint;
  /** The graph's own metadata, trimmed to the fields that mean something here. */
  meta?: { source: string; step: number; parents: Record<string, string> } | null;
  /** Pending writes recorded for a checkpoint, when this entry holds them. */
  writes?: { taskId: string; taskPath: string; writes: PendingWrite[] }[];
  /** The graph checkpoint this entry's writes belong to. */
  owner?: string;
}

/** The run id a config points at. The runtime threads it as `thread_id`. */
function threadOf(config: RunnableConfig | undefined): string {
  const id = (config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.thread_id;
  return typeof id === "string" ? id : "";
}

/** The checkpoint id a config points at, when it names one. */
function checkpointOf(config: RunnableConfig | undefined): string | undefined {
  const id = (config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.checkpoint_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * The chain entries of a run, with their payloads decoded.
 */
function pendingWritesOf(
  entries: { label: string; payload: ChainPayload }[],
  checkpointId: string,
): CheckpointPendingWrite[] {
  const out: CheckpointPendingWrite[] = [];
  for (const entry of entries) {
    if (!entry.label.includes(`${WRITES_LABEL}:${checkpointId}:`)) continue;
    for (const stored of entry.payload.writes ?? []) {
      for (const write of stored.writes) {
        const [channel, value] = write;
        out.push([stored.taskId, channel, value] as CheckpointPendingWrite);
      }
    }
  }
  return out;
}

/**
 * A checkpointer that writes a graph's super-steps into SelfImpulse's run
 * chain.
 *
 * The chain is the storage. This class reads it back through the journal's
 * own serialization (`runJournal`), so there is exactly one copy of a run's
 * state — the chain's — and no second cache that could disagree with it.
 */
export class RunChainCheckpointer extends BaseCheckpointSaver {
  private readonly missionId: string;
  private readonly labelPrefix: string;

  constructor(missionId: string, labelPrefix = "mission") {
    super();
    this.missionId = missionId;
    this.labelPrefix = labelPrefix;
  }

  /** The chain entries of a run, newest last, with their payloads decoded. */
  private entries(runId: string): { step: number; label: string; payload: ChainPayload }[] {
    let doc: { runs?: Record<string, unknown[]>; states?: Record<string, Record<string, string>> };
    try {
      doc = JSON.parse(runJournal(runId)) as typeof doc;
    } catch {
      return [];
    }
    const chain = (doc.runs?.[runId] ?? []) as { step: number; label: string; stateDigest: string }[];
    const states = doc.states?.[runId] ?? {};
    const out: { step: number; label: string; payload: ChainPayload }[] = [];
    for (const entry of chain) {
      const raw = states[entry.stateDigest];
      if (raw === undefined) continue;
      let payload: ChainPayload;
      try {
        payload = JSON.parse(raw) as ChainPayload;
      } catch {
        continue;
      }
      out.push({ step: entry.step, label: entry.label, payload });
    }
    return out;
  }

  /** Store one super-step. */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const runId = threadOf(config);
    if (!runId) {
      throw new Error("a graph run must carry a thread_id — without one there is no run chain to write to, and a checkpoint with nowhere to land is not a checkpoint.");
    }
    /* The chain owns its step numbering: an entry's step is its position in
     * THIS run's chain. The graph's own step number is a different fact — it
     * starts at -1 for the input checkpoint and does not advance for a
     * super-step's pending writes — so it is recorded in the label and in the
     * payload, where it is evidence rather than an index. Borrowing the
     * graph's numbering here would put a negative step into a chain that
     * refuses negative steps, and would let two entries claim the same
     * position. */
    const graphStep = typeof metadata?.step === "number" ? metadata.step : 0;
    const step = chainFor(runId).length;
    recordChainCheckpoint(
      runId,
      this.missionId,
      step,
      `${this.labelPrefix}:${STEP_LABEL}:${graphStep}`,
      {
        lg: checkpoint,
        meta: metadata
          ? { source: metadata.source, step: metadata.step, parents: metadata.parents ?? {} }
          : null,
        writes: [],
      } satisfies ChainPayload,
    );
    return {
      ...config,
      configurable: { ...(config.configurable ?? {}), thread_id: runId, checkpoint_id: checkpoint.id },
    } as RunnableConfig;
  }

  /**
   * Store a super-step's pending writes.
   *
   * These are the writes a crashed super-step had already produced — the
   * reason the runtime can resume a partially-executed step without re-running
   * what already succeeded. They are recorded in the chain as their own
   * entry, linked to the checkpoint they belong to, so the evidence shows the
   * partial step rather than hiding it.
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = "",
  ): Promise<void> {
    const runId = threadOf(config);
    if (!runId) return;
    const owner = checkpointOf(config) ?? "";
    const step = chainFor(runId).length;
    recordChainCheckpoint(runId, this.missionId, step, `${this.labelPrefix}:${WRITES_LABEL}:${owner}:${taskId}`, {
      owner,
      writes: [{ taskId, taskPath, writes }],
    } satisfies ChainPayload);
  }

  /** The newest checkpoint of a run, or the one a config names. */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const runId = threadOf(config);
    if (!runId) return undefined;
    const wanted = checkpointOf(config);
    const entries = this.entries(runId);

    let index = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      const lg = entries[i].payload.lg;
      if (!lg) continue;
      if (!wanted || lg.id === wanted) {
        index = i;
        break;
      }
    }
    if (index < 0) return undefined;

    const entry = entries[index];
    const lg = entry.payload.lg!;
    const parent = entries
      .slice(0, index)
      .reverse()
      .find((e) => e.payload.lg !== undefined);

    const pendingWrites = pendingWritesOf(entries, lg.id);

    return {
      config: {
        configurable: { thread_id: runId, checkpoint_id: lg.id },
      } as RunnableConfig,
      checkpoint: lg,
      metadata: entry.payload.meta
        ? ({
            source: entry.payload.meta.source,
            step: entry.payload.meta.step,
            parents: entry.payload.meta.parents,
          } as unknown as CheckpointMetadata)
        : undefined,
      parentConfig: parent?.payload.lg
        ? ({
            configurable: { thread_id: runId, checkpoint_id: parent.payload.lg.id },
          } as RunnableConfig)
        : undefined,
      ...(pendingWrites.length > 0 ? { pendingWrites } : {}),
    };
  }

  /** Every checkpoint of a run, newest first. */
  async *list(config: RunnableConfig, options?: { limit?: number }): AsyncGenerator<CheckpointTuple> {
    const runId = threadOf(config);
    if (!runId) return;
    const entries = this.entries(runId).filter((e) => e.payload.lg !== undefined);
    const limit = options?.limit ?? entries.length;
    let emitted = 0;
    for (let i = entries.length - 1; i >= 0 && emitted < limit; i--) {
      const entry = entries[i];
      const lg = entry.payload.lg!;
      const parent = entries
        .slice(0, i)
        .reverse()
        .find((e) => e.payload.lg !== undefined);
      const pendingWrites = pendingWritesOf(entries, lg.id);
      emitted += 1;
      yield {
        config: { configurable: { thread_id: runId, checkpoint_id: lg.id } } as RunnableConfig,
        checkpoint: lg,
        metadata: entry.payload.meta
          ? ({
              source: entry.payload.meta.source,
              step: entry.payload.meta.step,
              parents: entry.payload.meta.parents,
            } as unknown as CheckpointMetadata)
          : undefined,
        parentConfig: parent?.payload.lg
          ? ({ configurable: { thread_id: runId, checkpoint_id: parent.payload.lg.id } } as RunnableConfig)
          : undefined,
        ...(pendingWrites.length > 0 ? { pendingWrites } : {}),
      };
    }
  }

  /**
   * Refuse, in words.
   *
   * The chain is the evidence. A library call that quietly removed it would
   * make the run's history something that can be edited by the runtime rather
   * than proven by the auditor, which is the opposite of what this chain is
   * for. A host that wants a run forgotten can forget it — by refusing to
   * offer the operation at all, out loud.
   */
  async deleteThread(threadId: string): Promise<void> {
    throw new Error(
      `the run chain for "${threadId}" is evidence and cannot be deleted by the runtime; a run's history is removed by refusing to keep it, not by erasing it.`,
    );
  }
}

/** The chain's own verdict on a run — exposed so a host can receipt it. */
export function chainVerdict(runId: string): { ok: true; length: number } | { ok: false; reason: string; detail: string } {
  return verifyRunChain(runId);
}

/** The chain entries of a run, for a host that wants to show the history. */
export function chainEntries(runId: string): { step: number; label: string; entryDigest: string }[] {
  return chainFor(runId).map((c) => ({ step: c.step, label: c.label, entryDigest: c.entryDigest }));
}
