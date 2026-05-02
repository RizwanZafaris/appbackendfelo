import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { DatabaseService } from '@/common/database.service';
import { webhookEvents } from '@db/schema';

/**
 * Verifies HMAC signatures on inbound provider webhooks AND records the
 * event for replay protection.
 *
 * The controller must mount the raw body parser (see main.ts mounting
 * `bodyParser.raw` on /v1/remittance/webhook). The guard reads
 * `req.rawBody` to compute HMAC-SHA256 against the per-provider secret
 * (WEBHOOK_SECRET_<PROVIDER>), then performs:
 *
 *   1. Constant-time signature compare.
 *   2. Timestamp window (5 min default) — rejects replay >5 min old.
 *   3. UNIQUE(provider, event_id) — second insert returns 23505 and the
 *      guard rejects the duplicate.
 *
 * @Public() should be applied at the controller level so SupabaseJwtGuard
 * doesn't reject these unauthenticated calls.
 */
@Injectable()
export class RemittanceWebhookGuard implements CanActivate {
  private readonly logger = new Logger(RemittanceWebhookGuard.name);
  private readonly toleranceMs = 5 * 60 * 1000;

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      params: Record<string, string>;
      headers: Record<string, string>;
      rawBody?: Buffer;
      body?: unknown;
    }>();
    const provider = (req.params.providerCode ?? '').toLowerCase();
    if (!provider) throw new UnauthorizedException('Provider missing from path');

    const secret = this.cfg.get<string>(`WEBHOOK_SECRET_${provider.toUpperCase()}`);
    if (!secret) {
      this.logger.warn(`No webhook secret configured for provider=${provider}`);
      throw new UnauthorizedException('Webhook secret not configured');
    }

    const signature = (req.headers['x-signature'] || req.headers['x-hub-signature-256'] || '') as string;
    const timestampHeader = (req.headers['x-timestamp'] || '') as string;
    const eventId = (req.headers['x-event-id'] || '') as string;
    if (!signature || !eventId) {
      throw new UnauthorizedException('Missing x-signature or x-event-id');
    }

    // Replay window — rejects events whose timestamp is too old or in the
    // future (clock-skew tolerated). If the provider does not send
    // x-timestamp, fall back to received_at for replay detection only.
    if (timestampHeader) {
      const tsMs = Number(timestampHeader) * (timestampHeader.length <= 10 ? 1000 : 1);
      if (Number.isFinite(tsMs)) {
        const drift = Math.abs(Date.now() - tsMs);
        if (drift > this.toleranceMs) {
          throw new UnauthorizedException('Webhook timestamp outside tolerance window');
        }
      }
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new UnauthorizedException(
        'Empty raw body — bodyParser.raw must be mounted before this route',
      );
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const givenBuf = Buffer.from(signature.replace(/^sha256=/i, ''), 'utf8');
    if (
      expectedBuf.length !== givenBuf.length ||
      !timingSafeEqual(expectedBuf, givenBuf)
    ) {
      throw new UnauthorizedException('Webhook signature mismatch');
    }

    // Persist for replay protection and audit. UNIQUE(provider, event_id)
    // returns 23505 on duplicate — converted to 401 here so retries are
    // rejected at the boundary.
    try {
      await this.db.db.insert(webhookEvents).values({
        provider,
        eventId,
        signature,
        status: 'verified',
        payload: this.safeParse(raw) as never,
      } as never);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new UnauthorizedException('Webhook already processed (replay)');
      }
      throw err;
    }

    // Re-parse the JSON for the controller — bodyParser.raw left it as a Buffer.
    req.body = this.safeParse(raw);
    return true;
  }

  private safeParse(buf: Buffer): unknown {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return { _raw: buf.toString('base64') };
    }
  }
}
