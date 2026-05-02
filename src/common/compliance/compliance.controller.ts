import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';
import { DataRetentionService } from './data-retention.service';
import { GdprExportService } from './gdpr-export.service';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
@UseGuards(SupabaseJwtGuard)
export class ComplianceController {
  constructor(
    private readonly dataRetention: DataRetentionService,
    private readonly gdprExport: GdprExportService,
  ) {}

  @Get('data-export')
  @ApiOperation({ summary: 'Export all user data (GDPR Article 20)' })
  async exportData(@CurrentUser() user: RequestUser) {
    return this.gdprExport.exportUserData(user.id);
  }

  @Delete('data-export')
  @ApiOperation({ summary: 'Delete all user data (GDPR right to erasure)' })
  async deleteData(@CurrentUser() user: RequestUser) {
    return this.gdprExport.deleteUserData(user.id);
  }

  @Post('retention/run')
  @ApiOperation({ summary: 'Trigger data retention cleanup (admin only)' })
  async runRetention() {
    return this.dataRetention.runRetentionCleanup();
  }

  @Get('retention/status')
  @ApiOperation({ summary: 'Get data retention policy status' })
  async getRetentionStatus() {
    return this.dataRetention.getRetentionStatus();
  }
}
