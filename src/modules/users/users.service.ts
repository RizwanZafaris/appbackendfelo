import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@/common/database.service';
import { profiles } from '@db/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { UpdateUserDto } from './users.dto';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  phoneE164: string | null;
  monthlyIncomeMinor: number | null;
  currency: string;
  country: string | null;
  corridor: 'canada' | 'pakistan' | 'other';
  languageCode: string;
  feloScore: number | null;
  subscriptionTier: string;
  kycStatus: string;
  sumsubApplicantId: string | null;
  onboardingComplete: boolean;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PaginatedUsers {
  items: UserProfile[];
  total: number;
  page: number;
  totalPages: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly dbService: DatabaseService) {}

  async findById(id: string): Promise<UserProfile> {
    const rows = await this.dbService.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);
    return rows[0] as UserProfile;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const rows = await this.dbService.db
      .select()
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    return rows.length ? (rows[0] as UserProfile) : null;
  }

  async listActive(params: {
    page?: number;
    limit?: number;
    search?: string;
    corridor?: string;
    kycStatus?: string;
  } = {}): Promise<PaginatedUsers> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [isNull(profiles.deletedAt)];
    if (params.corridor) conditions.push(eq(profiles.corridor, params.corridor as any));
    if (params.kycStatus) conditions.push(eq(profiles.kycStatus, params.kycStatus as any));
    if (params.search) {
      const searchPattern = `%${params.search}%`;
      conditions.push(
        sql`(${profiles.email} ILIKE ${searchPattern} OR ${profiles.displayName} ILIKE ${searchPattern} OR ${profiles.phoneE164} ILIKE ${searchPattern})`,
      );
    }

    const whereClause = and(...conditions);

    const countResult = await this.dbService.db
      .select({ count: sql<number>`count(*)` })
      .from(profiles)
      .where(whereClause);

    const total = Number(countResult[0]?.count ?? 0);

    const items = await this.dbService.db
      .select()
      .from(profiles)
      .where(whereClause)
      .orderBy(desc(profiles.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: items as UserProfile[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserProfile> {
    await this.findById(id); // verify exists
    const updateData: Partial<typeof profiles.$inferInsert> = {};
    if (dto.displayName !== undefined) updateData.displayName = dto.displayName;
    if (dto.phoneE164 !== undefined) updateData.phoneE164 = dto.phoneE164;
    if (dto.monthlyIncomeMinor !== undefined) updateData.monthlyIncomeMinor = dto.monthlyIncomeMinor;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.country !== undefined) updateData.country = dto.country;
    if (dto.corridor !== undefined) updateData.corridor = dto.corridor as any;
    if (dto.languageCode !== undefined) updateData.languageCode = dto.languageCode;
    if (dto.feloScore !== undefined) updateData.feloScore = dto.feloScore;
    if (dto.subscriptionTier !== undefined) updateData.subscriptionTier = dto.subscriptionTier;
    if (dto.kycStatus !== undefined) updateData.kycStatus = dto.kycStatus as any;
    if (dto.settings !== undefined) updateData.settings = dto.settings;

    const rows = await this.dbService.db
      .update(profiles)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning();
    return rows[0] as UserProfile;
  }

  async softDelete(id: string): Promise<void> {
    await this.dbService.db
      .update(profiles)
      .set({ deletedAt: new Date() })
      .where(eq(profiles.id, id));
  }
}
