import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject } from '@nestjs/common';

import { kybBusinesses, kybUbos, kybBusinessDocs } from '@/common/db/schema/remittance.schema';
import { KybBusiness, KybUbo, KybBusinessDoc, KybDocType, KybDocStatus, KybStatus } from './kyb.types';
import { CreateBusinessDto, AddUboDto, UploadBusinessDocDto, KybReviewDto } from './kyb.dto';

@Injectable()
export class KybService {
  private readonly logger = new Logger(KybService.name);

  constructor(
    @Inject('DB') private readonly db: NodePgDatabase,
  ) {}

  async createBusiness(dto: CreateBusinessDto): Promise<KybBusiness> {
    const [business] = await this.db.insert(kybBusinesses).values({
      businessName: dto.businessName,
      registrationNumber: dto.registrationNumber,
      country: dto.country,
      businessType: dto.businessType,
      tradeLicense: dto.tradeLicense,
      incorporationDate: dto.incorporationDate,
      address: dto.address,
      website: dto.website,
      status: 'pending',
      metadata: {},
    }).returning();

    return this.mapBusiness(business);
  }

  async getBusiness(id: string): Promise<KybBusiness | null> {
    const rows = await this.db.select().from(kybBusinesses).where(eq(kybBusinesses.id, id)).limit(1);
    return rows.length ? this.mapBusiness(rows[0]) : null;
  }

  async addUbo(businessId: string, dto: AddUboDto): Promise<KybUbo> {
    const business = await this.getBusiness(businessId);
    if (!business) throw new NotFoundException('Business not found');

    const [ubo] = await this.db.insert(kybUbos).values({
      businessId,
      fullName: dto.fullName,
      dob: dto.dob,
      nationality: dto.nationality,
      ownershipPercentage: dto.ownershipPercentage,
      kycProfileId: dto.kycProfileId,
      status: 'pending',
    }).returning();

    return this.mapUbo(ubo);
  }

  async listUbos(businessId: string): Promise<KybUbo[]> {
    const rows = await this.db.select().from(kybUbos).where(eq(kybUbos.businessId, businessId));
    return rows.map(this.mapUbo);
  }

  async uploadDocument(businessId: string, dto: UploadBusinessDocDto): Promise<KybBusinessDoc> {
    const business = await this.getBusiness(businessId);
    if (!business) throw new NotFoundException('Business not found');
    if (business.status === 'approved') throw new BadRequestException('Cannot upload docs for approved business');

    const [doc] = await this.db.insert(kybBusinessDocs).values({
      businessId,
      type: dto.type as KybDocType,
      fileUrl: dto.fileUrl,
      fileKey: dto.fileKey,
      status: 'pending',
    }).returning();

    return this.mapDoc(doc);
  }

  async listDocuments(businessId: string): Promise<KybBusinessDoc[]> {
    const rows = await this.db.select().from(kybBusinessDocs).where(eq(kybBusinessDocs.businessId, businessId));
    return rows.map(this.mapDoc);
  }

  async getBusinessStatus(businessId: string): Promise<{ business: KybBusiness; ubos: KybUbo[]; documents: KybBusinessDoc[] }> {
    const business = await this.getBusiness(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const ubos = await this.listUbos(businessId);
    const docs = await this.listDocuments(businessId);
    return { business, ubos, documents: docs };
  }

  // ─── Admin Review Methods ───────────────────────────────────────

  async getReviewQueue(status?: KybStatus | 'all', search?: string): Promise<KybBusiness[]> {
    let conditions: any[] = [];
    if (status && status !== 'all') conditions.push(eq(kybBusinesses.status, status));
    if (search) {
      conditions.push(sql`(${kybBusinesses.businessName} ILIKE ${`%${search}%`})`);
    }

    const rows = await this.db.select().from(kybBusinesses)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(kybBusinesses.updatedAt));

    return rows.map(this.mapBusiness);
  }

  async reviewBusiness(businessId: string, action: KybReviewDto & { reviewerId: string }): Promise<KybBusiness> {
    const business = await this.getBusiness(businessId);
    if (!business) throw new NotFoundException('Business not found');
    if (business.status === 'approved') throw new BadRequestException('Already approved');

    const [updated] = await this.db.update(kybBusinesses).set({
      status: action.status as KybStatus,
      reviewerId: action.reviewerId,
      notes: action.notes,
      updatedAt: new Date(),
    }).where(eq(kybBusinesses.id, businessId)).returning();

    return this.mapBusiness(updated);
  }

  // ─── Mappers ────────────────────────────────────────────────────

  private mapBusiness(row: any): KybBusiness {
    return {
      id: row.id,
      businessName: row.businessName,
      registrationNumber: row.registrationNumber,
      country: row.country,
      businessType: row.businessType,
      tradeLicense: row.tradeLicense,
      incorporationDate: row.incorporationDate,
      address: row.address,
      website: row.website,
      status: row.status,
      reviewerId: row.reviewerId,
      notes: row.notes,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapUbo(row: any): KybUbo {
    return {
      id: row.id,
      businessId: row.businessId,
      fullName: row.fullName,
      dob: row.dob,
      nationality: row.nationality,
      ownershipPercentage: Number(row.ownershipPercentage),
      kycProfileId: row.kycProfileId,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDoc(row: any): KybBusinessDoc {
    return {
      id: row.id,
      businessId: row.businessId,
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
