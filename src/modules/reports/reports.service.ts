import { Inject, Injectable } from '@nestjs/common';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  transactions,
  budgets,
  goals,
  recurringBills,
  splits,
} from '@db/schema';

export interface WeeklyReport {
  period: { start: string; end: string };
  moneyPulse: {
    totalLoggedSpend: number;
    remainingBudget: number;
    confidenceScore: number;
  };
  topMovers: Array<{
    category: string;
    amount: number;
    changePercent: number;
  }>;
  billsAhead: Array<{
    name: string;
    dueDate: string;
    amountMinor: number;
    currency: string;
  }>;
  goalsAtRisk: Array<{
    name: string;
    progressPercent: number;
    projectedShortfall: number;
  }>;
  sharedObligations: Array<{
    splitName: string;
    pendingAmount: number;
    currency: string;
  }>;
  aiSuggestion: string;
}

export interface MonthlyReport {
  year: number;
  month: number;
  incomeSummary: {
    totalIncomeMinor: number;
    sources: Array<{ category: string; amountMinor: number }>;
  };
  expenseSummary: {
    totalExpenseMinor: number;
    byCategory: Array<{ category: string; amountMinor: number }>;
  };
  budgetPerformance: Array<{
    category: string;
    plannedMinor: number;
    actualMinor: number;
    adherencePercent: number;
  }>;
  goalProgress: Array<{
    name: string;
    targetMinor: number;
    savedMinor: number;
    status: 'on_track' | 'slipping' | 'missed';
  }>;
  billReliability: {
    paid: number;
    pending: number;
    missed: number;
  };
  sharedLedger: {
    openObligations: number;
    settledExternally: number;
    totalAmountMinor: number;
  };
  validationChecklist: Array<{
    item: string;
    completed: boolean;
  }>;
}

@Injectable()
export class ReportsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async generateWeeklyReport(userId: string): Promise<WeeklyReport> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekEnd = now;

    // Fetch transactions for the week (debits only)
    const weekTransactions = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.bookedAt, weekStart),
          lte(transactions.bookedAt, weekEnd),
          eq(transactions.direction, 'debit'),
        ),
      );

    const totalLoggedSpend = weekTransactions.reduce(
      (sum, t) => sum + Number(t.amountMinor),
      0,
    );

    // Fetch active budgets
    const userBudgets = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isArchived, false)))
      .orderBy(budgets.createdAt);

    const totalBudgetLimit = userBudgets.reduce(
      (sum, b) => sum + Number(b.limitMinor),
      0,
    );
    const remainingBudget = Math.max(0, totalBudgetLimit - totalLoggedSpend);

    // Confidence score based on data completeness
    const confidenceScore = this.calculateConfidenceScore(
      weekTransactions.length,
      userBudgets.length,
    );

    // Top movers by category
    const categoryMap = new Map<string, number>();
    for (const t of weekTransactions) {
      const cat = t.category || 'uncategorized';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + Number(t.amountMinor));
    }
    const topMovers = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        changePercent: 0, // Requires historical comparison
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Bills due in next 14 days
    const upcomingBills = await this.db
      .select()
      .from(recurringBills)
      .where(and(eq(recurringBills.userId, userId), eq(recurringBills.isActive, true)))
      .limit(5);

    const billsAhead = upcomingBills.map((b) => ({
      name: b.merchant,
      dueDate: b.nextExpected ?? '',
      amountMinor: Number(b.amountMinor),
      currency: b.currency,
    }));

    // Goals at risk
    const userGoals = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.isCompleted, false)))
      .orderBy(goals.createdAt);

    const goalsAtRisk = userGoals
      .map((g) => {
        const progressPercent =
          g.targetMinor > 0
            ? Math.round((Number(g.savedMinor) / Number(g.targetMinor)) * 100)
            : 0;
        const projectedShortfall = Math.max(
          0,
          Number(g.targetMinor) - Number(g.savedMinor),
        );
        return { name: g.name, progressPercent, projectedShortfall };
      })
      .filter((g) => g.progressPercent < 50)
      .slice(0, 3);

    // Shared obligations
    const userSplits = await this.db
      .select()
      .from(splits)
      .where(and(eq(splits.ownerUserId, userId), eq(splits.isSettled, false)))
      .limit(3);

    const sharedObligations = userSplits.map((s) => ({
      splitName: s.name,
      pendingAmount: Number(s.totalMinor),
      currency: s.currency,
    }));

    const aiSuggestion = this.generateAiSuggestion(
      totalLoggedSpend,
      remainingBudget,
      goalsAtRisk.length,
    );

    return {
      period: {
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0],
      },
      moneyPulse: { totalLoggedSpend, remainingBudget, confidenceScore },
      topMovers,
      billsAhead,
      goalsAtRisk,
      sharedObligations,
      aiSuggestion,
    };
  }

  async generateMonthlyReport(
    userId: string,
    year: number,
    month: number,
  ): Promise<MonthlyReport> {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    // Fetch all transactions for the month
    const monthTransactions = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.bookedAt, monthStart),
          lte(transactions.bookedAt, monthEnd),
        ),
      );

    const incomeTxns = monthTransactions.filter((t) => t.direction === 'credit');
    const expenseTxns = monthTransactions.filter((t) => t.direction === 'debit');

    const totalIncomeMinor = incomeTxns.reduce(
      (sum, t) => sum + Number(t.amountMinor),
      0,
    );
    const totalExpenseMinor = expenseTxns.reduce(
      (sum, t) => sum + Number(t.amountMinor),
      0,
    );

    // Income by source
    const incomeSources = new Map<string, number>();
    for (const t of incomeTxns) {
      const cat = t.category || 'other';
      incomeSources.set(cat, (incomeSources.get(cat) || 0) + Number(t.amountMinor));
    }

    // Expenses by category
    const expenseCategories = new Map<string, number>();
    for (const t of expenseTxns) {
      const cat = t.category || 'uncategorized';
      expenseCategories.set(cat, (expenseCategories.get(cat) || 0) + Number(t.amountMinor));
    }

    // Budget performance
    const userBudgets = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isArchived, false)));

    const budgetPerformance = userBudgets.map((b) => {
      const actualMinor = expenseCategories.get(b.category) || 0;
      const plannedMinor = Number(b.limitMinor);
      const adherencePercent =
        plannedMinor > 0
          ? Math.round(((plannedMinor - actualMinor) / plannedMinor) * 100)
          : 0;
      return { category: b.category, plannedMinor, actualMinor, adherencePercent };
    });

    // Goal progress
    const userGoals = await this.db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId));

    const goalProgress = userGoals.map((g) => {
      const progressPercent =
        g.targetMinor > 0
          ? Math.round((Number(g.savedMinor) / Number(g.targetMinor)) * 100)
          : 0;
      let status: 'on_track' | 'slipping' | 'missed' = 'on_track';
      if (progressPercent < 25) status = 'missed';
      else if (progressPercent < 60) status = 'slipping';
      return {
        name: g.name,
        targetMinor: Number(g.targetMinor),
        savedMinor: Number(g.savedMinor),
        status,
      };
    });

    // Bill reliability
    const userBills = await this.db
      .select()
      .from(recurringBills)
      .where(eq(recurringBills.userId, userId));

    const billReliability = {
      paid: Math.max(0, userBills.filter((b) => !b.isActive).length),
      pending: Math.max(0, userBills.filter((b) => b.isActive).length),
      missed: 0, // Requires payment tracking table
    };

    // Shared ledger
    const userSplits = await this.db
      .select()
      .from(splits)
      .where(eq(splits.ownerUserId, userId));

    const openObligations = userSplits.filter((s) => !s.isSettled).length;
    const settledExternally = userSplits.filter((s) => s.isSettled).length;
    const totalObligationMinor = userSplits.reduce(
      (sum, s) => sum + Number(s.totalMinor),
      0,
    );

    const validationChecklist = [
      { item: 'Review uncategorized transactions', completed: false },
      { item: 'Confirm bill payments marked correctly', completed: false },
      { item: 'Verify shared expense splits', completed: false },
      { item: 'Update goal progress if needed', completed: false },
      { item: 'Add missing cash expenses', completed: false },
      { item: 'Review AI coach suggestions', completed: false },
    ];

    return {
      year,
      month,
      incomeSummary: {
        totalIncomeMinor,
        sources: Array.from(incomeSources.entries()).map(([category, amountMinor]) => ({
          category,
          amountMinor,
        })),
      },
      expenseSummary: {
        totalExpenseMinor,
        byCategory: Array.from(expenseCategories.entries()).map(([category, amountMinor]) => ({
          category,
          amountMinor,
        })),
      },
      budgetPerformance,
      goalProgress,
      billReliability,
      sharedLedger: { openObligations, settledExternally, totalAmountMinor: totalObligationMinor },
      validationChecklist,
    };
  }

  private calculateConfidenceScore(
    transactionCount: number,
    budgetCount: number,
  ): number {
    let score = 50;
    if (transactionCount >= 10) score += 20;
    else if (transactionCount >= 5) score += 10;
    if (budgetCount >= 3) score += 15;
    else if (budgetCount >= 1) score += 5;
    return Math.min(100, score);
  }

  private generateAiSuggestion(
    totalSpend: number,
    remainingBudget: number,
    atRiskGoals: number,
  ): string {
    if (remainingBudget < totalSpend * 0.1) {
      return "You're close to your budget limit. Consider pausing non-essential spending.";
    }
    if (atRiskGoals > 0) {
      return `You have ${atRiskGoals} goal(s) at risk. A small top-up could get them back on track.`;
    }
    if (remainingBudget > totalSpend * 0.5) {
      return "Great job staying within budget. You're on track for your monthly goals.";
    }
    return "Review your top spending categories to find areas to optimize.";
  }
}
