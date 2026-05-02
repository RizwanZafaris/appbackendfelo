import { Test, TestingModule } from '@nestjs/testing';
import { FxRatesService } from './fx-rates.service';

describe('FxRatesService', () => {
  let service: FxRatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FxRatesService],
    }).compile();
    service = module.get<FxRatesService>(FxRatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
