import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  RawBody,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { RequestUser } from '@/common/types/request-user';

import { KycService } from './kyc.service';
import { InitiateKycDto, KycWebhookDto } from './dto/kyc.dto';

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(private readonly svc: KycService) {}

  /**
   * POST /kyc/initiate
   *
   * Starts the KYC verification flow for the current user.
   * Creates a Sumsub applicant record and returns the applicant ID.
   * Idempotent: if an applicant already exists the existing ID is returned.
   */
  @ApiOperation({ summary: 'Start KYC verification flow' })
  @Post('initiate')
  async initiate(
    @CurrentUser() user: RequestUser,
    @Body() dto: InitiateKycDto,
  ) {
    const result = await this.svc.createApplicant(
      user.id,
      dto.email,
      dto.phone,
    );
    return result;
  }

  /**
   * GET /kyc/status/:id
   *
   * Returns the current Sumsub verification status for the given applicant.
   */
  @ApiOperation({ summary: 'Check KYC verification status' })
  @Get('status/:id')
  async status(@Param('id') applicantId: string) {
    return this.svc.getApplicantStatus(applicantId);
  }

  /**
   * POST /kyc/webhook
   *
   * Receives Sumsub review callbacks.
   * This endpoint is public (no JWT) because it is called by Sumsub servers.
   * Signature verification is performed using the X-Payload-Digest header.
   */
  @ApiOperation({ summary: 'Sumsub webhook callback' })
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @RawBody() rawBody: Buffer,
    @Headers('x-payload-digest') digest: string,
    @Headers('x-payload-digest-alg') algorithm: string,
  ) {
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Empty webhook body');
    }

    const raw = rawBody.toString('utf-8');

    // Verify signature before processing.
    const valid = this.svc.verifyWebhookSignature(raw, digest ?? '', algorithm ?? '');
    if (!valid) {
      this.logger.warn('Webhook rejected — signature verification failed');
      throw new InternalServerErrorException('Webhook signature invalid');
    }

    let payload: KycWebhookDto;
    try {
      payload = JSON.parse(raw) as KycWebhookDto;
    } catch {
      throw new BadRequestException('Invalid JSON in webhook body');
    }

    return this.svc.handleWebhook(payload);
  }
}
