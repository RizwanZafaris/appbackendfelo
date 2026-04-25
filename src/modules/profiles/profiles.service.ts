import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { profiles } from '@db/schema';

import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class ProfilesService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getById(id: string) {
    const row = await this.db.query.profiles.findFirst({ where: eq(profiles.id, id) });
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    // Merge any Flutter-driven settings keys into the existing JSONB blob.
    // Partial updates keep other keys intact.
    const settingsPatch: Record<string, unknown> = {};
    if (dto.themeMode !== undefined) settingsPatch.themeMode = dto.themeMode;
    if (dto.operationalNotifications !== undefined)
      settingsPatch.operationalNotifications = dto.operationalNotifications;
    if (dto.marketingConsent !== undefined)
      settingsPatch.marketingConsent = dto.marketingConsent;
    if (dto.smsParserEnabled !== undefined)
      settingsPatch.smsParserEnabled = dto.smsParserEnabled;

    let mergedSettings: Record<string, unknown> | undefined;
    if (Object.keys(settingsPatch).length > 0) {
      const current = await this.db.query.profiles.findFirst({
        where: eq(profiles.id, userId),
        columns: { settings: true },
      });
      // `settings` is NOT NULL DEFAULT '{...}'::jsonb so this is rarely
      // null, but tolerate legacy rows defensively.
      const existing =
        (current?.settings as Record<string, unknown> | null) ?? {};
      mergedSettings = { ...existing, ...settingsPatch };
    }

    const updated = await this.db
      .update(profiles)
      .set({
        displayName: dto.displayName,
        languageCode: dto.languageCode,
        corridor: dto.corridor,
        country: dto.country,
        currency: dto.currency,
        phoneE164: dto.phoneE164,
        monthlyIncomeMinor: dto.monthlyIncomeMinor,
        onboardingComplete: dto.onboardingComplete,
        ...(mergedSettings !== undefined ? { settings: mergedSettings } : {}),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, userId))
      .returning();
    if (!updated[0]) throw new NotFoundException('Profile not found');
    return updated[0];
  }

  async softDelete(userId: string) {
    await this.db.update(profiles).set({ deletedAt: new Date() }).where(eq(profiles.id, userId));
    return { ok: true };
  }
}
