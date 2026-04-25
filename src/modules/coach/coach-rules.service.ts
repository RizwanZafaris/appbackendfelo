import { Injectable } from '@nestjs/common';

import { InsightsService } from '@/modules/insights/insights.service';

export interface CoachAnswer {
  text: string;
  /** Suggested follow-up prompts the UI should render as chips. */
  suggestions: string[];
  /** Optional structured data for charts: bar / line / number. */
  dataPoints?: Array<{
    label: string;
    valueMinor?: number;
    pct?: number;
  }>;
  /** What the rule matched on, for debugging/telemetry. */
  matched: string;
}

/**
 * Pure deterministic answers based on the user's actual data. No LLM.
 *
 * The rule engine maps a free-text prompt to one of a fixed set of
 * "intents" via simple keyword matching, then composes a response from
 * fresh InsightsService data. Each rule is independent and testable.
 *
 * When we wire Anthropic/OpenAI later, this service stays — it becomes
 * the **tool layer** the LLM calls into. The LLM picks the rule + writes
 * the prose; we keep the data fetching deterministic and auditable.
 */
@Injectable()
export class CoachRulesService {
  constructor(private readonly insights: InsightsService) {}

  async answer(userId: string, prompt: string): Promise<CoachAnswer> {
    const p = prompt.toLowerCase();

    if (this.matches(p, ['how am i doing', 'overview', 'summary', 'report'])) {
      return this.howAmIDoing(userId);
    }
    if (this.matches(p, ['where can i save', 'cut', 'spending too much', 'over budget'])) {
      return this.whereCanISave(userId);
    }
    if (this.matches(p, ['trend', 'this month', 'spending'])) {
      return this.spendingTrends(userId);
    }
    if (this.matches(p, ['top categor', 'most spent', 'biggest'])) {
      return this.topCategories(userId);
    }
    if (this.matches(p, ['merchant', 'where do i shop', 'top stores'])) {
      return this.topMerchants(userId);
    }

    return this.fallback();
  }

  private matches(prompt: string, keywords: string[]): boolean {
    return keywords.some((k) => prompt.includes(k));
  }

  // -------- Intents --------------------------------------------------

  private async howAmIDoing(userId: string): Promise<CoachAnswer> {
    const adherence = await this.insights.budgetAdherence(userId);
    const spending = await this.insights.spending(userId, 'month');

    if (adherence.length === 0 && spending.totalMinor === 0) {
      return {
        text: "You haven't logged any spending yet. Add your first budget or import a transaction and I'll start tracking.",
        suggestions: ['Help me set up a budget', 'How do I import transactions?'],
        matched: 'how_am_i_doing.empty',
      };
    }

    const overBudget = adherence.filter((a) => a.overBudget).length;
    const onTrack = adherence.length - overBudget;
    const spendStr = (spending.totalMinor / 100).toFixed(2);

    let text = `This month you've spent about ${spendStr} across ${spending.byCategory.length} categories.`;
    if (overBudget > 0) {
      text += ` You're over budget on ${overBudget} of your ${adherence.length} envelopes`;
      if (onTrack > 0) text += ` and on track for ${onTrack}`;
      text += '.';
    } else if (adherence.length > 0) {
      text += ` All ${adherence.length} of your budgets are on track — good month.`;
    }

    return {
      text,
      suggestions: ['Where can I save?', 'Show top categories', 'Spending trends'],
      dataPoints: adherence.map((a) => ({
        label: a.category,
        pct: a.pct,
        valueMinor: a.spentMinor,
      })),
      matched: 'how_am_i_doing',
    };
  }

  private async whereCanISave(userId: string): Promise<CoachAnswer> {
    const adherence = await this.insights.budgetAdherence(userId);
    const over = adherence.filter((a) => a.overBudget);

    if (over.length === 0) {
      return {
        text: 'Nothing flagged this period — all budgets are within their limits. Want to set a stretch goal?',
        suggestions: ['Help me set a savings goal', 'How am I doing?'],
        matched: 'where_can_i_save.clean',
      };
    }
    over.sort((a, b) => b.pct - a.pct);
    const worst = over[0];
    const overBy = (worst.spentMinor - worst.limitMinor) / 100;
    const text =
      `Your biggest leak this period is **${worst.category}** — you're over budget by about ${overBy.toFixed(2)}. ` +
      `${over.length > 1 ? `${over.length - 1} more category${over.length - 1 === 1 ? '' : 'ies'} also over limit. ` : ''}` +
      'A 10% cut here would put you back on track.';

    return {
      text,
      suggestions: [
        `Show me ${worst.category} transactions`,
        'How am I doing overall?',
        'Spending trends',
      ],
      dataPoints: over.map((a) => ({
        label: a.category,
        valueMinor: a.spentMinor - a.limitMinor,
        pct: a.pct,
      })),
      matched: 'where_can_i_save',
    };
  }

  private async spendingTrends(userId: string): Promise<CoachAnswer> {
    const month = await this.insights.spending(userId, 'month');
    const week = await this.insights.spending(userId, 'week');
    const monthDaily = month.totalMinor / 30;
    const weekDaily = week.totalMinor / 7;
    const direction =
      weekDaily > monthDaily * 1.1
        ? 'higher'
        : weekDaily < monthDaily * 0.9
          ? 'lower'
          : 'about the same as';
    const text =
      `Your spending this week is ${direction} your monthly average. ` +
      `Daily this week: ${(weekDaily / 100).toFixed(2)}; monthly avg: ${(monthDaily / 100).toFixed(2)}.`;
    return {
      text,
      suggestions: ['Where can I save?', 'Top categories'],
      dataPoints: month.trends.map((t) => ({ label: t.date, valueMinor: t.totalMinor })),
      matched: 'spending_trends',
    };
  }

  private async topCategories(userId: string): Promise<CoachAnswer> {
    const m = await this.insights.spending(userId, 'month');
    if (m.byCategory.length === 0) {
      return {
        text: 'No categorized spending in the last 30 days.',
        suggestions: ['How am I doing?'],
        matched: 'top_categories.empty',
      };
    }
    m.byCategory.sort((a, b) => b.totalMinor - a.totalMinor);
    const top3 = m.byCategory.slice(0, 3);
    const list = top3
      .map(
        (c, i) =>
          `${i + 1}. ${c.category} — ${(c.totalMinor / 100).toFixed(2)} (${(c.pct * 100).toFixed(0)}%)`,
      )
      .join('\n');
    return {
      text: `Top spending this month:\n${list}`,
      suggestions: ['Where can I save?', 'Show merchants'],
      dataPoints: top3.map((c) => ({
        label: c.category,
        valueMinor: c.totalMinor,
        pct: c.pct,
      })),
      matched: 'top_categories',
    };
  }

  private async topMerchants(userId: string): Promise<CoachAnswer> {
    const m = await this.insights.spending(userId, 'month');
    if (m.byMerchant.length === 0) {
      return {
        text: 'No merchant data yet — add some transactions or enable SMS parsing.',
        suggestions: ['How am I doing?'],
        matched: 'top_merchants.empty',
      };
    }
    const top5 = m.byMerchant.slice(0, 5);
    const list = top5
      .map(
        (mc, i) => `${i + 1}. ${mc.merchant} — ${(mc.totalMinor / 100).toFixed(2)} (${mc.count}×)`,
      )
      .join('\n');
    return {
      text: `Where you shopped most this month:\n${list}`,
      suggestions: ['Top categories', 'Where can I save?'],
      dataPoints: top5.map((mc) => ({
        label: mc.merchant,
        valueMinor: mc.totalMinor,
      })),
      matched: 'top_merchants',
    };
  }

  private fallback(): CoachAnswer {
    return {
      text:
        'I can help you understand your spending, find places to save, and track budgets. ' +
        'Try asking "how am I doing?" or "where can I save?"',
      suggestions: ['How am I doing?', 'Where can I save?', 'Spending trends', 'Top categories'],
      matched: 'fallback',
    };
  }
}
