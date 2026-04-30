import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import * as crypto from 'crypto';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { adminUsers, adminSessions } from '@db/schema';

@Injectable()
export class AdminAuthService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async register(email: string, displayName: string, credentialId: string) {
    const [row] = await this.db
      .insert(adminUsers)
      .values({
        email,
        displayName,
        webauthnCredentialId: credentialId,
        role: 'super_admin' as never,
        isActive: true,
      } as never)
      .returning();
    return row;
  }

  async login(credentialId: string) {
    const [user] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.webauthnCredentialId, credentialId))
      .limit(1);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credential');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await this.db.insert(adminSessions).values({
      adminUserId: user.id,
      token,
      expiresAt,
    });
    return { token, expiresAt, user: { id: user.id, email: user.email, role: user.role } };
  }

  async getMe(tokenHash: string) {
    const [session] = await this.db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.token, tokenHash))
      .limit(1);
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    const [user] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, session.adminUserId))
      .limit(1);
    if (!user) throw new NotFoundException('Admin not found');
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  }

  async listUsers() {
    return this.db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt));
  }
}
