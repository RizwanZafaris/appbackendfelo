import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '@/common/config/env-validation';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly configService: ConfigService) {}

  @Get('env-check')
  @ApiOperation({ summary: 'Validate environment configuration' })
  envCheck() {
    const result = validateEnvironment(this.configService);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('version')
  @ApiOperation({ summary: 'Get API version and build info' })
  version() {
    return {
      version: process.env.npm_package_version || '0.1.0',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      env: this.configService.get<string>('NODE_ENV', 'development'),
      timestamp: new Date().toISOString(),
    };
  }
}
