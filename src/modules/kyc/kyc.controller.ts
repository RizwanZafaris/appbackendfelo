import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { KycService } from './kyc.service';
import { CreateKycProfileDto, UploadDocumentDto, KycReviewDto, KycQueueQueryDto } from './kyc.dto';

@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('profile')
  async createProfile(@Request() req: any, @Body() dto: CreateKycProfileDto) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.createProfile(userId, dto);
  }

  @Get('profile')
  async getProfile(@Request() req: any) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.getProfile(userId);
  }

  @Post('documents')
  async uploadDocument(@Request() req: any, @Body() dto: UploadDocumentDto) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.uploadDocument(userId, dto);
  }

  @Get('documents')
  async listDocuments(@Request() req: any) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.listDocuments(userId);
  }

  @Delete('documents/:id')
  async deleteDocument(@Request() req: any, @Param('id') documentId: string) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.deleteDocument(userId, documentId);
  }

  @Get('status')
  async getStatus(@Request() req: any) {
    const userId = req.user?.sub ?? req.user?.id;
    return this.kycService.getStatus(userId);
  }
}
