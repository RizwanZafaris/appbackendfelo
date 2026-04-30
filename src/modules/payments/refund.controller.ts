import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';

import { RefundService } from './refund.service';

@ApiTags('admin / refunds')
@ApiBearerAuth()
@Controller('admin/refunds')
@RequiresAdmin('support_agent')
export class RefundController {
  constructor(private readonly svc: RefundService) {}

  @Get()
  @ApiOperation({ summary: 'List all refund requests' })
  list() {
    return this.svc.listRefunds();
  }

  @Post()
  @ApiOperation({ summary: 'Create a refund request' })
  @RequiresAdmin('support_agent')
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      userId: string;
      subscriptionId?: string;
      amountMinor: number;
      currency: string;
      reason?: string;
      stripePaymentIntentId?: string;
    },
  ) {
    return this.svc.createRefund(admin.id, body);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a refund (second approver for >PKR 50k)' })
  @RequiresAdmin('ops_manager')
  approve(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approveRefund(admin.id, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a refund' })
  @RequiresAdmin('ops_manager')
  reject(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.rejectRefund(admin.id, id, body?.reason);
  }
}
