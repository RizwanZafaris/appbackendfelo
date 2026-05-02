export interface ComplianceConfigSection {
  id: string;
  section: 'kyc' | 'kyb' | 'tms';
  config: Record<string, unknown>;
  updatedBy?: string;
  updatedAt: Date;
}

export interface KycConfig {
  requiredDocuments: Record<string, string[]>;
  autoApproveThreshold: number;
  reviewTimeoutHours: number;
}

export interface KybConfig {
  uboThresholdPercentage: number;
  requiredBusinessDocs: string[];
}

export interface TmsConfig {
  defaultRiskWeights: Record<string, number>;
  alertAutoAssign: boolean;
  caseAutoCreate: boolean;
}
