import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequiresAdmin } from '@/common/decorators/requires-admin.decorator';
import { CurrentAdmin, RequestAdmin } from '@/common/decorators/current-admin.decorator';

import { AdminUsersService } from './admin-users.service';

@ApiTags('admin / users')
@ApiBearerAuth()
@Controller('admin/users')
@RequiresAdmin('ops_manager')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all admin users' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create admin user' })
  create(
    @CurrentAdmin() admin: RequestAdmin,
    @Body() body: {
      email: string;
      displayName?: string;
      role?: 'super_admin' | 'ops_manager' | 'support_agent' | 'read_only';
      isActive?: boolean;
    },
  ) {
    return this.svc.create(admin.id, body as Parameters<AdminUsersService['create']>[1]);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update admin user role' })
  updateRole(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { role: 'super_admin' | 'ops_manager' | 'support_agent' | 'read_only' },
  ) {
    return this.svc.updateRole(admin.id, id, body.role);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate admin user' })
  @RequiresAdmin('super_admin')
  deactivate(
    @CurrentAdmin() admin: RequestAdmin,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deactivate(admin.id, id);
  }
}
