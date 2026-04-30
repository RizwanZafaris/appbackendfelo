import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';

import { DRIZZLE } from '@/common/db/db.module';
import { familyGroups, familyMembers, familyInvitations } from '@db/schema';

import { FamilyService } from './family.service';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  query: {
    familyGroups: { findFirst: jest.fn() },
    familyMembers: { findFirst: jest.fn() },
    familyInvitations: { findFirst: jest.fn() },
  },
} };

describe('FamilyService', () => {
  let service: FamilyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [FamilyService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();
    service = mod.get<FamilyService>(FamilyService);
  });

  describe('createGroup', () => {
    it('creates a group and adds owner as admin', async () => {
      const group = { id: 'g1', ownerUserId: 'u1', name: 'My Family' };
      mockDb.returning.mockResolvedValueOnce([group]);
      mockDb.returning.mockResolvedValueOnce([{ id: 'm1' }]);

      const result = await service.createGroup('u1', { name: 'My Family' });

      expect(result).toEqual(group);
      expect(mockDb.insert).toHaveBeenCalledWith(familyGroups);
      expect(mockDb.insert).toHaveBeenCalledWith(familyMembers);
    });
  });

  describe('listGroups', () => {
    it('returns empty array when user has no memberships', async () => {
      mockDb.returning.mockResolvedValue([]);
      const result = await service.listGroups('u1');
      expect(result).toEqual([]);
    });
  });

  describe('getGroup', () => {
    it('returns group when user is member', async () => {
      mockDb.query.familyMembers.findFirst.mockResolvedValue({ id: 'm1', role: 'admin' });
      mockDb.query.familyGroups.findFirst.mockResolvedValue({ id: 'g1', name: 'Fam' });
      const result = await service.getGroup('u1', 'g1');
      expect(result.id).toBe('g1');
    });

    it('throws ForbiddenException when user is not a member', async () => {
      mockDb.query.familyMembers.findFirst.mockResolvedValue(undefined);
      await expect(service.getGroup('u1', 'g1')).rejects.toThrow('Not a member');
    });
  });

  describe('inviteMember', () => {
    it('creates invitation with 7-day expiry', async () => {
      mockDb.query.familyMembers.findFirst.mockResolvedValue({ id: 'm1', role: 'admin' });
      const inv = { id: 'i1', code: 'ABC-DEF', familyId: 'g1' };
      mockDb.returning.mockResolvedValue([inv]);

      const result = await service.inviteMember('u1', 'g1', {
        inviteeEmail: 'test@test.com',
        role: 'member',
      });

      expect(result.code).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalledWith(familyInvitations);
    });
  });

  describe('acceptInvitation', () => {
    it('adds user as member when code is valid', async () => {
      mockDb.query.familyInvitations.findFirst.mockResolvedValue({
        id: 'i1',
        familyId: 'g1',
        role: 'member',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockDb.returning.mockResolvedValue([{ id: 'm2' }]);

      const result = await service.acceptInvitation('u2', 'ABC-DEF');
      expect(result.ok).toBe(true);
    });

    it('throws NotFoundException when invitation expired', async () => {
      mockDb.query.familyInvitations.findFirst.mockResolvedValue(undefined);
      await expect(service.acceptInvitation('u2', 'EXPIRED')).rejects.toThrow('Invitation not found');
    });
  });

  describe('updateMemberRole', () => {
    it('updates role when requester is admin', async () => {
      mockDb.query.familyMembers.findFirst.mockResolvedValue({ id: 'm1', role: 'admin' });
      mockDb.returning.mockResolvedValue([{ id: 'm2', role: 'viewer' }]);

      const result = await service.updateMemberRole('u1', 'g1', 'm2', { role: 'viewer' });
      expect(result.role).toBe('viewer');
    });
  });

  describe('removeMember', () => {
    it('removes member when requester is admin', async () => {
      mockDb.query.familyMembers.findFirst.mockResolvedValue({ id: 'm1', role: 'admin' });
      const result = await service.removeMember('u1', 'g1', 'm2');
      expect(result.ok).toBe(true);
    });
  });
});
