import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { coachPrompts } from '@db/schema';

export interface ResolvedPrompt {
  version: string;
  systemPrompt: string;
  isCanary: boolean;
}

@Injectable()
export class CoachPromptService {
  private readonly log = new Logger(CoachPromptService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Load the active prompt. If a canary exists, route X% of traffic to it. */
  async resolve(userId: string): Promise<ResolvedPrompt> {
    const active = await this.db
      .select()
      .from(coachPrompts)
      .where(eq(coachPrompts.isActive, true))
      .orderBy(desc(coachPrompts.createdAt))
      .limit(1);

    const canary = await this.db
      .select()
      .from(coachPrompts)
      .where(eq(coachPrompts.isCanary, true))
      .orderBy(desc(coachPrompts.createdAt))
      .limit(1);

    if (canary[0] && canary[0].canaryPercent > 0) {
      // Deterministic routing based on userId hash
      const hash = this.hashUserId(userId);
      if (hash % 100 < canary[0].canaryPercent) {
        this.log.debug(`Routing user ${userId} to canary ${canary[0].version}`);
        return {
          version: canary[0].version,
          systemPrompt: canary[0].systemPrompt,
          isCanary: true,
        };
      }
    }

    if (active[0]) {
      return {
        version: active[0].version,
        systemPrompt: active[0].systemPrompt,
        isCanary: false,
      };
    }

    // Fallback to hardcoded prompt when DB is empty
    return {
      version: 'fallback',
      systemPrompt: `You are FELO Coach, a personal finance assistant.`,
      isCanary: false,
    };
  }

  async listPrompts() {
    return this.db.select().from(coachPrompts).orderBy(desc(coachPrompts.createdAt));
  }

  async createPrompt(dto: {
    version: string;
    name: string;
    systemPrompt: string;
    isActive?: boolean;
    isCanary?: boolean;
    canaryPercent?: number;
  }) {
    const [row] = await this.db
      .insert(coachPrompts)
      .values({
        version: dto.version,
        name: dto.name,
        systemPrompt: dto.systemPrompt,
        isActive: dto.isActive ?? false,
        isCanary: dto.isCanary ?? false,
        canaryPercent: dto.canaryPercent ?? 0,
      })
      .returning();
    return row;
  }

  async setActive(id: string) {
    // Deactivate all
    await this.db.update(coachPrompts).set({ isActive: false }).where(eq(coachPrompts.isActive, true));
    // Activate selected
    const [row] = await this.db
      .update(coachPrompts)
      .set({ isActive: true })
      .where(eq(coachPrompts.id, id))
      .returning();
    return row;
  }

  async setCanary(id: string, percent: number) {
    // Clear existing canary
    await this.db.update(coachPrompts).set({ isCanary: false, canaryPercent: 0 }).where(eq(coachPrompts.isCanary, true));
    // Set new canary
    const [row] = await this.db
      .update(coachPrompts)
      .set({ isCanary: true, canaryPercent: percent })
      .where(eq(coachPrompts.id, id))
      .returning();
    return row;
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
