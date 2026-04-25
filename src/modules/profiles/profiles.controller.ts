import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { UpdateMeDto } from './dto/update-me.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Return the full profile for the bearer' })
  me(@CurrentUser() user: RequestUser) {
    return this.profiles.getById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update profile fields' })
  updateMe(@CurrentUser() user: RequestUser, @Body() body: UpdateMeDto) {
    return this.profiles.updateMe(user.id, body);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Soft-delete current profile (30-day grace, then hard purge)',
  })
  delete(@CurrentUser() user: RequestUser) {
    return this.profiles.softDelete(user.id);
  }
}
