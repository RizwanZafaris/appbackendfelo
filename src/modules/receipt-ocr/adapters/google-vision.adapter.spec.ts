import { Test, TestingModule } from '@nestjs/testing';
import { GoogleVisionAdapter } from './google-vision.adapter';

describe('GoogleVisionAdapter', () => {
  let adapter: GoogleVisionAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleVisionAdapter],
    }).compile();
    adapter = module.get<GoogleVisionAdapter>(GoogleVisionAdapter);
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });
});
