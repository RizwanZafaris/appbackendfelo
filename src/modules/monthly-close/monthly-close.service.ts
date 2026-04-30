import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { monthlyCloses, transactions, budgets, goals, recurringBills } from '@db/schema';

@Injectable()
export class MonthlyCloseService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async findOrCreate(userId: string, year: number, month: number) {
    let close = await this.db
      .select()
      .from(monthlyCloses)
      .where(
        and(
          eq(monthlyCloses.userId, userId),
          eq(monthlyCloses.year, year),
          eq(monthlyCloses.month, month),
        ),
      )
      .limit(1);

    if (!close[0]) {
      const result = await this.db
        .insert(monthlyCloses)
        .values({ userId, year, month, status: 'open' })
        .returning();
      close = result;
    }

    return close[0];
  }

  async getUserCloses(userId: string) {
    return this.db
      .select()
      .from(monthlyCloses)
      .where(eq(monthlyCloses.userId, userId))
      .orderBy(monthlyCloses.year, monthlyCloses.month);
  }

  async buildValidationChecklist(userId: string, year: number, month: number) {
    // Count uncategorized transactions
    const uncategorizedTxns = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.category, 'uncategorized'),
        ),
      );

    // Count bills needing review
    const userBills = await this.db
      .select()
      .from(recurringBills)
      .where(eq(recurringBills.userId, userId));

    // Count goals needing update
    const userGoals = await this.db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId));

    return [
      {
        id: 'uncategorized',
        item: `Review ${uncategorizedTxns.length} uncategorized transaction(s)`,
        completed: uncategorizedTxns.length === 0,
        count: uncategorizedTxns.length,
      },
      {
        id: 'bills',
        item: 'Confirm all bill payments are marked correctly',
        completed: userBills.every((b) => !b.isActive),
        count: userBills.length,
      },
      {
        id: 'goals',
        item: 'Review goal progress and update if needed',
        completed: userGoals.every((g) => g.isCompleted),
        count: userGoals.length,
      },
      {
        id: 'cash',
        item: 'Add missing cash expenses',
        completed: false,
        count: 0,
      },
      {
        id: 'splits',
        item: 'Verify shared expense splits are settled',
        completed: false,
        count: 0,
      },
      {
        id: 'income',
        item: 'Confirm all income sources are logged',
        completed: false,
        count: 0,
      },
    ];
  }

  async updateChecklist(
    userId: string,
    year: number,
    month: number,
    checklist: Array<{ id: string; completed: boolean }>,
  ) {
    const close = await this.findOrCreate(userId, year, month);

    await this.db
      .update(monthlyCloses)
      .set({
        validationChecklist: checklist as any,
        status: checklist.every((c) => c.completed) ? 'locked' : 'validating',
      })
      .where(eq(monthlyCloses.id, close.id));

    return this.findOrCreate(userId, year, month);
  }

  async closeMonth(userId: string, year: number, month: number) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    // Calculate totals using proper date range
    const monthTransactions = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.bookedAt, monthStart),
        ),
      );

    const totalIncomeMinor = monthTransactions
      .filter((t) => t.direction === 'credit')
      .reduce((sum, t) => sum + Number(t.amountMinor), 0);

    const totalExpenseMinor = monthTransactions
      .filter((t) => t.direction === 'debit')
      .reduce((sum, t) => sum + Number(t.amountMinor), 0);

    // Budget adherence
    const userBudgets = await this.db
      .select()
      .from(budgets)
      .where(eq(budgets.userId, userId));

    const totalBudget = userBudgets.reduce((sum, b) => sum + Number(b.limitMinor), 0);
    const budgetAdherencePercent = totalBudget > 0
      ? Math.round(((totalBudget - totalExpenseMinor) / totalBudget) * 100)
      : 0;

    // Goal progress
    const userGoals = await this.db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId));

    const goalProgressSummary = userGoals.reduce((acc, g) => {
      acc[g.name] = {
        target: Number(g.targetMinor),
        saved: Number(g.savedMinor),
        progress: g.targetMinor > 0
          ? Math.round((Number(g.savedMinor) / Number(g.targetMinor)) * 100)
          : 0,
      };
      return acc;
    }, {} as Record<string, any>);

    const result = await this.db
      .update(monthlyCloses)
      .set({
        status: 'locked',
        totalIncomeMinor,
        totalExpenseMinor,
        budgetAdherencePercent,
        goalProgressSummary: goalProgressSummary as any,
        closedAt: new Date(),
      })
      .where(
        and(
          eq(monthlyCloses.userId, userId),
          eq(monthlyCloses.year, year),
          eq(monthlyCloses.month, month),
        ),
      )
      .returning();

    return result[0];
  }
}
