import { Test, TestingModule } from '@nestjs/testing';
import { GuardrailsService } from './guardrails.service';

describe('GuardrailsService', () => {
  let service: GuardrailsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GuardrailsService],
    }).compile();
    service = module.get<GuardrailsService>(GuardrailsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
