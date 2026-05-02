import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceProviders, remittanceRoutes, remittanceTransactions } from '@/common/db/schema/remittance.schema';
import { PayoutProviderFactory } from './providers/provider-factory.service';
import { PayoutRequest } from './providers/payout.providers';
import { RemittanceReceiptService } from './remittance-receipt.service';

@Injectable()
export class RemittanceService {
  private readonly logger = new Logger(RemittanceService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly factory: PayoutProviderFactory,
    private readonly receiptService: RemittanceReceiptService,
  ) {}

  async getAllRoutes() {
    const rows = await this.db
      .select({
        route: remittanceRoutes,
        provider: {
          id: remittanceProviders.id,
          name: remittanceProviders.name,
          providerCode: remittanceProviders.providerCode,
        },
      })
      .from(remittanceRoutes)
      .leftJoin(remittanceProviders, eq(remittanceRoutes.providerId, remittanceProviders.id))
      .orderBy(remittanceRoutes.corridor);

    return rows.map(r => ({
      ...r.route,
      providerName: r.provider?.name,
      providerCode: r.provider?.providerCode,
    }));
  }

  async getQuote(params: {
    corridor: string;
    amount: number;
    sourceCurrency: string;
    targetCurrency: string;
    payoutMethod: string;
  }) {
    const routes = await this.factory.getRoutesForCorridor(params.corridor);
    const route = routes.find(r => 
      r.payoutMethod === params.payoutMethod &&
      r.sourceCurrency === params.sourceCurrency &&
      r.targetCurrency === params.targetCurrency
    );

    if (!route) {
      throw new NotFoundException('No route found for this corridor and method');
    }

    const feeAmount = (params.amount * route.feeBps) / 10000;
    const fxRate = 1 + (route.fxMarkupBps / 10000);
    const targetAmount = (params.amount - feeAmount) * fxRate;

    return {
      corridor: params.corridor,
      amount: params.amount,
      sourceCurrency: params.sourceCurrency,
      targetCurrency: params.targetCurrency,
      payoutMethod: params.payoutMethod,
      feeAmount,
      feeBps: route.feeBps,
      fxRate,
      fxMarkupBps: route.fxMarkupBps,
      targetAmount,
      estimatedMinutes: route.estimatedMinutes,
      providerName: route.providerName,
    };
  }

  async initiatePayout(params: {
    userId: string;
    routeId: string;
    amount: number;
    recipientName: string;
    recipientAccount: string;
    recipientPhone?: string;
    recipientBankCode?: string;
    recipientBankName?: string;
    purpose?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  }) {
    const [route] = await this.db
      .select()
      .from(remittanceRoutes)
      .where(eq(remittanceRoutes.id, params.routeId));

    if (!route) {
      throw new NotFoundException('Route not found');
    }

    const provider = this.factory.getProvider(route.providerId);
    if (!provider) {
      throw new NotFoundException('Provider not available');
    }

    const reference = params.reference || `FELO${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    const [tx] = await this.db
      .insert(remittanceTransactions)
      .values({
        reference,
        userId: params.userId,
        providerId: route.providerId,
        routeId: route.id,
        amount: params.amount.toString(),
        currency: route.sourceCurrency,
        targetCurrency: route.targetCurrency,
        feeBps: route.feeBps,
        recipientName: params.recipientName,
        recipientAccount: params.recipientAccount,
        recipientPhone: params.recipientPhone,
        recipientBankCode: params.recipientBankCode,
        recipientBankName: params.recipientBankName,
        purpose: params.purpose || 'Home Remittance',
        metadata: params.metadata || {},
        status: 'pending',
      })
      .returning();

    try {
      const payoutRequest: PayoutRequest = {
        provider: route.providerId,
        amount: params.amount,
        currency: route.targetCurrency,
        recipientAccount: params.recipientAccount,
        recipientName: params.recipientName,
        recipientPhone: params.recipientPhone,
        recipientBankCode: params.recipientBankCode,
        recipientBankName: params.recipientBankName,
        purpose: params.purpose || 'Home Remittance',
        reference,
        metadata: params.metadata,
      };

      const result = await provider.sendPayout(payoutRequest);

      await this.db
        .update(remittanceTransactions)
        .set({
          status: result.success ? 'initiated' : 'failed',
          providerTransactionId: result.providerTransactionId,
          providerStatus: result.status,
          providerRawResponse: result.rawResponse as any,
          failedAt: result.success ? undefined : new Date(),
        })
        .where(eq(remittanceTransactions.id, tx.id));

      return {
        success: result.success,
        transactionId: tx.id,
        reference,
        providerTransactionId: result.providerTransactionId,
        status: result.status,
        message: result.message,
      };
    } catch (err: any) {
      this.logger.error(`Payout failed for ${reference}: ${err?.message}`);
      
      await this.db
        .update(remittanceTransactions)
        .set({
          status: 'failed',
          failedAt: new Date(),
        })
        .where(eq(remittanceTransactions.id, tx.id));

      throw err;
    }
  }

  async listUserTransactions(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    
    const rows = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.userId, userId))
      .orderBy(desc(remittanceTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async getTransaction(id: string) {
    const [tx] = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.id, id));

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    return tx;
  }

  async checkProviderStatus(transactionId: string) {
    const [tx] = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.id, transactionId));

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    if (!tx.providerTransactionId) {
      return { status: tx.status, providerStatus: null };
    }

    const provider = this.factory.getProvider(tx.providerId);
    if (!provider) {
      return { status: tx.status, providerStatus: tx.providerStatus };
    }

    const result = await provider.checkStatus(tx.providerTransactionId);

    if (result.status !== tx.providerStatus) {
      await this.db
        .update(remittanceTransactions)
        .set({
          providerStatus: result.status,
          status: result.status === 'completed' ? 'completed' : 
                  result.status === 'failed' ? 'failed' : tx.status,
          completedAt: result.status === 'completed' ? new Date() : tx.completedAt,
          failedAt: result.status === 'failed' ? new Date() : tx.failedAt,
          providerRawResponse: result.rawResponse as any,
        })
        .where(eq(remittanceTransactions.id, tx.id));
    }

    return {
      transactionId: tx.id,
      reference: tx.reference,
      status: result.status,
      providerStatus: result.status,
      message: result.message,
    };
  }

  async handleWebhook(providerCode: string, body: unknown, headers: any) {
    this.logger.log(`Webhook received from ${providerCode}`);
    return { received: true, provider: providerCode };
  }

  async getReceipt(transactionId: string) {
    const receipt = await this.receiptService.generateReceipt(transactionId);
    if (!receipt) {
      throw new NotFoundException('Transaction not found');
    }
    return {
      receipt,
      pdfContent: this.receiptService.generatePDFContent(receipt),
    };
  }
}
