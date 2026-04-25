import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { accounts } from '@db/schema';

import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  list(userId: string) {
    return this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.isArchived, false)))
      .orderBy(desc(accounts.createdAt));
  }

  async create(userId: string, dto: CreateAccountDto) {
    const inserted = await this.db
      .insert(accounts)
      .values({
        userId,
        provider: dto.provider,
        displayName: dto.displayName ?? null,
        currency: dto.currency.toUpperCase(),
        balanceMinor: dto.balanceMinor ?? null,
      })
      .returning();
    return inserted[0];
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    const updated = await this.db
      .update(accounts)
      .set({
        provider: dto.provider,
        displayName: dto.displayName,
        currency: dto.currency?.toUpperCase(),
        balanceMinor: dto.balanceMinor,
        isArchived: dto.isArchived,
      })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Account not found');
    return updated[0];
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .update(accounts)
      .set({ isArchived: true })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Account not found');
    return { ok: true };
  }
}
