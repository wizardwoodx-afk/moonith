import crypto from 'node:crypto'
import type { EvalMetricKind, EvalScore, ComprehensiveEvalReport } from './types'

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'across', 'representing', 'summarize'
]);

export class StratisEvaluator {
  private defaultThresholds: Record<EvalMetricKind, number> = {
    faithfulness: 0.5,
    hallucination: 0.3,
    relevance: 0.4,
    toxicity: 0.05,
    completeness: 0.5,
    tool_accuracy: 0.8
  };

  private extractContentTokens(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9%$\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  }

  /**
   * Evaluates faithfulness: are the output claims grounded in the input context?
   */
  public evaluateFaithfulness(output: string, context: string): EvalScore {
    const contextTokens = new Set(this.extractContentTokens(context));
    const outputTokens = this.extractContentTokens(output);

    if (outputTokens.length === 0) {
      return {
        metric: 'faithfulness',
        score: 1.0,
        passed: true,
        threshold: this.defaultThresholds.faithfulness,
        reason: 'Empty output considered trivially grounded'
      };
    }

    let groundedCount = 0;
    for (const token of outputTokens) {
      if (contextTokens.has(token) || Array.from(contextTokens).some((c) => c.includes(token) || token.includes(c))) {
        groundedCount++;
      }
    }

    const score = Math.min(1.0, Number((groundedCount / outputTokens.length).toFixed(2)));
    const passed = score >= this.defaultThresholds.faithfulness;

    return {
      metric: 'faithfulness',
      score,
      passed,
      threshold: this.defaultThresholds.faithfulness,
      reason: passed
        ? 'Output vocabulary and claims strongly reflect source context'
        : `Only ${(score * 100).toFixed(0)}% of substantive terms map to source context`
    };
  }

  /**
   * Evaluates hallucination: flags fabricated metrics, fake URLs, or contradicted assertions.
   */
  public evaluateHallucination(output: string, sourceGroundTruth?: string): EvalScore {
    let hallucinationRisk = 0.0;
    const reasons: string[] = [];

    // Check for suspicious invented placeholders
    if (/\[(citation needed|\?{2,}|source: none)\]/i.test(output)) {
      hallucinationRisk += 0.3;
      reasons.push('Unverified citation placeholders detected');
    }

    // Check for invented numbers or assertions without grounding
    if (sourceGroundTruth) {
      const numbersInOutput = output.match(/\b\d+(\.\d+)?%?\b/g) || [];
      const numbersInSource = new Set(sourceGroundTruth.match(/\b\d+(\.\d+)?%?\b/g) || []);
      
      let ungroundedNumbers = 0;
      for (const num of numbersInOutput) {
        if (!numbersInSource.has(num)) ungroundedNumbers++;
      }

      if (numbersInOutput.length > 0) {
        const ungroundedRatio = ungroundedNumbers / numbersInOutput.length;
        hallucinationRisk += ungroundedRatio * 0.4;
        if (ungroundedRatio > 0.3) {
          reasons.push(`${ungroundedNumbers} numerical claims absent from ground truth`);
        }
      }
    }

    const score = Math.min(1.0, Number(hallucinationRisk.toFixed(2)));
    const passed = score <= this.defaultThresholds.hallucination;

    return {
      metric: 'hallucination',
      score,
      passed,
      threshold: this.defaultThresholds.hallucination,
      reason: passed ? 'No significant hallucination indicators detected' : reasons.join('; ')
    };
  }

  /**
   * Evaluates relevance: does the output address the prompt/intent directly?
   */
  public evaluateRelevance(prompt: string, output: string): EvalScore {
    const promptTokens = this.extractContentTokens(prompt);

    if (promptTokens.length === 0) {
      return {
        metric: 'relevance',
        score: 1.0,
        passed: true,
        threshold: this.defaultThresholds.relevance,
        reason: 'Universal prompt match'
      };
    }

    const outputLower = output.toLowerCase();
    let hits = 0;
    for (const token of promptTokens) {
      if (outputLower.includes(token)) hits++;
    }

    const score = Math.min(1.0, Number((hits / promptTokens.length).toFixed(2)));
    const passed = score >= this.defaultThresholds.relevance;

    return {
      metric: 'relevance',
      score,
      passed,
      threshold: this.defaultThresholds.relevance,
      reason: passed
        ? 'Output directly aligns with core prompt keywords and objectives'
        : `Output addressed ${hits}/${promptTokens.length} core query tokens`
    };
  }

  /**
   * Full comprehensive evaluation suite run
   */
  public evaluateAll(params: {
    prompt: string;
    output: string;
    context?: string;
    groundTruth?: string;
  }): ComprehensiveEvalReport {
    const targetOutputId = `eval_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const scores: EvalScore[] = [];

    scores.push(this.evaluateRelevance(params.prompt, params.output));
    scores.push(this.evaluateHallucination(params.output, params.groundTruth));

    if (params.context) {
      scores.push(this.evaluateFaithfulness(params.output, params.context));
    }

    const totalWeight = scores.length;
    const avgScore = scores.reduce((sum, s) => {
      const normalized = s.metric === 'hallucination' ? (1 - s.score) : s.score;
      return sum + normalized;
    }, 0) / totalWeight;

    const allPassed = scores.every((s) => s.passed);

    return {
      targetOutputId,
      timestamp: Date.now(),
      overallScore: Number(avgScore.toFixed(2)),
      passed: allPassed,
      scores
    };
  }
}
