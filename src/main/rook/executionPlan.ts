export interface PlanStep {
  id: string;
  description: string;
  modality: 'gui_vision' | 'code_terminal' | 'reasoning';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export class ExecutionPlanner {
  public static decomposeTask(userGoal: string): PlanStep[] {
    const steps: PlanStep[] = [];
    const lower = userGoal.toLowerCase();

    // 1. Initial cognitive planning
    steps.push({
      id: 'step_1_plan',
      description: `Synthesize dual-modality execution plan for: "${userGoal}"`,
      modality: 'reasoning',
      status: 'pending'
    });

    // 2. GUI action step if task references visual UI or web or clicking
    if (/click|screen|button|window|ui|browser|navigate|gui/i.test(lower)) {
      steps.push({
        id: 'step_2_gui',
        description: 'Perceive GUI viewport and ground interactive coordinates',
        modality: 'gui_vision',
        status: 'pending'
      });
    }

    // 3. Coding / Terminal action step if task references files, code, tests, or bash
    if (/code|file|test|build|refactor|terminal|git|script|fix/i.test(lower)) {
      steps.push({
        id: `step_${steps.length + 1}_code`,
        description: 'Execute software engineering file changes and test verification',
        modality: 'code_terminal',
        status: 'pending'
      });
    }

    // 4. Final verification
    steps.push({
      id: `step_${steps.length + 1}_verify`,
      description: 'Verify execution state and finalize task artifact',
      modality: 'reasoning',
      status: 'pending'
    });

    return steps;
  }
}
