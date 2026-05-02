import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject } from '@nestjs/common';

import { kycProfiles, kycDocumentItems } from '@/common/db/schema/remittance.schema';
import { KycProfile, KycDocument, KycDocType, KycDocStatus, KycStatus, KycReviewAction } from './kyc.types';
import { CreateKycProfileDto, UploadDocumentDto, KycReviewDto } from './kyc.dto';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @Inject('DB') private readonly db: NodePgDatabase,
  ) {}

  async createProfile(userId: string, dto: CreateKycProfileDto): Promise<KycProfile> {
    const existing = await this.db.select().from(kycProfiles).where(eq(kycProfiles.userId, userId)).limit(1);
    if (existing.length > 0) {
      throw new BadRequestException('KYC profile already exists for this user');
    }

    const [profile] = await this.db.insert(kycProfiles).values({
      userId,
      fullName: dto.fullName,
      dob: dto.dob,
      nationality: dto.nationality,
      address: dto.address,
      status: 'pending',
      metadata: {},
    }).returning();

    return this.mapProfile(profile);
  }

  async getProfile(userId: string): Promise<KycProfile | null> {
    const rows = await this.db.select().from(kycProfiles).where(eq(kycProfiles.userId, userId)).limit(1);
    return rows.length ? this.mapProfile(rows[0]) : null;
  }

  async getProfileById(id: string): Promise<KycProfile | null> {
    const rows = await this.db.select().from(kycProfiles).where(eq(kycProfiles.id, id)).limit(1);
    return rows.length ? this.mapProfile(rows[0]) : null;
  }

  async uploadDocument(userId: string, dto: UploadDocumentDto): Promise<KycDocument> {
    const profile = await this.getProfile(userId);
    if (!profile) throw new NotFoundException('KYC profile not found');
    if (profile.status === 'approved') throw new ForbiddenException('Cannot upload documents for approved profile');

    const [doc] = await this.db.insert(kycDocumentItems).values({
      profileId: profile.id,
      type: dto.type as KycDocType,
      fileUrl: dto.fileUrl,
      fileKey: dto.fileKey,
      status: 'pending',
    }).returning();

    return this.mapDocument(doc);
  }

  async listDocuments(userId: string): Promise<KycDocument[]> {
    const profile = await this.getProfile(userId);
    if (!profile) throw new NotFoundException('KYC profile not found');

    const docs = await this.db.select().from(kycDocumentItems).where(eq(kycDocumentItems.profileId, profile.id));
    return docs.map(this.mapDocument);
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    if (!profile) throw new NotFoundException('KYC profile not found');
    if (profile.status === 'approved') throw new ForbiddenException('Cannot delete documents for approved profile');

    const docs = await this.db.select().from(kycDocumentItems).where(
      and(eq(kycDocumentItems.id, documentId), eq(kycDocumentItems.profileId, profile.id))
    ).limit(1);
    if (!docs.length) throw new NotFoundException('Document not found');

    await this.db.delete(kycDocumentItems).where(eq(kycDocumentItems.id, documentId));
  }

  async getStatus(userId: string): Promise<{ status: KycStatus; profile: KycProfile | null; documents: KycDocument[] }> {
    const profile = await this.getProfile(userId);
    if (!profile) return { status: 'pending', profile: null, documents: [] };
    const docs = await this.listDocuments(userId);
    return { status: profile.status, profile, documents: docs };
  }

  // ─── Admin Review Methods ───────────────────────────────────────

  async getReviewQueue(status?: KycStatus | 'all', reviewerId?: string, search?: string): Promise<KycProfile[]> {
    let conditions: any[] = [];
    if (status && status !== 'all') conditions.push(eq(kycProfiles.status, status));
    if (reviewerId) conditions.push(eq(kycProfiles.reviewerId, reviewerId));
    if (search) {
      conditions.push(sql`(${kycProfiles.fullName} ILIKE ${`%${search}%`})`);
    }

    const rows = await this.db.select().from(kycProfiles)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(kycProfiles.updatedAt));

    return rows.map(this.mapProfile);
  }

  async getProfileForAdmin(userId: string): Promise<{ profile: KycProfile; documents: KycDocument[] }> {
    const profile = await this.getProfileById(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    const docs = await this.db.select().from(kycDocumentItems).where(eq(kycDocumentItems.profileId, profile.id));
    return { profile, documents: docs.map(this.mapDocument) };
  }

  async reviewProfile(userId: string, action: KycReviewDto & { reviewerId: string }): Promise<KycProfile> {
    const profile = await this.getProfileById(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.status === 'approved') throw new BadRequestException('Already approved profile cannot be changed');

    const [updated] = await this.db.update(kycProfiles).set({
      status: action.status as KycStatus,
      reviewerId: action.reviewerId,
      notes: action.notes,
      updatedAt: new Date(),
    }).where(eq(kycProfiles.id, userId)).returning();

    return this.mapProfile(updated);
  }

  async assignReviewer(userId: string, reviewerId: string): Promise<KycProfile> {
    const [updated] = await this.db.update(kycProfiles).set({
      reviewerId,
      status: 'in_review',
      updatedAt: new Date(),
    }).where(eq(kycProfiles.id, userId)).returning();

    if (!updated) throw new NotFoundException('Profile not found');
    return this.mapProfile(updated);
  }

  // ─── Mappers ────────────────────────────────────────────────────

  private mapProfile(row: any): KycProfile {
    return {
      id: row.id,
      userId: row.userId,
      fullName: row.fullName,
      dob: row.dob,
      nationality: row.nationality,
      address: row.address,
      status: row.status,
      reviewerId: row.reviewerId,
      notes: row.notes,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDocument(row: any): KycDocument {
    return {
      id: row.id,
      profileId: row.profileId,
      type: row.type,
      fileUrl: row.fileUrl,
      fileKey: row.fileKey,
      status: row.status,
      uploadedAt: row.uploadedAt,
      verifiedAt: row.verifiedAt,
      reviewerNotes: row.reviewerNotes,
    };
  }
}
