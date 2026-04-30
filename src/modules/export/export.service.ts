import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  userExports,
  profiles,
  accounts,
  transactions,
  budgets,
  goals,
  recurringBills,
  splits,
} from '@db/schema';

@Injectable()
export class ExportService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async requestExport(userId: string, format: 'json' | 'csv') {
    const result = await this.db
      .insert(userExports)
      .values({ userId, format, status: 'pending' })
      .returning();

    // Start async processing
    this.processExport(result[0].id, userId, format).catch(console.error);

    return result[0];
  }

  async processExport(exportId: string, userId: string, format: 'json' | 'csv'): Promise<void> {
    await this.db
      .update(userExports)
      .set({ status: 'processing' })
      .where(eq(userExports.id, exportId));

    try {
      const profileRows = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      const userAccounts = await this.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId));

      const userTransactions = await this.db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, userId));

      const userBudgets = await this.db
        .select()
        .from(budgets)
        .where(eq(budgets.userId, userId));

      const userGoals = await this.db
        .select()
        .from(goals)
        .where(eq(goals.userId, userId));

      const userBills = await this.db
        .select()
        .from(recurringBills)
        .where(eq(recurringBills.userId, userId));

      const userSplits = await this.db
        .select()
        .from(splits)
        .where(eq(splits.ownerUserId, userId));

      const profile = profileRows[0];

      const exportData = {
        exportedAt: new Date().toISOString(),
        profile: {
          id: profile?.id,
          displayName: profile?.displayName,
          email: profile?.email,
          currency: profile?.currency,
          corridor: profile?.corridor,
          languageCode: profile?.languageCode,
          subscriptionTier: profile?.subscriptionTier,
        },
        accounts: userAccounts,
        transactions: userTransactions,
        budgets: userBudgets,
        goals: userGoals,
        bills: userBills,
        splits: userSplits,
      };

      const filePath = `/exports/${exportId}.${format}`;

      await this.db
        .update(userExports)
        .set({
          status: 'ready',
          filePath,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          completedAt: new Date(),
        })
        .where(eq(userExports.id, exportId));
    } catch (error) {
      await this.db
        .update(userExports)
        .set({ status: 'expired' })
        .where(eq(userExports.id, exportId));
      throw error;
    }
  }

  async getExports(userId: string) {
    return this.db
      .select()
      .from(userExports)
      .where(eq(userExports.userId, userId))
      .orderBy(userExports.createdAt);
  }

  async deleteAccountData(userId: string): Promise<void> {
    await this.db.delete(transactions).where(eq(transactions.userId, userId));
    await this.db.delete(accounts).where(eq(accounts.userId, userId));
    await this.db.delete(budgets).where(eq(budgets.userId, userId));
    await this.db.delete(goals).where(eq(goals.userId, userId));
    await this.db
      .update(profiles)
      .set({ deletedAt: new Date() })
      .where(eq(profiles.id, userId));
  }
}
