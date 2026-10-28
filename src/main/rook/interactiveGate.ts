import type { InteractiveClarification } from './types'

export class InteractiveGate {
  private pendingGates: Map<string, InteractiveClarification> = new Map();

  public createQuestionGate(params: {
    question: string;
    context: string;
    options?: string[];
  }): InteractiveClarification {
    const id = `gate_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const gate: InteractiveClarification = {
      id,
      question: params.question,
      context: params.context,
      options: params.options,
      status: 'pending',
      timestamp: Date.now()
    };

    this.pendingGates.set(id, gate);
    return gate;
  }

  public resolveGate(id: string, response: { selectedOption?: string; userAnswer?: string }): InteractiveClarification {
    const gate = this.pendingGates.get(id);
    if (!gate) {
      throw new Error(`Interactive gate not found: ${id}`);
    }

    gate.selectedOption = response.selectedOption;
    gate.userAnswer = response.userAnswer;
    gate.status = 'resolved';
    return gate;
  }

  public getPendingGates(): InteractiveClarification[] {
    return Array.from(this.pendingGates.values()).filter(g => g.status === 'pending');
  }

  public getGate(id: string): InteractiveClarification | undefined {
    return this.pendingGates.get(id);
  }
}
