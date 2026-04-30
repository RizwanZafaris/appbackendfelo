import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  familyGroups,
  familyMembers,
  familyRolePermissions,
  familyInvitations,
} from '@db/schema';

import type { FamilyRolePermission, FamilyInvitation } from '@db/schema';

export interface CreateFamilyGroupDto {
  name: string;
}

export interface UpdateFamilyGroupDto {
  name?: string;
}

export interface InviteMemberDto {
  inviteeEmail?: string;
  inviteePhone?: string;
  role?: 'admin' | 'member' | 'viewer';
}

export interface UpdateMemberRoleDto {
  role: 'admin' | 'member' | 'viewer';
}

@Injectable()
export class FamilyService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ---- Family Groups ----

  async createGroup(userId: string, dto: CreateFamilyGroupDto) {
    const [group] = await this.db
      .insert(familyGroups)
      .values({ ownerUserId: userId, name: dto.name })
      .returning();

    // Owner becomes admin
    await this.db.insert(familyMembers).values({
      familyId: group.id,
      userId,
      role: 'admin',
      canViewSharedTransactions: true,
      canEditSharedBudgets: true,
    });

    return group;
  }

  async listGroups(userId: string) {
    const memberRows = await this.db
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(eq(familyMembers.userId, userId));

    const familyIds = memberRows.map((m) => m.familyId);
    if (familyIds.length === 0) return [];

    return this.db
      .select()
      .from(familyGroups)
      .where(eq(familyGroups.id, familyIds[0]));
  }

  async getGroup(userId: string, groupId: string) {
    await this.assertMember(userId, groupId);
    const row = await this.db.query.familyGroups.findFirst({
      where: eq(familyGroups.id, groupId),
    });
    if (!row) throw new NotFoundException('Family group not found');
    return row;
  }

  async updateGroup(userId: string, groupId: string, dto: UpdateFamilyGroupDto) {
    await this.assertRole(userId, groupId, ['admin']);
    const [updated] = await this.db
      .update(familyGroups)
      .set({ name: dto.name })
      .where(eq(familyGroups.id, groupId))
      .returning();
    if (!updated) throw new NotFoundException('Family group not found');
    return updated;
  }

  async deleteGroup(userId: string, groupId: string) {
    await this.assertRole(userId, groupId, ['admin']);
    await this.db.delete(familyGroups).where(eq(familyGroups.id, groupId));
    return { ok: true };
  }

  // ---- Members ----

  async listMembers(userId: string, groupId: string) {
    await this.assertMember(userId, groupId);
    return this.db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.familyId, groupId));
  }

  async updateMemberRole(
    userId: string,
    groupId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.assertRole(userId, groupId, ['admin']);
    const [updated] = await this.db
      .update(familyMembers)
      .set({ role: dto.role })
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, groupId)))
      .returning();
    if (!updated) throw new NotFoundException('Member not found');
    return updated;
  }

  async removeMember(userId: string, groupId: string, memberId: string) {
    await this.assertRole(userId, groupId, ['admin']);
    await this.db
      .delete(familyMembers)
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, groupId)));
    return { ok: true };
  }

  // ---- Invitations ----

  async inviteMember(userId: string, groupId: string, dto: InviteMemberDto) {
    await this.assertRole(userId, groupId, ['admin']);

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [inv] = await this.db
      .insert(familyInvitations)
      .values({
        familyId: groupId,
        invitedBy: userId,
        inviteeEmail: dto.inviteeEmail ?? null,
        inviteePhone: dto.inviteePhone ?? null,
        code,
        role: dto.role ?? 'member',
        expiresAt,
      })
      .returning();

    return inv;
  }

  async acceptInvitation(userId: string, code: string) {
    const inv = await this.db.query.familyInvitations.findFirst({
      where: and(
        eq(familyInvitations.code, code),
        eq(familyInvitations.status, 'pending'),
        gte(familyInvitations.expiresAt, new Date()),
      ),
    });
    if (!inv) throw new NotFoundException('Invitation not found or expired');

    await this.db
      .update(familyInvitations)
      .set({ status: 'accepted' })
      .where(eq(familyInvitations.id, inv.id));

    await this.db.insert(familyMembers).values({
      familyId: inv.familyId,
      userId,
      role: inv.role,
      canViewSharedTransactions: true,
      canEditSharedBudgets: inv.role === 'admin' || inv.role === 'member',
    });

    return { ok: true };
  }

  async revokeInvitation(userId: string, code: string) {
    const inv = await this.db.query.familyInvitations.findFirst({
      where: and(eq(familyInvitations.code, code), eq(familyInvitations.status, 'pending')),
    });
    if (!inv) throw new NotFoundException('Invitation not found');

    await this.assertRole(userId, inv.familyId, ['admin']);

    await this.db
      .update(familyInvitations)
      .set({ status: 'revoked' })
      .where(eq(familyInvitations.id, inv.id));

    return { ok: true };
  }

  // ---- Role Permissions ----

  async getPermissions(role: string): Promise<FamilyRolePermission[]> {
    return this.db
      .select()
      .from(familyRolePermissions)
      .where(eq(familyRolePermissions.role, role as 'admin' | 'member' | 'viewer'));
  }

  // ---- Helpers ----

  private async assertMember(userId: string, groupId: string) {
    const row = await this.db.query.familyMembers.findFirst({
      where: and(eq(familyMembers.familyId, groupId), eq(familyMembers.userId, userId)),
    });
    if (!row) throw new ForbiddenException('Not a member of this family group');
    return row;
  }

  private async assertRole(
    userId: string,
    groupId: string,
    allowed: Array<'admin' | 'member' | 'viewer'>,
  ) {
    const row = await this.assertMember(userId, groupId);
    if (!allowed.includes(row.role)) {
      throw new ForbiddenException(`Requires role: ${allowed.join(' or ')}`);
    }
    return row;
  }

  private generateCode(): string {
    return `${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  }
}
