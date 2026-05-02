export type TmsRuleType = 'velocity' | 'threshold' | 'pattern' | 'geographic' | 'new_user' | 'sanctions';
export type AlertStatus = 'open' | 'under_review' | 'confirmed' | 'false_positive';
export type CaseStatus = 'open' | 'in_progress' | 'closed';
export type CasePriority = 'low' | 'medium' | 'high' | 'critical';

export interface TmsRule {
  id: string;
  name: string;
  type: TmsRuleType;
  config: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TmsAlert {
  id: string;
  ruleId: string;
  transactionId?: string;
  userId: string;
  riskScore: number;
  status: AlertStatus;
  assignedTo?: string;
  notes?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface TmsCase {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo?: string;
  notes?: string;
  linkedAlertIds: string[];
  createdAt: Date;
  closedAt?: Date;
}

export interface TmsSanctionEntry {
  id: string;
  name: string;
  listType: 'ofac' | 'un' | 'eu' | 'hmt';
  entityName: string;
  aliases?: string[];
  program?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastUpdated: Date;
}

export interface RuleConfig {
  // velocity
  timeWindowHours?: number;
  maxAmountUsd?: number;
  maxTransactionCount?: number;
  // threshold
  amountUsd?: number;
  currency?: string;
  // pattern
  smallTransactionThreshold?: number;
  countThreshold?: number;
  timeWindowDays?: number;
  // geographic
  highRiskCountries?: string[];
  // new_user
  maxAmountForNewUser?: number;
  accountAgeDays?: number;
  // sanctions
  matchThreshold?: number;
}
