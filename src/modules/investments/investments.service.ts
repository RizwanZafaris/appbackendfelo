import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { investments } from '@db/schema';

import { CreateInvestmentDto, UpdateInvestmentDto, UpdatePriceDto } from './dto/investment.dto';
import { MarketDataService } from './market-data.service';

@Injectable()
export class InvestmentsService {
  private readonly log = new Logger(InvestmentsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly market: MarketDataService,
  ) {}

  list(userId: string) {
    return this.db
      .select()
      .from(investments)
      .where(and(eq(investments.userId, userId), eq(investments.isArchived, false)))
      .orderBy(desc(investments.createdAt));
  }

  async detail(userId: string, id: string) {
    const row = await this.db.query.investments.findFirst({
      where: and(eq(investments.id, id), eq(investments.userId, userId)),
    });
    if (!row) throw new NotFoundException('Investment not found');
    return row;
  }

  async create(userId: string, dto: CreateInvestmentDto) {
    const [inserted] = await this.db
      .insert(investments)
      .values({
        userId,
        symbol: dto.symbol.toUpperCase(),
        name: dto.name ?? null,
        assetClass: dto.assetClass,
        currency: dto.currency.toUpperCase(),
        units: dto.units,
        costBasisMinor: dto.costBasisMinor,
        lastPriceMinor: dto.lastPriceMinor ?? null,
        lastPricedAt: dto.lastPriceMinor != null ? new Date() : null,
        notes: dto.notes ?? null,
      })
      .returning();
    return inserted;
  }

  async update(userId: string, id: string, dto: UpdateInvestmentDto) {
    const [updated] = await this.db
      .update(investments)
      .set({
        symbol: dto.symbol?.toUpperCase(),
        name: dto.name,
        assetClass: dto.assetClass,
        currency: dto.currency?.toUpperCase(),
        units: dto.units,
        costBasisMinor: dto.costBasisMinor,
        lastPriceMinor: dto.lastPriceMinor,
        lastPricedAt: dto.lastPriceMinor != null ? new Date() : undefined,
        notes: dto.notes,
        isArchived: dto.isArchived,
        updatedAt: new Date(),
      })
      .where(and(eq(investments.id, id), eq(investments.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundException('Investment not found');
    return updated;
  }

  async updatePrice(userId: string, id: string, dto: UpdatePriceDto) {
    const [updated] = await this.db
      .update(investments)
      .set({
        lastPriceMinor: dto.lastPriceMinor,
        lastPricedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(investments.id, id), eq(investments.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundException('Investment not found');
    return updated;
  }

  async archive(userId: string, id: string) {
    const [updated] = await this.db
      .update(investments)
      .set({ isArchived: true })
      .where(and(eq(investments.id, id), eq(investments.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundException('Investment not found');
    return { ok: true };
  }

  /** Refresh prices for all active holdings every 15 minutes. */
  @Cron('*/15 * * * *')
  async refreshPrices() {
    this.log.log('Refreshing investment prices...');
    const rows = await this.db
      .select()
      .from(investments)
      .where(eq(investments.isArchived, false));

    const symbols = [...new Set(rows.map((r) => r.symbol))];
    for (const symbol of symbols) {
      try {
        const quote = await this.market.fetchQuote(this.db, symbol);
        await this.db
          .update(investments)
          .set({
            lastPriceMinor: Math.round(quote.price * 100),
            lastPricedAt: new Date(),
          })
          .where(eq(investments.symbol, symbol));
        this.log.debug(`Refreshed ${symbol}: ${quote.price}`);
      } catch (e) {
        this.log.warn(`Failed to refresh ${symbol}: ${(e as Error).message}`);
      }
    }
  }
}
