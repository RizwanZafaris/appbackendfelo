import { Test, TestingModule } from '@nestjs/testing';
import { TwoPersonApprovalService } from './two-person-approval.service';

describe('TwoPersonApprovalService', () => {
  let service: TwoPersonApprovalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TwoPersonApprovalService],
    }).compile();
    service = module.get<TwoPersonApprovalService>(TwoPersonApprovalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
