/**
 * PROPRIETARY - SelfImpulse RSIRALS Stratis
 * Cyclical State Machine & Time-Travel Checkpoint Subsystem
 * Inspired by LangGraph state machines without external vendor dependencies.
 */

import crypto from 'node:crypto'

export interface GraphNode<TState = Record<string, unknown>> {
  id: string;
  name: string;
  execute: (state: TState) => Promise<Partial<TState>>;
}

export type ConditionalEdgeRouter<TState = Record<string, unknown>> = (
  state: TState
) => string | '__END__';

export interface CheckpointSnapshot<TState = Record<string, unknown>> {
  checkpointId: string;
  threadId: string;
  stepIndex: number;
  nodeId: string;
  state: TState;
  timestamp: number;
  parentCheckpointId?: string;
}

export interface CyclicalGraphConfig {
  id: string;
  name: string;
  maxCycles?: number;
}

export class CyclicalStateGraph<TState extends Record<string, unknown> = Record<string, unknown>> {
  public readonly id: string;
  public readonly name: string;
  private maxCycles: number;

  private nodes: Map<string, GraphNode<TState>> = new Map();
  private edges: Map<string, string> = new Map();
  private conditionalEdges: Map<string, ConditionalEdgeRouter<TState>> = new Map();
  private startNodeId?: string;

  constructor(config: CyclicalGraphConfig) {
    this.id = config.id;
    this.name = config.name;
    this.maxCycles = config.maxCycles ?? 25;
  }

  public addNode(id: string, name: string, execute: (state: TState) => Promise<Partial<TState>>): this {
    this.nodes.set(id, { id, name, execute });
    if (!this.startNodeId) {
      this.startNodeId = id;
    }
    return this;
  }

  public setStartNode(id: string): this {
    this.startNodeId = id;
    return this;
  }

  public addEdge(fromNodeId: string, toNodeId: string): this {
    this.edges.set(fromNodeId, toNodeId);
    return this;
  }

  public addConditionalEdge(fromNodeId: string, router: ConditionalEdgeRouter<TState>): this {
    this.conditionalEdges.set(fromNodeId, router);
    return this;
  }

  public async run(
    initialState: TState,
    checkpointer?: StateCheckpointer<TState>,
    threadId: string = `thread_${Date.now()}`
  ): Promise<{
    status: 'completed' | 'cycle_limit_exceeded' | 'error';
    finalState: TState;
    totalSteps: number;
    threadId: string;
    lastCheckpointId?: string;
    error?: string;
  }> {
    if (!this.startNodeId || !this.nodes.has(this.startNodeId)) {
      throw new Error(`Graph '${this.id}' has no valid start node`);
    }

    let currentNodeId: string | '__END__' = this.startNodeId;
    let state = { ...initialState };
    let stepIndex = 0;
    let parentCheckpointId: string | undefined;

    while (currentNodeId !== '__END__') {
      stepIndex++;
      if (stepIndex > this.maxCycles) {
        return {
          status: 'cycle_limit_exceeded',
          finalState: state,
          totalSteps: stepIndex,
          threadId,
          lastCheckpointId: parentCheckpointId,
          error: `Execution halted: Exceeded maximum graph cycles (${this.maxCycles})`
        };
      }

      const node = this.nodes.get(currentNodeId);
      if (!node) {
        return {
          status: 'error',
          finalState: state,
          totalSteps: stepIndex,
          threadId,
          error: `Node '${currentNodeId}' not found in graph`
        };
      }

      try {
        const delta = await node.execute(state);
        state = { ...state, ...delta };

        if (checkpointer) {
          const snapshot = checkpointer.saveCheckpoint(
            threadId,
            stepIndex,
            node.id,
            state,
            parentCheckpointId
          );
          parentCheckpointId = snapshot.checkpointId;
        }

        // Determine next node
        if (this.conditionalEdges.has(node.id)) {
          const router = this.conditionalEdges.get(node.id)!;
          currentNodeId = router(state);
        } else if (this.edges.has(node.id)) {
          currentNodeId = this.edges.get(node.id)!;
        } else {
          currentNodeId = '__END__';
        }
      } catch (err: unknown) {
        return {
          status: 'error',
          finalState: state,
          totalSteps: stepIndex,
          threadId,
          lastCheckpointId: parentCheckpointId,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    return {
      status: 'completed',
      finalState: state,
      totalSteps: stepIndex,
      threadId,
      lastCheckpointId: parentCheckpointId
    };
  }
}

/**
 * StateCheckpointer for Time-Travel Debugging & Historical State Replay/Forking
 */
export class StateCheckpointer<TState = Record<string, unknown>> {
  private checkpoints: Map<string, CheckpointSnapshot<TState>> = new Map();
  private threadIndex: Map<string, string[]> = new Map();

  public saveCheckpoint(
    threadId: string,
    stepIndex: number,
    nodeId: string,
    state: TState,
    parentCheckpointId?: string
  ): CheckpointSnapshot<TState> {
    const checkpointId = `chk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const snapshot: CheckpointSnapshot<TState> = {
      checkpointId,
      threadId,
      stepIndex,
      nodeId,
      state: JSON.parse(JSON.stringify(state)), // deep clone
      timestamp: Date.now(),
      parentCheckpointId
    };

    this.checkpoints.set(checkpointId, snapshot);

    const list = this.threadIndex.get(threadId) || [];
    list.push(checkpointId);
    this.threadIndex.set(threadId, list);

    return snapshot;
  }

  public getCheckpoint(checkpointId: string): CheckpointSnapshot<TState> | undefined {
    return this.checkpoints.get(checkpointId);
  }

  public getThreadHistory(threadId: string): CheckpointSnapshot<TState>[] {
    const ids = this.threadIndex.get(threadId) || [];
    return ids
      .map((id) => this.checkpoints.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  /**
   * Time-Travel: Rewind to a historical checkpoint and fork into a new thread
   */
  public timeTravelFork(
    checkpointId: string,
    patchState?: Partial<TState>
  ): { forkedThreadId: string; restoredState: TState; baseStepIndex: number; fromNodeId: string } {
    const historical = this.checkpoints.get(checkpointId);
    if (!historical) {
      throw new Error(`Checkpoint '${checkpointId}' not found for time-travel`);
    }

    const forkedThreadId = `fork_${historical.threadId}_${Date.now()}`;
    const restoredState = {
      ...JSON.parse(JSON.stringify(historical.state)),
      ...(patchState || {})
    };

    return {
      forkedThreadId,
      restoredState,
      baseStepIndex: historical.stepIndex,
      fromNodeId: historical.nodeId
    };
  }

  public clear(): void {
    this.checkpoints.clear();
    this.threadIndex.clear();
  }
}
