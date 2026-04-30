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

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RequestUser } from '@/common/types/request-user';

import { CreateOrderDto } from './dto/create-order.dto';
import { CursorPaginationDto } from './dto/cursor-pagination.dto';
import { DisbursementService } from './disbursement.service';

/**
 * The Squad 2/3/4 modules use integer actor ids on their tables. The
 * app-wide RequestUser carries a UUID. We hash the UUID into a stable
 * positive 32-bit int so each app user maps to a deterministic actor row.
 * Real production would persist a mapping in `treasury_actors`.
 */
function actorIdFromUuid(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

@Controller('remittance')
@UseGuards(JwtAuthGuard)
export class DisbursementController {
  constructor(private readonly disbursementService: DisbursementService) {}

  @Post('disburse')
  async disburse(@CurrentUser() user: RequestUser, @Body() body: CreateOrderDto, @Req() req: Request) {
    const actorId = actorIdFromUuid(user.id);
    const kycTier = (user as unknown as { kycTier?: string }).kycTier ?? 'none';
    const ua = (req as unknown as { headers?: Record<string, string> }).headers?.['user-agent'];
    const ip = (req as unknown as { ip?: string }).ip;
    return this.disbursementService.createOrder(
      actorId,
      kycTier as 'none' | 'basic' | 'verified' | 'premium',
      {
        dealId: body.dealId,
        methodId: body.methodId,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
      },
      ip,
      ua,
    );
  }

  @Get('orders/:id')
  async getOrder(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const actorId = actorIdFromUuid(user.id);
    const order = await this.disbursementService.getOrderStatus(Number(id));
    if (!order) throw new ForbiddenException('Order not found');
    if (order.actorId !== actorId) throw new ForbiddenException('Access denied');
    return order;
  }

  @Post('orders/:id/retry')
  async retry(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const actorId = actorIdFromUuid(user.id);
    const orderId = Number(id);
    const order = await this.disbursementService.getOrderStatus(orderId);
    if (!order) throw new ForbiddenException('Order not found');
    if (order.actorId !== actorId) throw new ForbiddenException('Access denied');
    const ua = (req as unknown as { headers?: Record<string, string> }).headers?.['user-agent'];
    const ip = (req as unknown as { ip?: string }).ip;
    await this.disbursementService.retryFailed(actorId, orderId, ip, ua);
    return { success: true };
  }

  @Get('orders')
  listOrders(@CurrentUser() user: RequestUser, @Query() query: CursorPaginationDto) {
    return this.disbursementService.listOrders(actorIdFromUuid(user.id), query);
  }
}
