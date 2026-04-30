import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { FamilyService } from './family.service';

class CreateFamilyGroupDto {
  name!: string;
}

class UpdateFamilyGroupDto {
  name?: string;
}

class InviteMemberDto {
  inviteeEmail?: string;
  inviteePhone?: string;
  role?: 'admin' | 'member' | 'viewer';
}

class UpdateMemberRoleDto {
  role!: 'admin' | 'member' | 'viewer';
}

@ApiTags('family')
@ApiBearerAuth()
@Controller('family')
export class FamilyController {
  constructor(private readonly svc: FamilyService) {}

  // ---- Groups ----

  @Post('groups')
  @ApiBody({ type: CreateFamilyGroupDto })
  @ApiOperation({ summary: 'Create a new family group' })
  createGroup(@CurrentUser() user: RequestUser, @Body() dto: CreateFamilyGroupDto) {
    return this.svc.createGroup(user.id, dto);
  }

  @Get('groups')
  @ApiOperation({ summary: 'List family groups the user belongs to' })
  listGroups(@CurrentUser() user: RequestUser) {
    return this.svc.listGroups(user.id);
  }

  @Get('groups/:id')
  @ApiOperation({ summary: 'Get a family group by ID' })
  getGroup(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getGroup(user.id, id);
  }

  @Patch('groups/:id')
  @ApiBody({ type: UpdateFamilyGroupDto })
  @ApiOperation({ summary: 'Update family group name' })
  updateGroup(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFamilyGroupDto,
  ) {
    return this.svc.updateGroup(user.id, id, dto);
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Delete a family group' })
  deleteGroup(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteGroup(user.id, id);
  }

  // ---- Invitations ----

  @Post('groups/:id/invite')
  @ApiBody({ type: InviteMemberDto })
  @ApiOperation({ summary: 'Invite a member to a family group' })
  inviteMember(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.svc.inviteMember(user.id, id, dto);
  }

  @Post('invitations/:code/accept')
  @ApiOperation({ summary: 'Accept a family invitation' })
  acceptInvitation(
    @CurrentUser() user: RequestUser,
    @Param('code') code: string,
  ) {
    return this.svc.acceptInvitation(user.id, code);
  }

  @Post('invitations/:code/revoke')
  @ApiOperation({ summary: 'Revoke a pending family invitation' })
  revokeInvitation(
    @CurrentUser() user: RequestUser,
    @Param('code') code: string,
  ) {
    return this.svc.revokeInvitation(user.id, code);
  }

  // ---- Members ----

  @Get('groups/:id/members')
  @ApiOperation({ summary: 'List members of a family group' })
  listMembers(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.listMembers(user.id, id);
  }

  @Patch('groups/:id/members/:memberId/role')
  @ApiBody({ type: UpdateMemberRoleDto })
  @ApiOperation({ summary: 'Update a family member role' })
  updateMemberRole(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.svc.updateMemberRole(user.id, groupId, memberId, dto);
  }

  @Delete('groups/:id/members/:memberId')
  @ApiOperation({ summary: 'Remove a member from a family group' })
  removeMember(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.svc.removeMember(user.id, groupId, memberId);
  }
}
