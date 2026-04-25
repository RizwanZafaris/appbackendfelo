import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import { RegisterDeviceDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List registered devices for the current user' })
  list(@CurrentUser() user: RequestUser) {
    return this.svc.listDevices(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Register or refresh a push device' })
  register(@CurrentUser() user: RequestUser, @Body() dto: RegisterDeviceDto) {
    return this.svc.registerDevice(user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a device (sign out / lose token)' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeDevice(user.id, id);
  }
}
