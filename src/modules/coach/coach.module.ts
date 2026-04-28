import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { InsightsModule } from '@/modules/insights/insights.module';

import { CoachRulesService } from './coach-rules.service';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { CoachQuotaService } from './llm/coach-quota.service';
import { GuardrailsService } from './llm/guardrails/guardrails.service';
import { LlmCoachService } from './llm/llm-coach.service';
import { AnthropicProvider } from './llm/providers/anthropic.provider';
import { GeminiProvider } from './llm/providers/gemini.provider';
import { DeepSeekProvider, OpenAiProvider } from './llm/providers/openai.provider';
import { ProviderRegistry } from './llm/providers/registry';
import { RetrievalService } from './llm/retrieval/retrieval.service';

@Module({
  imports: [InsightsModule, ConfigModule],
  controllers: [CoachController],
  providers: [
    CoachService,
    CoachRulesService,
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
})
export class CoachModule {}
