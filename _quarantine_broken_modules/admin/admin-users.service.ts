import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { adminUsers, type AdminUser, type NewAdminUser } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all admin users. */
  async list(): Promise<AdminUser[]> {
    return this.db.select().from(adminUsers).orderBy(adminUsers.createdAt);
  }

  /** Create an admin user. */
  async create(actorId: string, dto: NewAdminUser): Promise<AdminUser> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, dto.email),
    });
    if (existing) throw new BadRequestException('Email already exists');

    const inserted = await this.db
      .insert(adminUsers)
      .values({
        email: dto.email,
        displayName: dto.displayName ?? null,
        role: dto.role ?? 'read_only',
        isActive: dto.isActive ?? true,
      })
      .returning();

    const user = inserted[0];

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'admin_user',
      resourceId: user.id,
      after: user as unknown as Record<string, unknown>,
    });

    return user;
  }

  /** Update an admin user's role. */
  async updateRole(actorId: string, id: string, role: AdminUser['role']): Promise<AdminUser> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, id),
    });
    if (!existing) throw new NotFoundException('Admin user not found');
    if (existing.role === 'super_admin' && role !== 'super_admin') {
      // Prevent demoting the last super_admin
      const superAdmins = await this.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.role, 'super_admin'));
      if (superAdmins.length <= 1) {
        throw new BadRequestException('Cannot demote the last super admin');
      }
    }

    const updated = await this.db
      .update(adminUsers)
      .set({ role, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'update_role',
      resourceType: 'admin_user',
      resourceId: id,
      before: { role: existing.role },
      after: { role },
    });

    return updated[0];
  }

  /** Deactivate an admin user. */
  async deactivate(actorId: string, id: string): Promise<AdminUser> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, id),
    });
    if (!existing) throw new NotFoundException('Admin user not found');

    const updated = await this.db
      .update(adminUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();

    await this.audit.log({
      actorId,
      actorType: 'admin',
      action: 'deactivate',
      resourceType: 'admin_user',
      resourceId: id,
    });

    return updated[0];
  }
}
