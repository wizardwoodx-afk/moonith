import { describe, expect, it } from 'bun:test'
import { CyclicalStateGraph, StateCheckpointer } from './cyclicalGraph'
import { DualLedgerOrchestrator } from './dualLedger'

describe('RSIRALS Stratis Cyclical State Machine & Time-Travel (LangGraph Superpower)', () => {
  it('executes cycles with conditional routing until target condition is satisfied', async () => {
    interface CodeFixState {
      code: string;
      testsPassing: boolean;
      attempts: number;
    }

    const graph = new CyclicalStateGraph<CodeFixState>({
      id: 'tdd_cycle_graph',
      name: 'TDD Auto-Repair Loop',
      maxCycles: 10
    });

    graph.addNode('coder', 'Synthesize Code Fix', async (state) => {
      const attempts = (state.attempts || 0) + 1;
      return {
        code: `const fixVersion = ${attempts};`,
        attempts
      };
    });

    graph.addNode('tester', 'Run Unit Tests', async (state) => {
      // Passes on attempt 3
      const testsPassing = state.attempts >= 3;
      return { testsPassing };
    });

    // Coder always feeds into Tester
    graph.addEdge('coder', 'tester');

    // Tester conditionally loops back to Coder if tests fail, or ends if passing
    graph.addConditionalEdge('tester', (state) => {
      return state.testsPassing ? '__END__' : 'coder';
    });

    const checkpointer = new StateCheckpointer<CodeFixState>();
    const runResult = await graph.run(
      { code: '', testsPassing: false, attempts: 0 },
      checkpointer,
      'thread_tdd_1'
    );

    expect(runResult.status).toBe('completed');
    expect(runResult.finalState.attempts).toBe(3);
    expect(runResult.finalState.testsPassing).toBe(true);

    // Verify checkpoints captured each step
    const history = checkpointer.getThreadHistory('thread_tdd_1');
    expect(history.length).toBeGreaterThanOrEqual(6); // coder -> tester -> coder -> tester -> coder -> tester
  });

  it('supports Time-Travel Forking: rewinding to a past checkpoint and branching state', () => {
    const checkpointer = new StateCheckpointer<{ counter: number; note: string }>();

    const snap1 = checkpointer.saveCheckpoint('thread_1', 1, 'node_a', { counter: 1, note: 'start' });
    const snap2 = checkpointer.saveCheckpoint('thread_1', 2, 'node_b', { counter: 2, note: 'mid' }, snap1.checkpointId);
    checkpointer.saveCheckpoint('thread_1', 3, 'node_c', { counter: 3, note: 'end' }, snap2.checkpointId);

    // Time-travel rewind back to step 2 with a patched state
    const forked = checkpointer.timeTravelFork(snap2.checkpointId, { note: 'forked_alternative' });

    expect(forked.forkedThreadId).toContain('fork_thread_1_');
    expect(forked.restoredState.counter).toBe(2);
    expect(forked.restoredState.note).toBe('forked_alternative');
    expect(forked.baseStepIndex).toBe(2);
    expect(forked.fromNodeId).toBe('node_b');
  });

  it('halts safely when max cycles threshold is reached (preventing infinite loops)', async () => {
    const infiniteGraph = new CyclicalStateGraph({
      id: 'infinite_loop',
      name: 'Looping Graph',
      maxCycles: 5
    });

    infiniteGraph.addNode('ping', 'Ping', async (state) => ({ step: ((state.step as number) || 0) + 1 }));
    infiniteGraph.addNode('pong', 'Pong', async (state) => ({ step: ((state.step as number) || 0) + 1 }));

    infiniteGraph.addEdge('ping', 'pong');
    infiniteGraph.addEdge('pong', 'ping');

    const result = await infiniteGraph.run({ step: 0 });
    expect(result.status).toBe('cycle_limit_exceeded');
    expect(result.error).toContain('Exceeded maximum graph cycles');
  });
});

describe('RSIRALS Stratis Dual-Ledger System (Microsoft AGT Superpower)', () => {
  it('manages outer Task Ledger milestones and inner Progress Ledger steps synchronously', () => {
    const orchestrator = new DualLedgerOrchestrator('Deploy production microservice');

    // 1. Task Ledger (Outer loop)
    const ms1 = orchestrator.addMilestone('Generate container configuration');
    const ms2 = orchestrator.addMilestone('Verify health check endpoints');
    orchestrator.recordFact('docker_runtime', 'Docker Engine 24.0.7 active', 'system_check');
    orchestrator.addHypothesis('Port 8080 is available for bind');

    // 2. Progress Ledger (Inner loop)
    orchestrator.beginSubtask('Synthesizing Dockerfile', 'coder');
    orchestrator.recordStepResult('Generated Dockerfile with node:alpine', 'ok', 'FROM node:alpine...');

    orchestrator.updateMilestoneStatus(ms1, 'completed', 'hash_artifact_123');

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.taskLedger.globalObjective).toBe('Deploy production microservice');
    expect(snapshot.taskLedger.milestones.length).toBe(2);
    expect(snapshot.taskLedger.milestones[0].status).toBe('completed');
    expect(snapshot.progressPercentage).toBe(50);
    expect(snapshot.progressLedger.recentSteps.length).toBe(1);
    expect(snapshot.progressLedger.currentRole).toBe('coder');
    expect(snapshot.isStalled).toBe(false);
  });

  it('detects execution stalling when consecutive inner steps fail', () => {
    const orchestrator = new DualLedgerOrchestrator('Complex Migration');

    orchestrator.beginSubtask('Database Migration', 'terminal');
    orchestrator.recordStepResult('npm run migrate', 'failed', 'Connection refused');
    orchestrator.recordStepResult('npm run migrate --force', 'failed', 'Connection refused');
    expect(orchestrator.isStalled(3)).toBe(false);

    orchestrator.recordStepResult('retry 3', 'failed', 'Connection refused');
    expect(orchestrator.isStalled(3)).toBe(true);

    const snapshot = orchestrator.getSnapshot();
    expect(snapshot.isStalled).toBe(true);
  });
});
