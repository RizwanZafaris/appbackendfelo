import { Controller, Get, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto, ListUsersQueryDto } from './users.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersService.listActive({
      page: query.page,
      limit: query.limit,
      search: query.search,
      corridor: query.corridor,
      kycStatus: query.kycStatus,
    });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get('by-email/:email')
  async getByEmail(@Param('email') email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) return { found: false };
    return { found: true, user };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  async softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.usersService.softDelete(id);
    return { success: true, deletedBy: user.id };
  }
}
