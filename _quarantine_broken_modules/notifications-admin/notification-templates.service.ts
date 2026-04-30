import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { notificationTemplates, type NotificationTemplate, type NewNotificationTemplate } from '@db/schema';
import { AuditService } from '@/common/services/audit.service';

@Injectable()
export class NotificationTemplatesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly audit: AuditService,
  ) {}

  /** List all notification templates. */
  async list(): Promise<NotificationTemplate[]> {
    return this.db.select().from(notificationTemplates).orderBy(notificationTemplates.name);
  }

  /** Create a notification template. */
  async create(adminId: string, dto: NewNotificationTemplate): Promise<NotificationTemplate> {
    const inserted = await this.db
      .insert(notificationTemplates)
      .values({
        name: dto.name,
        type: dto.type,
        titleEn: dto.titleEn,
        titleUr: dto.titleUr ?? null,
        bodyEn: dto.bodyEn,
        bodyUr: dto.bodyUr ?? null,
        variables: dto.variables ?? [],
        isActive: dto.isActive ?? true,
        createdBy: adminId,
      })
      .returning();

    const template = inserted[0];

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'create',
      resourceType: 'notification_template',
      resourceId: template.id,
      after: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  /** Update a notification template. */
  async update(adminId: string, id: string, dto: Partial<NewNotificationTemplate>): Promise<NotificationTemplate> {
    const existing = await this.db.query.notificationTemplates.findFirst({
      where: eq(notificationTemplates.id, id),
    });
    if (!existing) throw new NotFoundException('Template not found');

    const updated = await this.db
      .update(notificationTemplates)
      .set({
        ...(dto.name && { name: dto.name }),
        ...(dto.type && { type: dto.type }),
        ...(dto.titleEn !== undefined && { titleEn: dto.titleEn }),
        ...(dto.titleUr !== undefined && { titleUr: dto.titleUr }),
        ...(dto.bodyEn !== undefined && { bodyEn: dto.bodyEn }),
        ...(dto.bodyUr !== undefined && { bodyUr: dto.bodyUr }),
        ...(dto.variables && { variables: dto.variables }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(notificationTemplates.id, id))
      .returning();

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'update',
      resourceType: 'notification_template',
      resourceId: id,
      before: existing as unknown as Record<string, unknown>,
      after: updated[0] as unknown as Record<string, unknown>,
    });

    return updated[0];
  }

  /** Delete a notification template. */
  async delete(adminId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.db.query.notificationTemplates.findFirst({
      where: eq(notificationTemplates.id, id),
    });
    if (!existing) throw new NotFoundException('Template not found');

    await this.db.delete(notificationTemplates).where(eq(notificationTemplates.id, id));

    await this.audit.log({
      actorId: adminId,
      actorType: 'admin',
      action: 'delete',
      resourceType: 'notification_template',
      resourceId: id,
    });

    return { ok: true };
  }

  /** Render a template with variables. */
  render(template: NotificationTemplate, variables: Record<string, string>, locale: string = 'en'): { title: string; body: string } {
    let title = locale === 'ur' ? (template.titleUr ?? template.titleEn) : template.titleEn;
    let body = locale === 'ur' ? (template.bodyUr ?? template.bodyEn) : template.bodyEn;

    for (const [key, value] of Object.entries(variables)) {
      title = title.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
      body = body.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    }

    return { title, body };
  }
}
