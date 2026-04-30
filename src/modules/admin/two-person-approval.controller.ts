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

import { TwoPersonApprovalService } from './two-person-approval.service';

@ApiTags('admin / approvals')
@ApiBearerAuth()
@Controller('admin/approvals')
@RequiresAdmin('ops_manager')
export class TwoPersonApprovalController {
  constructor(private readonly svc: TwoPersonApprovalService) {}

  @Get()
  @ApiOperation({ summary: 'List pending approval requests' })
  listPending() {
    return this.svc.listPending();
  }

  @Post()
  @ApiOperation({ summary: 'Create an approval request' })
  @RequiresAdmin('support_agent')
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      requestType: 'refund' | 'tier_change' | 'data_export' | 'pii_access' | 'config_change';
      resourceType: string;
      resourceId: string;
      notes?: string;
      expiresAt?: string;
    },
  ) {
    return this.svc.create(admin.id, {
      ...body,
      resourceId: body.resourceId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a request (second approver)' })
  approve(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approve(admin.id, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a request' })
  reject(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.reject(admin.id, id, body?.reason);
  }
}
