import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuditLogModule } from '@/modules/audit-log/audit-log.module';
import { InsightsModule } from '@/modules/insights/insights.module';

import { CoachAdminController } from './coach-admin.controller';
import { CoachChatController } from './coach-chat.controller';
import { CoachChatService } from './coach-chat.service';
import { CoachCostService } from './coach-cost.service';
import { CoachPromptService } from './coach-prompt.service';
import { CoachRulesService } from './coach-rules.service';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { GuardrailTripService } from './guardrail-trip.service';
import { CoachQuotaService } from './llm/coach-quota.service';
import { GuardrailsService } from './llm/guardrails/guardrails.service';
import { LlmCoachService } from './llm/llm-coach.service';
import { AnthropicProvider } from './llm/providers/anthropic.provider';
import { GeminiProvider } from './llm/providers/gemini.provider';
import { DeepSeekProvider, OpenAiProvider } from './llm/providers/openai.provider';
import { ProviderRegistry } from './llm/providers/registry';
import { RetrievalService } from './llm/retrieval/retrieval.service';

@Module({
  imports: [InsightsModule, ConfigModule, AuditLogModule],
  controllers: [CoachController, CoachChatController, CoachAdminController],
  providers: [
    CoachService,
    CoachRulesService,
    // New enhanced layer
    CoachChatService,
    CoachPromptService,
    CoachCostService,
    GuardrailTripService,
    // LLM layer
    LlmCoachService,
    GuardrailsService,
    RetrievalService,
    CoachQuotaService,
    AnthropicProvider,
    OpenAiProvider,
    DeepSeekProvider,
    GeminiProvider,
    ProviderRegistry,
  ],
  exports: [CoachService, CoachChatService],
})
export class CoachModule {}
