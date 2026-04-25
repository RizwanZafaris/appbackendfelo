import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { investments } from '@db/schema';

import { CreateInvestmentDto, UpdateInvestmentDto, UpdatePriceDto } from './dto/investment.dto';

@Injectable()
export class InvestmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

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

  /**
   * Aggregated portfolio summary used by the Flutter portfolio screen.
   * Computes:
   *   - totalCostMinor   = Σ cost_basis_minor across active holdings
   *   - totalMarketMinor = Σ (last_price_minor * units) — null if any holding lacks price
   *   - totalPnLMinor    = market - cost
   *   - allocations[]    = grouped by asset_class, with weight
   */
  async portfolio(userId: string) {
    const rows = await this.list(userId);
    let totalCostMinor = 0;
    let totalMarketMinor = 0;
    let anyMissingPrice = false;

    const byClass = new Map<string, { costMinor: number; marketMinor: number }>();

    for (const r of rows) {
      const cost = r.costBasisMinor;
      totalCostMinor += cost;
      const units = Number(r.units);
      const market = r.lastPriceMinor != null ? Math.round(r.lastPriceMinor * units) : null;
      if (market === null) {
        anyMissingPrice = true;
      } else {
        totalMarketMinor += market;
      }
      const slot = byClass.get(r.assetClass) ?? { costMinor: 0, marketMinor: 0 };
      slot.costMinor += cost;
      slot.marketMinor += market ?? cost;
      byClass.set(r.assetClass, slot);
    }

    const allocations = Array.from(byClass.entries()).map(([assetClass, v]) => ({
      assetClass,
      costMinor: v.costMinor,
      marketMinor: v.marketMinor,
      weight: totalMarketMinor === 0 ? 0 : v.marketMinor / totalMarketMinor,
    }));

    return {
      holdings: rows.length,
      totalCostMinor,
      totalMarketMinor: anyMissingPrice ? null : totalMarketMinor,
      totalPnLMinor: anyMissingPrice ? null : totalMarketMinor - totalCostMinor,
      allocations,
    };
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
}
