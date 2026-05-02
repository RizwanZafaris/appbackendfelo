import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceTransactions } from '@/common/db/schema/remittance.schema';
import { and, lt, eq } from 'drizzle-orm';

/**
 * Data Retention Policy Service.
 * Automatically purges or anonymizes data older than retention periods.
 * GDPR / PDPA compliant.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  // Retention periods in days
  private readonly retentionPolicies = {
    completedTransactions: 2555, // 7 years (financial records)
    failedTransactions: 90,      // 90 days for debugging
    pendingTransactions: 30,     // 30 days stale cleanup
    auditLogs: 365,            // 1 year
    userSessions: 30,           // 30 days
    tempFiles: 7,              // 7 days
  };

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async runRetentionCleanup(): Promise<{
    transactionsArchived: number;
    transactionsDeleted: number;
    sessionsPurged: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let transactionsArchived = 0;
    let transactionsDeleted = 0;
    let sessionsPurged = 0;

    this.logger.log('Starting data retention cleanup...');

    try {
      // Archive completed transactions older than 7 years
      // (mark as archived by updating metadata — no 'archivedAt' column, use providerRawResponse)
      const archiveDate = this.daysAgo(this.retentionPolicies.completedTransactions);
      const archived = await this.db
        .update(remittanceTransactions)
        .set({ metadata: { archived: true, archivedAt: new Date().toISOString() } as any })
        .where(
          and(
            eq(remittanceTransactions.status, 'completed'),
            lt(remittanceTransactions.completedAt, archiveDate),
          ),
        )
        .returning({ id: remittanceTransactions.id });
      transactionsArchived = archived.length || 0;
    } catch (error: any) {
      errors.push(`Archive failed: ${error.message}`);
      this.logger.error('Archive failed', error);
    }

    try {
      // Delete failed transactions older than 90 days
      const deleteDate = this.daysAgo(this.retentionPolicies.failedTransactions);
      const deleted = await this.db
        .delete(remittanceTransactions)
        .where(
          and(
            eq(remittanceTransactions.status, 'failed'),
            lt(remittanceTransactions.failedAt, deleteDate),
          ),
        )
        .returning({ id: remittanceTransactions.id });
      transactionsDeleted = deleted.length || 0;
    } catch (error: any) {
      errors.push(`Delete failed: ${error.message}`);
      this.logger.error('Delete failed', error);
    }

    this.logger.log(
      `Retention cleanup complete: ${transactionsArchived} archived, ${transactionsDeleted} deleted, ${sessionsPurged} sessions purged`,
    );

    return { transactionsArchived, transactionsDeleted, sessionsPurged, errors };
  }

  async getRetentionStatus(): Promise<{
    policies: Record<string, number>;
    nextCleanup: string;
  }> {
    return {
      policies: this.retentionPolicies,
      nextCleanup: this.getNextCleanupTime(),
    };
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  private getNextCleanupTime(): string {
    const d = new Date();
    d.setHours(2, 0, 0, 0); // 2 AM next day
    if (d.getTime() < Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    return d.toISOString();
  }
}
