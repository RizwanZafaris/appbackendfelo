import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceTransactions } from '@/common/db/schema/remittance.schema';
import { eq } from 'drizzle-orm';

/**
 * GDPR Data Export Service.
 * Provides data portability for users (Article 20).
 */
@Injectable()
export class GdprExportService {
  private readonly logger = new Logger(GdprExportService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async exportUserData(userId: string): Promise<{
    exportId: string;
    userId: string;
    generatedAt: string;
    data: Record<string, unknown>;
    format: string;
  }> {
    this.logger.log(`Generating GDPR export for user ${userId}`);

    const transactions = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.userId, userId));

    const exportData = {
      profile: {
        userId,
        exportGeneratedAt: new Date().toISOString(),
      },
      transactions: transactions.map(tx => ({
        id: tx.id,
        status: tx.status,
        amount: tx.amount,
        sourceCurrency: tx.sourceCurrency,
        targetCurrency: tx.targetCurrency,
        fxRate: tx.fxRate,
        fee: tx.fee,
        recipientName: tx.recipientName,
        recipientAccount: tx.recipientAccount,
        createdAt: tx.createdAt,
        completedAt: tx.completedAt,
        providerName: tx.providerName,
        providerReference: tx.providerReference,
      })),
      metadata: {
        totalTransactions: transactions.length,
        totalAmountSent: transactions
          .filter(tx => tx.status === 'completed')
          .reduce((sum, tx) => sum + parseFloat(tx.amount as string), 0),
        corridorsUsed: [...new Set(transactions.map(tx => tx.corridor))],
        providersUsed: [...new Set(transactions.map(tx => tx.providerName).filter(Boolean))],
      },
    };

    const exportId = `GDPR-${Date.now()}-${userId.substring(0, 8)}`;

    return {
      exportId,
      userId,
      generatedAt: new Date().toISOString(),
      data: exportData,
      format: 'json',
    };
  }

  async deleteUserData(userId: string): Promise<{
    deleted: boolean;
    itemsRemoved: Record<string, number>;
  }> {
    this.logger.warn(`Executing GDPR deletion (right to erasure) for user ${userId}`);

    const [deleted] = await this.db
      .delete(remittanceTransactions)
      .where(eq(remittanceTransactions.userId, userId))
      .returning({ id: remittanceTransactions.id });

    const count = Array.isArray(deleted) ? deleted.length : 0;

    return {
      deleted: true,
      itemsRemoved: {
        transactions: count,
      },
    };
  }
}
