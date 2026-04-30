import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { budgets, goals, notifications, recurringBills, transactions } from '@db/schema';

import { NotificationDispatcherService } from './notification-dispatcher.service';

@Injectable()
export class NotificationTriggersService {
  private readonly log = new Logger(NotificationTriggersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  /** Check budget thresholds every hour. */
  @Cron('0 * * * *')
  async checkBudgetAlerts() {
    this.log.debug('Checking budget alerts...');
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const activeBudgets = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.isArchived, false), gte(budgets.startsOn, monthStart)));

    for (const budget of activeBudgets) {
      const spent = await this.db
        .select({
          total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, budget.userId),
            eq(transactions.category, budget.category),
            eq(transactions.direction, 'debit'),
            gte(transactions.bookedAt, monthStart),
          ),
        );

      const spentMinor = Number(spent[0]?.total ?? 0);
      const percent = budget.limitMinor > 0 ? Math.round((spentMinor / budget.limitMinor) * 100) : 0;

      if (percent >= (budget.alertThresholdPercent ?? 80)) {
        await this.dispatcher.dispatch({
          userId: budget.userId,
          type: 'budget_alert',
          channel: 'inapp',
          variables: {
            category: budget.category,
            percent: String(percent),
            limit: String(budget.limitMinor / 100),
          },
          payload: {
            kind: 'budget_alert',
            budgetId: budget.id,
            thresholdPercent: percent,
          },
        });
      }
    }
  }

  /** Check recurring bills due in 3 days. */
  @Cron('0 9 * * *')
  async checkBillReminders() {
    this.log.debug('Checking bill reminders...');
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const dateStr = threeDaysFromNow.toISOString().slice(0, 10);

    const dueBills = await this.db
      .select()
      .from(recurringBills)
      .where(
        and(
          eq(recurringBills.isActive, true),
          eq(recurringBills.nextExpected, dateStr),
        ),
      );

    for (const bill of dueBills) {
      await this.dispatcher.dispatch({
        userId: bill.userId,
        type: 'bill_reminder',
        channel: 'inapp',
        variables: {
          merchant: bill.merchant,
          amount: String(bill.amountMinor / 100),
          dueDate: dateStr,
        },
        payload: {
          kind: 'bill_reminder',
          billId: bill.id,
          dueDate: dateStr,
        },
      });
    }
  }

  /** Check goal milestones weekly. */
  @Cron('0 10 * * 1')
  async checkGoalMilestones() {
    this.log.debug('Checking goal milestones...');
    const activeGoals = await this.db
      .select()
      .from(goals)
      .where(eq(goals.isCompleted, false));

    for (const goal of activeGoals) {
      if (goal.targetMinor === 0) continue;
      const progressPercent = Math.round((goal.savedMinor / goal.targetMinor) * 100);

      // Notify at 25%, 50%, 75%, 100%
      const milestones = [25, 50, 75, 100];
      const milestone = milestones.find((m) => progressPercent >= m && progressPercent < m + 5);

      if (milestone) {
        await this.dispatcher.dispatch({
          userId: goal.userId,
          type: 'goal_milestone',
          channel: 'inapp',
          variables: {
            goalName: goal.name,
            progress: String(progressPercent),
          },
          payload: {
            kind: 'goal_milestone',
            goalId: goal.id,
            progressPercent,
          },
        });
      }
    }
  }
}
