import { Injectable, Logger, Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceTransactions } from '@/common/db/schema/remittance.schema';
import { eq } from 'drizzle-orm';

export interface RemittanceReceipt {
  receiptId: string;
  transactionId: string;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  recipientAccount: string;
  amount: string;
  sourceCurrency: string;
  targetCurrency: string;
  exchangeRate: string;
  fee: string;
  totalPaid: string;
  providerName: string;
  providerReference: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  estimatedDelivery: string;
  trackingUrl?: string;
  qrData: string;
}

@Injectable()
export class RemittanceReceiptService {
  private readonly logger = new Logger(RemittanceReceiptService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async generateReceipt(transactionId: string): Promise<RemittanceReceipt | null> {
    const [tx] = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.id, transactionId))
      .limit(1);

    if (!tx) {
      this.logger.warn(`Transaction not found: ${transactionId}`);
      return null;
    }

    const receiptId = `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    const amount = parseFloat(tx.amount as string);
    const fee = parseFloat((tx.feeAmount ?? '0') as string);
    const fxRate = parseFloat((tx.exchangeRate ?? '1') as string);

    const receipt: RemittanceReceipt = {
      receiptId,
      transactionId: tx.id,
      senderName: (tx.metadata as any)?.senderName || 'N/A',
      senderEmail: (tx.metadata as any)?.senderEmail || 'N/A',
      recipientName: tx.recipientName || 'N/A',
      recipientAccount: tx.recipientAccount || 'N/A',
      amount: amount.toFixed(2),
      sourceCurrency: tx.currency || 'N/A',
      targetCurrency: tx.targetCurrency || 'N/A',
      exchangeRate: fxRate.toFixed(4),
      fee: fee.toFixed(2),
      totalPaid: (amount + fee).toFixed(2),
      providerName: tx.providerId || 'N/A',
      providerReference: tx.providerTransactionId || 'N/A',
      status: tx.status,
      createdAt: tx.createdAt?.toISOString() || new Date().toISOString(),
      completedAt: tx.completedAt?.toISOString(),
      estimatedDelivery: this.calculateEstimatedDelivery(tx.createdAt),
      qrData: this.generateQRData(receiptId, tx.id),
    };

    this.logger.log(`Generated receipt ${receiptId} for transaction ${transactionId}`);
    return receipt;
  }

  private calculateEstimatedDelivery(createdAt?: Date): string {
    if (!createdAt) return 'N/A';
    const delivery = new Date(createdAt);
    delivery.setMinutes(delivery.getMinutes() + 30);
    return delivery.toISOString();
  }

  private generateQRData(receiptId: string, transactionId: string): string {
    return JSON.stringify({
      receipt: receiptId,
      tx: transactionId,
      verify: `https://api.felo.com/v1/verify/${receiptId}`,
    });
  }

  generatePDFContent(receipt: RemittanceReceipt): string {
    // Returns markdown/HTML that can be converted to PDF
    return `
# Felo Remittance Receipt

**Receipt ID:** ${receipt.receiptId}
**Transaction ID:** ${receipt.transactionId}

---

## Sender
- **Name:** ${receipt.senderName}
- **Email:** ${receipt.senderEmail}

## Recipient
- **Name:** ${receipt.recipientName}
- **Account:** ${receipt.recipientAccount}

## Transfer Details
| Field | Value |
|-------|-------|
| Amount Sent | ${receipt.sourceCurrency} ${receipt.amount} |
| Exchange Rate | ${receipt.exchangeRate} |
| Fee | ${receipt.sourceCurrency} ${receipt.fee} |
| Total Paid | ${receipt.sourceCurrency} ${receipt.totalPaid} |
| Amount Received | ${receipt.targetCurrency} ${(parseFloat(receipt.amount) * parseFloat(receipt.exchangeRate)).toFixed(2)} |

## Provider Information
- **Provider:** ${receipt.providerName}
- **Reference:** ${receipt.providerReference}
- **Status:** ${receipt.status}

## Timeline
- **Created:** ${receipt.createdAt}
- **Completed:** ${receipt.completedAt || 'Pending'}
- **Estimated Delivery:** ${receipt.estimatedDelivery}

---

*This receipt is your proof of transfer. Keep it for your records.*
*Verify at: ${receipt.qrData.match(/"verify":"([^"]+)"/)?.[1] || 'N/A'}*
    `.trim();
  }
}
