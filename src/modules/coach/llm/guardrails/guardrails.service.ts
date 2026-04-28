import { Injectable } from '@nestjs/common';

import { PRE_GUARDRAIL_CLASSIFIER_PROMPT, REFUSAL_TEMPLATES } from '../prompts';
import { CoachContext } from '../retrieval/coach-context';
import { GuardrailResult, RefusalCategory } from './refusal-categories';

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the )?(previous|prior|above) (instructions|prompt)/i,
  /you are now\b/i,
  /system prompt/i,
  /reveal your (instructions|rules|prompt)/i,
];

const SHAMING_PATTERNS: RegExp[] = [
  /\byou (spent|wasted) too much\b/i,
  /\byou should be ashamed\b/i,
  /\bthat's irresponsible\b/i,
];

const GUARANTEE_PATTERNS: RegExp[] = [
  /\bguaranteed (return|savings|profit)\b/i,
  /\byou (will|definitely will) (save|earn|make)\s+(?:PKR|Rs\.?|₨|CAD|\$)/i,
];

// Capture monetary figures in a few common forms; group 1 OR 2 holds the number.
const MONEY_PATTERN =
  /(?:PKR|Rs\.?|₨|CAD|C\$|\$)\s?([\d,]+(?:\.\d+)?)|([\d,]{4,})\s?(?:PKR|Rs\.?|₨|CAD|C\$|rupees|dollars)/gi;

/**
 * Classifier signature is intentionally a plain async function, not an
 * Nest provider — so unit tests can inject a fake without bringing up
 * the LLM module. Real wiring is in coach.module.ts.
 */
export type Classifier = (prompt: string) => Promise<string>;

@Injectable()
export class GuardrailsService {
  /**
   * Pre-guardrail: cheap regex + classifier. A pre-guardrail refusal
   * MUST NOT consume the user's main quota — caller enforces that.
   */
  async pre(message: string, classify: Classifier): Promise<GuardrailResult> {
    const injection = this.checkInjection(message);
    if (injection) {
      return {
        triggered: true,
        category: injection,
        refusalText: REFUSAL_TEMPLATES.prompt_injection,
      };
    }
    let label: string;
    try {
      label = (await classify(PRE_GUARDRAIL_CLASSIFIER_PROMPT(message))).trim().toUpperCase();
    } catch {
      // Fail-open: post-guardrail still runs on the response.
      return { triggered: false };
    }
    const cat = this.labelToCategory(label);
    if (!cat) return { triggered: false };
    return { triggered: true, category: cat, refusalText: REFUSAL_TEMPLATES[cat] };
  }

  /**
   * Post-guardrail: verify every monetary figure in the answer is grounded
   * in the user's context, plus heuristic checks for shaming, guarantees,
   * and system-prompt leaks.
   */
  post(answer: string, ctx: CoachContext): GuardrailResult {
    for (const pat of SHAMING_PATTERNS) {
      if (pat.test(answer)) return { triggered: true, category: RefusalCategory.SHAMING_LANGUAGE };
    }
    for (const pat of GUARANTEE_PATTERNS) {
      if (pat.test(answer)) return { triggered: true, category: RefusalCategory.GUARANTEE_RETURNS };
    }
    if (/system prompt/i.test(answer) || answer.includes('COACH_SYSTEM_PROMPT')) {
      return { triggered: true, category: RefusalCategory.SYSTEM_LEAK };
    }

    const answerNums = this.extractNumbers(answer);
    const allowed = this.contextNumbers(ctx);
    const fabricated = [...answerNums].filter((n) => !allowed.some((a) => Math.abs(n - a) <= 1));
    if (fabricated.length > 0) {
      return { triggered: true, category: RefusalCategory.UNGROUNDED_NUMBER };
    }
    return { triggered: false };
  }

  // ----- helpers (exported via methods so tests can hit them) ------------

  private checkInjection(message: string): RefusalCategory | null {
    for (const pat of INJECTION_PATTERNS) {
      if (pat.test(message)) return RefusalCategory.PROMPT_INJECTION;
    }
    return null;
  }

  private labelToCategory(label: string): RefusalCategory | null {
    const map: Record<string, RefusalCategory> = {
      INVESTMENT_ADVICE: RefusalCategory.INVESTMENT_ADVICE,
      TAX_ADVICE: RefusalCategory.TAX_ADVICE,
      LEGAL_ADVICE: RefusalCategory.LEGAL_ADVICE,
      MEDICAL_ADVICE: RefusalCategory.MEDICAL_ADVICE,
      OFF_TOPIC: RefusalCategory.OFF_TOPIC,
      PROMPT_INJECTION: RefusalCategory.PROMPT_INJECTION,
    };
    return map[label] ?? null;
  }

  private normalize(numStr: string): number | null {
    const v = parseFloat(numStr.replace(/,/g, ''));
    if (!Number.isFinite(v)) return null;
    const rounded = Math.trunc(v);
    return rounded >= 100 ? rounded : null;
  }

  extractNumbers(text: string): Set<number> {
    const out = new Set<number>();
    let m: RegExpExecArray | null;
    const re = new RegExp(MONEY_PATTERN.source, 'gi');
    while ((m = re.exec(text))) {
      const raw = m[1] ?? m[2] ?? '';
      const v = this.normalize(raw);
      if (v !== null) out.add(v);
    }
    return out;
  }

  contextNumbers(ctx: CoachContext): number[] {
    const nums: number[] = [
      Math.trunc(ctx.monthlyIncomeMinor / 100),
      Math.trunc(ctx.monthlySpendMinor / 100),
      Math.trunc(ctx.savingsMinor / 100),
    ];
    for (const t of ctx.recentTransactions) nums.push(Math.trunc(t.amountMinor / 100));
    for (const g of ctx.goals) {
      nums.push(Math.trunc(g.targetMinor / 100));
      nums.push(Math.trunc(g.currentMinor / 100));
    }
    for (const b of ctx.bills) nums.push(Math.trunc(b.amountMinor / 100));
    return nums.filter((n) => Number.isFinite(n) && n >= 100);
  }
}
