import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Return the full user record for the bearer' })
  me(@CurrentUser() user: RequestUser) {
    return this.users.getById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update display name, language, or corridor' })
  updateMe(@CurrentUser() user: RequestUser, @Body() body: UpdateMeDto) {
    return this.users.updateMe(user.id, body);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Soft-delete current user (30-day grace, then hard purge)',
  })
  delete(@CurrentUser() user: RequestUser) {
    return this.users.softDelete(user.id);
  }
}
