import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import { AuditLogService } from '@/modules/audit-log/audit-log.service';

/**
 * NestJS interceptor that records every mutation (POST, PATCH, DELETE)
 * to the audit_logs table. GET requests are only audited when they
 * target a specific resource (contain an ID in the path).
 *
 * Register as APP_INTERCEPTOR in app.module.ts to apply globally.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const method = req.method as string;
    const path = req.route?.path ?? req.path ?? '';

    // Skip health checks and static assets
    if (path.includes('health') || path.includes('webhook')) {
      return next.handle();
    }

    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const isSpecificGet = method === 'GET' && /\/(\w{8,}|:\w+)$/.test(path);

    if (!isMutation && !isSpecificGet) {
      return next.handle();
    }

    const user = req.user as { id?: string } | undefined;
    const actorId = user?.id ?? 'anonymous';
    const ipAddress = req.ip ?? req.headers['x-forwarded-for'] ?? null;
    const userAgent = req.headers['user-agent'] ?? null;

    // Derive entity type from path
    const entityType = this.extractEntityType(path);
    const entityId = req.params?.id ?? req.params?.memberId ?? null;

    const before = method === 'PATCH' || method === 'DELETE' ? { body: req.body } : undefined;

    return next.handle().pipe(
      tap(async (response) => {
        try {
          await this.audit.record({
            actorId,
            entityType,
            entityId,
            operation: this.mapMethod(method),
            before,
            after: response && typeof response === 'object' ? (response as Record<string, unknown>) : undefined,
            ipAddress: typeof ipAddress === 'string' ? ipAddress : null,
            userAgent: typeof userAgent === 'string' ? userAgent : null,
            metadata: {
              path,
              httpMethod: method,
              statusCode: req.res?.statusCode,
            },
          });
        } catch {
          // Audit failures must not break the request
        }
      }),
    );
  }

  private extractEntityType(path: string): string {
    const segments = path.split('/').filter(Boolean);
    // e.g. '/family/groups/:id' -> 'family_groups'
    if (segments.length >= 2) return `${segments[0]}_${segments[1]}`;
    return segments[0] ?? 'unknown';
  }

  private mapMethod(method: string): 'create' | 'update' | 'delete' | 'read' {
    switch (method) {
      case 'POST':
        return 'create';
      case 'PATCH':
      case 'PUT':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'read';
    }
  }
}
