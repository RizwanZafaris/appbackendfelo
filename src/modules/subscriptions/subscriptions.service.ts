import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { subscriptions } from '@db/schema';

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  list(userId: string) {
    return this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt));
  }

  async current(userId: string) {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
