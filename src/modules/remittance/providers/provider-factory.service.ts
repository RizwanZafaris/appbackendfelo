import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceProviders, remittanceRoutes } from '@/common/db/schema/remittance.schema';
import {
  PayoutProvider,
  PaymobProvider,
  SamsaraProvider,
  KhaltiProvider,
  SafepayRaastProvider,
  EightBProvider,
  HrcUblProvider,
  HabibMetroProvider,
  Digit9Provider,
  MtbProvider,
  AgraniBankProvider,
  BracBankProvider,
  PrimeBankProvider,
  StandardBankProvider,
  UcbProvider,
  DhakaBankProvider,
  AblProvider,
  FaysalBankProvider,
  ProviderConfig,
} from './payout.providers';

export interface PayoutRoute {
  id: string;
  name: string;
  corridor: string;
  sourceCurrency: string;
  targetCurrency: string;
  providerId: string;
  providerName: string;
  payoutMethod: string;
  feeBps: number;
  fxMarkupBps: number;
  minAmount: number;
  maxAmount: number;
  estimatedMinutes: number;
  enabled: boolean;
}

@Injectable()
export class PayoutProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(PayoutProviderFactory.name);
  private providers = new Map<string, PayoutProvider>();
  private configs = new Map<string, ProviderConfig>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly paymob: PaymobProvider,
    private readonly samsara: SamsaraProvider,
    private readonly khalti: KhaltiProvider,
    private readonly safepay: SafepayRaastProvider,
    private readonly eightB: EightBProvider,
    private readonly hrcUbl: HrcUblProvider,
    private readonly habibMetro: HabibMetroProvider,
    private readonly digit9: Digit9Provider,
    private readonly mtb: MtbProvider,
    private readonly agraniBank: AgraniBankProvider,
    private readonly bracBank: BracBankProvider,
    private readonly primeBank: PrimeBankProvider,
    private readonly standardBank: StandardBankProvider,
    private readonly ucb: UcbProvider,
    private readonly dhakaBank: DhakaBankProvider,
    private readonly abl: AblProvider,
    private readonly faysalBank: FaysalBankProvider,
  ) {}

  async onModuleInit() {
    await this.reloadProviders();
  }

  async reloadProviders() {
    const rows = await this.db.select().from(remittanceProviders);
    this.providers.clear();
    this.configs.clear();

    for (const row of rows) {
      if (!row.enabled) continue;
      
      const config: ProviderConfig = {
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        baseUrl: row.baseUrl,
        authType: row.authType as any,
        credentials: row.credentials as Record<string, string>,
        supportedCorridors: row.supportedCorridors as string[],
        supportedCurrencies: row.supportedCurrencies as string[],
        payoutMethods: row.payoutMethods as string[],
        rateLimitPerMin: row.rateLimitPerMin,
      };

      const provider = this.createProvider(row.providerCode);
      if (provider) {
        try {
          await provider.initialize(config);
          this.providers.set(row.id, provider);
          this.configs.set(row.id, config);
          this.logger.log(`Loaded provider: ${row.name} (${row.providerCode})`);
        } catch (err) {
          this.logger.error(`Failed to initialize provider ${row.name}: ${err.message}`);
        }
      }
    }
  }

  private createProvider(code: string): PayoutProvider | null {
    switch (code) {
      case 'paymob': return this.paymob;
      case 'samsara': return this.samsara;
      case 'khalti': return this.khalti;
      case 'safepay_raast': return this.safepay;
      case '8b': return this.eightB;
      case 'hrc_ubl': return this.hrcUbl;
      case 'habib_metro': return this.habibMetro;
      case 'digit9': return this.digit9;
      case 'mtb': return this.mtb;
      case 'agrani_bank': return this.agraniBank;
      case 'brac_bank': return this.bracBank;
      case 'prime_bank': return this.primeBank;
      case 'standard_bank': return this.standardBank;
      case 'ucb': return this.ucb;
      case 'dhaka_bank': return this.dhakaBank;
      case 'abl': return this.abl;
      case 'faysal_bank': return this.faysalBank;
      default: return null;
    }
  }

  getProvider(providerId: string): PayoutProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): Map<string, PayoutProvider> {
    return this.providers;
  }

  getAllConfigs(): Map<string, ProviderConfig> {
    return this.configs;
  }

  async getRoutesForCorridor(corridor: string): Promise<PayoutRoute[]> {
    const routes = await this.db
      .select()
      .from(remittanceRoutes)
      .where(eq(remittanceRoutes.corridor, corridor));

    return routes
      .filter(r => r.enabled)
      .map(r => ({
        id: r.id,
        name: r.name,
        corridor: r.corridor,
        sourceCurrency: r.sourceCurrency,
        targetCurrency: r.targetCurrency,
        providerId: r.providerId,
        providerName: this.configs.get(r.providerId)?.name || 'Unknown',
        payoutMethod: r.payoutMethod,
        feeBps: r.feeBps,
        fxMarkupBps: r.fxMarkupBps,
        minAmount: parseFloat(r.minAmount as string),
        maxAmount: parseFloat(r.maxAmount as string),
        estimatedMinutes: r.estimatedMinutes,
        enabled: r.enabled,
      }));
  }
}
