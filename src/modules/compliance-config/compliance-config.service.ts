import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject } from '@nestjs/common';

import { complianceConfig } from '@/common/db/schema/remittance.schema';
import { ComplianceConfigSection } from './compliance-config.types';

@Injectable()
export class ComplianceConfigService {
  private readonly logger = new Logger(ComplianceConfigService.name);

  constructor(
    @Inject('DB') private readonly db: NodePgDatabase,
  ) {}

  async getConfig(section?: string): Promise<Record<string, any>> {
    let rows: any[];
    if (section) {
      rows = await this.db.select().from(complianceConfig).where(eq(complianceConfig.section, section));
    } else {
      rows = await this.db.select().from(complianceConfig);
    }

    const result: Record<string, any> = {};
    for (const row of rows) {
      result[row.section] = row.config;
    }
    return result;
  }

  async updateConfig(section: string, config: Record<string, unknown>, updatedBy?: string): Promise<void> {
    const existing = await this.db.select().from(complianceConfig).where(eq(complianceConfig.section, section)).limit(1);

    if (existing.length > 0) {
      await this.db.update(complianceConfig).set({
        config,
        updatedBy,
        updatedAt: new Date(),
      }).where(eq(complianceConfig.section, section));
    } else {
      await this.db.insert(complianceConfig).values({
        section,
        config,
        updatedBy,
      });
    }
  }

  async getOrInitDefaultConfig(): Promise<Record<string, any>> {
    const existing = await this.getConfig();
    if (Object.keys(existing).length === 0) {
      await this.seedDefaults();
      return this.getConfig();
    }
    return existing;
  }

  private async seedDefaults(): Promise<void> {
    const defaults = {
      kyc: {
        requiredDocuments: {
          PK: ['passport', 'id_card', 'proof_of_address'],
          BD: ['passport', 'id_card', 'proof_of_address'],
          NP: ['passport', 'proof_of_address'],
          DEFAULT: ['passport', 'selfie'],
        },
        autoApproveThreshold: 0,
        reviewTimeoutHours: 72,
      },
      kyb: {
        uboThresholdPercentage: 25,
        requiredBusinessDocs: ['trade_license', 'articles_of_incorporation', 'bank_statement'],
      },
      tms: {
        defaultRiskWeights: {
          velocity: 30,
          threshold: 40,
          pattern: 50,
          geographic: 25,
          new_user: 20,
          sanctions: 100,
        },
        alertAutoAssign: false,
        caseAutoCreate: false,
      },
    };

    for (const [section, config] of Object.entries(defaults)) {
      await this.updateConfig(section, config as Record<string, unknown>, 'system');
    }
  }
}
