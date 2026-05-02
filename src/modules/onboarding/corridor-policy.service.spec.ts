import { Test, TestingModule } from '@nestjs/testing';
import { CorridorPolicyService } from './corridor-policy.service';

describe('CorridorPolicyService', () => {
  let service: CorridorPolicyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CorridorPolicyService],
    }).compile();
    service = module.get<CorridorPolicyService>(CorridorPolicyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
