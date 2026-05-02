import { Test, TestingModule } from '@nestjs/testing';
import { RemittanceService } from './remittance.service';

describe('RemittanceService', () => {
  let service: RemittanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RemittanceService],
    }).compile();
    service = module.get<RemittanceService>(RemittanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
