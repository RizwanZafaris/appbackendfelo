import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { users } from '@db/schema';

import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getById(id: string) {
    const row = await this.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const updated = await this.db
      .update(users)
      .set({
        displayName: dto.displayName,
        languageCode: dto.languageCode,
        corridor: dto.corridor,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated[0];
  }

  async softDelete(userId: string) {
    await this.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    return { ok: true };
  }
}
