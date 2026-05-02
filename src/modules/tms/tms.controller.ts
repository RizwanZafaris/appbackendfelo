import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { TmsService } from './tms.service';
import { CreateRuleDto, ResolveAlertDto, CreateCaseDto, UpdateCaseDto } from './tms.dto';

@Controller('admin/tms')
export class TmsController {
  constructor(private readonly tmsService: TmsService) {}

  // Rules
  @Get('rules')
  async listRules() {
    return this.tmsService.listRules();
  }

  @Post('rules')
  async createRule(@Body() dto: CreateRuleDto) {
    return this.tmsService.createRule(dto);
  }

  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: Partial<CreateRuleDto>) {
    return this.tmsService.updateRule(id, dto);
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string) {
    return this.tmsService.deleteRule(id);
  }

  // Alerts
  @Get('alerts')
  async listAlerts(@Query('status') status?: string, @Query('assignedTo') assignedTo?: string) {
    return this.tmsService.listAlerts(status as any, assignedTo);
  }

  @Get('alerts/:id')
  async getAlert(@Param('id') id: string) {
    return this.tmsService.getAlert(id);
  }

  @Patch('alerts/:id')
  async resolveAlert(@Param('id') id: string, @Body() dto: ResolveAlertDto) {
    return this.tmsService.resolveAlert(id, dto);
  }

  // Cases
  @Get('cases')
  async listCases(@Query('status') status?: string) {
    return this.tmsService.listCases(status as any);
  }

  @Get('cases/:id')
  async getCase(@Param('id') id: string) {
    return this.tmsService.getCase(id);
  }

  @Post('cases')
  async createCase(@Body() dto: CreateCaseDto) {
    return this.tmsService.createCase(dto);
  }

  @Patch('cases/:id')
  async updateCase(@Param('id') id: string, @Body() dto: UpdateCaseDto) {
    return this.tmsService.updateCase(id, dto);
  }

  // Sanctions
  @Get('sanctions')
  async listSanctions(@Query('listType') listType?: string) {
    return this.tmsService.listSanctions(listType);
  }
}
