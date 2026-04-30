import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { feloScores } from '@db/schema';

@Injectable()
export class FeloScoresService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  history(userId: string, limit = 30) {
    return this.db
      .select()
      .from(feloScores)
      .where(eq(feloScores.userId, userId))
      .orderBy(desc(feloScores.calculatedAt))
      .limit(limit);
  }

  async latest(userId: string) {
    const rows = await this.db
      .select()
      .from(feloScores)
      .where(eq(feloScores.userId, userId))
      .orderBy(desc(feloScores.calculatedAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
