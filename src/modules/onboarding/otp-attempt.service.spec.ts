import { Test, TestingModule } from '@nestjs/testing';
import { OtpAttemptService } from './otp-attempt.service';

describe('OtpAttemptService', () => {
  let service: OtpAttemptService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OtpAttemptService],
    }).compile();
    service = module.get<OtpAttemptService>(OtpAttemptService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
