import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { notificationTemplates } from '@db/schema';

export interface RenderedTemplate {
  title: string;
  body: string;
}

@Injectable()
export class NotificationTemplateService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getTemplate(type: string) {
    const rows = await this.db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.type, type));
    return rows[0] ?? null;
  }

  /** Render a template with variables in the given language. */
  async render(type: string, variables: Record<string, string>, language: 'en' | 'ur' = 'en'): Promise<RenderedTemplate> {
    const tmpl = await this.getTemplate(type);
    if (!tmpl) {
      return {
        title: variables.title ?? 'Notification',
        body: variables.body ?? '',
      };
    }

    let title = language === 'ur' && tmpl.titleUr ? tmpl.titleUr : tmpl.titleEn;
    let body = language === 'ur' && tmpl.bodyUr ? tmpl.bodyUr : tmpl.bodyEn;

    // Simple variable substitution
    for (const [key, value] of Object.entries(variables)) {
      title = title.replace(new RegExp(`{{${key}}}`, 'g'), value);
      body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return { title, body };
  }

  // ---- Admin CRUD ----

  async listTemplates() {
    return this.db.select().from(notificationTemplates).orderBy(notificationTemplates.type);
  }

  async createTemplate(dto: {
    type: string;
    channel: 'push' | 'email' | 'inapp' | 'sms';
    titleEn: string;
    bodyEn: string;
    titleUr?: string;
    bodyUr?: string;
    variables?: string[];
  }) {
    const [row] = await this.db
      .insert(notificationTemplates)
      .values({
        type: dto.type,
        channel: dto.channel,
        titleEn: dto.titleEn,
        bodyEn: dto.bodyEn,
        titleUr: dto.titleUr ?? null,
        bodyUr: dto.bodyUr ?? null,
        variables: dto.variables ?? [],
      })
      .returning();
    return row;
  }

  async updateTemplate(
    id: string,
    dto: Partial<{
      titleEn: string;
      bodyEn: string;
      titleUr: string;
      bodyUr: string;
      isActive: boolean;
      variables: string[];
    }>,
  ) {
    const [row] = await this.db
      .update(notificationTemplates)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(notificationTemplates.id, id))
      .returning();
    return row;
  }

  async deleteTemplate(id: string) {
    await this.db.delete(notificationTemplates).where(eq(notificationTemplates.id, id));
    return { ok: true };
  }
}
