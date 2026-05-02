import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { KybService } from './kyb.service';
import { CreateBusinessDto, AddUboDto, UploadBusinessDocDto, KybReviewDto, KybQueueQueryDto } from './kyb.dto';

@Controller('kyb')
export class KybController {
  constructor(private readonly kybService: KybService) {}

  @Post('business')
  async createBusiness(@Body() dto: CreateBusinessDto) {
    return this.kybService.createBusiness(dto);
  }

  @Get('business/:id')
  async getBusiness(@Param('id') id: string) {
    return this.kybService.getBusiness(id);
  }

  @Post('business/:id/ubo')
  async addUbo(@Param('id') businessId: string, @Body() dto: AddUboDto) {
    return this.kybService.addUbo(businessId, dto);
  }

  @Get('business/:id/ubos')
  async listUbos(@Param('id') businessId: string) {
    return this.kybService.listUbos(businessId);
  }

  @Post('business/:id/documents')
  async uploadDoc(@Param('id') businessId: string, @Body() dto: UploadBusinessDocDto) {
    return this.kybService.uploadDocument(businessId, dto);
  }

  @Get('business/:id/documents')
  async listDocs(@Param('id') businessId: string) {
    return this.kybService.listDocuments(businessId);
  }

  @Get('business/:id/status')
  async getStatus(@Param('id') businessId: string) {
    return this.kybService.getBusinessStatus(businessId);
  }
}

@Controller('admin/kyb')
export class AdminKybController {
  constructor(private readonly kybService: KybService) {}

  @Get('queue')
  async getQueue(@Query() query: KybQueueQueryDto) {
    return this.kybService.getReviewQueue((query.status as any) || 'all', query.search);
  }

  @Get(':id')
  async getBusiness(@Param('id') id: string) {
    return this.kybService.getBusinessStatus(id);
  }

  @Patch(':id/status')
  async reviewBusiness(@Param('id') id: string, @Body() dto: KybReviewDto) {
    const reviewerId = 'system'; // TODO: get from auth context
    return this.kybService.reviewBusiness(id, { ...dto, reviewerId });
  }
}
