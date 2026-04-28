/** The 11 refusal categories enforced by the Coach guardrail layer. */
export enum RefusalCategory {
  INVESTMENT_ADVICE = 'investment_advice',
  TAX_ADVICE = 'tax_advice',
  LEGAL_ADVICE = 'legal_advice',
  MEDICAL_ADVICE = 'medical_advice',
  UNGROUNDED_NUMBER = 'ungrounded_number',
  SHAMING_LANGUAGE = 'shaming_language',
  OFF_TOPIC = 'off_topic',
  PROMPT_INJECTION = 'prompt_injection',
  GUARANTEE_RETURNS = 'guarantee_returns',
  SYSTEM_LEAK = 'system_leak',
  PERSONAL_DATA_LEAK = 'personal_data_leak',
}

export interface GuardrailResult {
  triggered: boolean;
  category?: RefusalCategory;
  refusalText?: string;
}
