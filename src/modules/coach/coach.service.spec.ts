import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';

import { DRIZZLE } from '@/common/db/db.module';
import { coachConversations, coachQueries } from '@db/schema';

import { CoachChatService } from './coach-chat.service';
import { CoachCostService } from './coach-cost.service';
import { CoachPromptService } from './coach-prompt.service';
import { GuardrailTripService } from './guardrail-trip.service';
import { CoachService } from './coach.service';
import { LlmCoachService } from './llm/llm-coach.service';

const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  query: {
    coachConversations: { findFirst: jest.fn() },
  },
};

const mockPromptSvc = {
  resolve: jest.fn().mockResolvedValue({ version: 'v1.0.0', systemPrompt: 'test', isCanary: false }),
  listPrompts: jest.fn(),
  createPrompt: jest.fn(),
  setActive: jest.fn(),
  setCanary: jest.fn(),
};

const mockCostSvc = {
  record: jest.fn().mockResolvedValue({}),
  costsByConversation: jest.fn(),
  costsByUser: jest.fn(),
  totalCostByUser: jest.fn(),
  dailyCostSummary: jest.fn(),
};

const mockTripSvc = {
  record: jest.fn().mockResolvedValue({}),
  listTrips: jest.fn(),
  tripStats: jest.fn(),
};

const mockLlm = {
  run: jest.fn().mockResolvedValue({
    answer: 'Test answer',
    sources: [],
    guardrailTriggered: false,
    tokensUsed: 100,
    costUsd: 0.001,
    consumesQuota: true,
    inputTokens: 50,
    outputTokens: 50,
  }),
};

describe('CoachService (legacy)', () => {
  let service: CoachService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        CoachService,
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();
    service = mod.get<CoachService>(CoachService);
  });

  describe('listConversations', () => {
    it('returns conversations for user', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      const result = await service.listConversations('u1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getConversation', () => {
    it('returns conversation when found', async () => {
      mockDb.query.coachConversations.findFirst.mockResolvedValue({ id: 'c1', userId: 'u1' });
      const result = await service.getConversation('u1', 'c1');
      expect(result.id).toBe('c1');
    });
  });

  describe('incrementDailyQuery', () => {
    it('upserts query count', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'q1', queryCount: 3 }]);
      const result = await service.incrementDailyQuery('u1');
      expect(result.queryCount).toBe(3);
    });
  });
});

describe('CoachChatService', () => {
  let chatService: CoachChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        CoachChatService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: CoachPromptService, useValue: mockPromptSvc },
        { provide: CoachCostService, useValue: mockCostSvc },
        { provide: GuardrailTripService, useValue: mockTripSvc },
        { provide: LlmCoachService, useValue: mockLlm },
      ],
    }).compile();
    chatService = mod.get<CoachChatService>(CoachChatService);
  });

  describe('chat', () => {
    it('creates new conversation and returns answer', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'c1', userId: 'u1' }]);

      const result = await chatService.chat('u1', { message: 'Hello' });

      expect(result.answer).toBe('Test answer');
      expect(result.conversationId).toBe('c1');
      expect(result.promptVersion).toBe('v1.0.0');
    });

    it('tracks cost when quota consumed', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'c1', userId: 'u1' }]);

      const result = await chatService.chat('u1', { message: 'Hello' });

      expect(result.costUsd).toBe(0.001);
      expect(result.tokensUsed).toBe(100);
      expect(mockCostSvc.record).toHaveBeenCalled();
    });
  });

  describe('getConversationRedacted', () => {
    it('returns redacted conversation for admin', async () => {
      mockDb.query.coachConversations.findFirst.mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        updatedAt: new Date(),
        messages: [
          { role: 'user', content: 'I earn 50000 per month and my card number is 4111111111111111' },
          { role: 'assistant', content: 'Thank you for sharing.' },
        ],
      });

      const result = await chatService.getConversationRedacted('c1');

      expect(result.messageCount).toBe(2);
      expect(result.messages[0].hasNumbers).toBe(true);
      expect(result.messages[0].preview).toContain('...');
    });
  });
});

describe('CoachPromptService', () => {
  let promptSvc: CoachPromptService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        CoachPromptService,
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();
    promptSvc = mod.get<CoachPromptService>(CoachPromptService);
  });

  describe('resolve', () => {
    it('returns fallback when no prompts in DB', async () => {
      mockDb.limit.mockResolvedValue([]); // active
      mockDb.limit.mockResolvedValue([]); // canary

      const result = await promptSvc.resolve('u1');

      expect(result.version).toBe('fallback');
      expect(result.isCanary).toBe(false);
    });
  });
});
