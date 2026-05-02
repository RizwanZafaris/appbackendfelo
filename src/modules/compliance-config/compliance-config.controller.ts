import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ComplianceConfigService } from './compliance-config.service';
import { UpdateComplianceConfigDto } from './compliance-config.dto';

@Controller('admin/compliance')
export class ComplianceConfigController {
  constructor(private readonly configService: ComplianceConfigService) {}

  @Get('config')
  async getConfig() {
    return this.configService.getOrInitDefaultConfig();
  }

  @Patch('config')
  async updateConfig(@Body() dto: UpdateComplianceConfigDto) {
    await this.configService.updateConfig(dto.section, JSON.parse(dto.config));
    return { success: true };
  }
}
