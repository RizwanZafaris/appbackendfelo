import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { RequestUser } from '@/common/types/request-user';

import { DisbursementService } from './disbursement.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CursorPaginationDto } from './dto/cursor-pagination.dto';
import { TreasuryActorsService } from './treasury-actors.service';

/**
 * Disbursement endpoints.
 *
 * Actor identity: Supabase JWT carries the user UUID (req.user.id). We
 * resolve it through TreasuryActorsService into the integer actor id used
 * by ledger/disbursement tables. The previous implementation used a
 * 32-bit string-hash of the UUID, which collided across users and produced
 * cross-user IDOR — replaced with a UNIQUE-indexed mapping table.
 */
@Controller('remittance')
@UseGuards(SupabaseJwtGuard)
export class DisbursementController {
  constructor(
    private readonly disbursementService: DisbursementService,
    private readonly treasuryActors: TreasuryActorsService,
  ) {}

  // Hard cap: 5 disbursement creations per minute per IP. Per-user velocity
  // is enforced by the rolling-window AML check inside the service.
  @Throttle({ remittance: { limit: 5, ttl: 60_000 } })
  @Post('disburse')
  async disburse(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateOrderDto,
    @Req() req: Request,
  ) {
    const { actorId, kycTier } = await this.treasuryActors.resolve(user.id, user.email);
    const headers = (req as unknown as { headers?: Record<string, string> }).headers ?? {};
    const ua = headers['user-agent'];
    const ip = (req as unknown as { ip?: string }).ip;
    const idempotencyKey = headers['idempotency-key'] ?? body.idempotencyKey ?? '';
    return this.disbursementService.createOrder(
      actorId,
      kycTier,
      {
        dealId: body.dealId,
        methodId: body.methodId,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
        idempotencyKey,
        recipientHash: body.recipientHash,
        recipientCountry: body.recipientCountry,
        userUuid: user.id,
      },
      ip,
      ua,
    );
  }

  @Get('orders/:id')
  async getOrder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const { actorId } = await this.treasuryActors.resolve(user.id, user.email);
    const order = await this.disbursementService.getOrderStatus(Number(id));
    if (!order) throw new ForbiddenException('Order not found');
    if (order.actorId !== actorId) throw new ForbiddenException('Access denied');
    return order;
  }

  @Throttle({ remittance: { limit: 5, ttl: 60_000 } })
  @Post('orders/:id/retry')
  async retry(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { actorId } = await this.treasuryActors.resolve(user.id, user.email);
    const orderId = Number(id);
    const order = await this.disbursementService.getOrderStatus(orderId);
    if (!order) throw new ForbiddenException('Order not found');
    if (order.actorId !== actorId) throw new ForbiddenException('Access denied');
    const headers = (req as unknown as { headers?: Record<string, string> }).headers ?? {};
    const ua = headers['user-agent'];
    const ip = (req as unknown as { ip?: string }).ip;
    await this.disbursementService.retryFailed(actorId, orderId, ip, ua);
    return { success: true };
  }

  @Get('orders')
  async listOrders(
    @CurrentUser() user: RequestUser,
    @Query() query: CursorPaginationDto,
  ) {
    const { actorId } = await this.treasuryActors.resolve(user.id, user.email);
    return this.disbursementService.listOrders(actorId, query);
  }
}
