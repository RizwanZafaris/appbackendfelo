import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, desc, sql, gte, lte, inArray, count } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject } from '@nestjs/common';

import { tmsRules, tmsAlerts, tmsCases, tmsSanctions, remittanceTransactions, kycProfiles } from '@/common/db/schema/remittance.schema';
import { TmsRule, TmsAlert, TmsCase, TmsSanctionEntry, TmsRuleType, AlertStatus, CaseStatus, CasePriority } from './tms.types';
import { CreateRuleDto, ResolveAlertDto, CreateCaseDto, UpdateCaseDto } from './tms.dto';

@Injectable()
export class TmsService {
  private readonly logger = new Logger(TmsService.name);
  private caseCounter = 0;

  constructor(
    @Inject('DB') private readonly db: NodePgDatabase,
  ) {}

  // ─── Rule Management ────────────────────────────────────────────

  async createRule(dto: CreateRuleDto, createdBy?: string): Promise<TmsRule> {
    const [rule] = await this.db.insert(tmsRules).values({
      name: dto.name,
      type: dto.type,
      config: JSON.parse(dto.config),
      isActive: dto.isActive ?? true,
      priority: dto.priority ?? 0,
      createdBy,
    }).returning();
    return this.mapRule(rule);
  }

  async listRules(): Promise<TmsRule[]> {
    const rows = await this.db.select().from(tmsRules).orderBy(desc(tmsRules.priority));
    return rows.map(this.mapRule);
  }

  async getActiveRules(): Promise<TmsRule[]> {
    const rows = await this.db.select().from(tmsRules).where(eq(tmsRules.isActive, true)).orderBy(desc(tmsRules.priority));
    return rows.map(this.mapRule);
  }

  async updateRule(id: string, dto: Partial<CreateRuleDto>): Promise<TmsRule> {
    const updates: any = {};
    if (dto.name) updates.name = dto.name;
    if (dto.type) updates.type = dto.type;
    if (dto.config) updates.config = JSON.parse(dto.config);
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if (dto.priority !== undefined) updates.priority = dto.priority;
    updates.updatedAt = new Date();

    const [updated] = await this.db.update(tmsRules).set(updates).where(eq(tmsRules.id, id)).returning();
    if (!updated) throw new NotFoundException('Rule not found');
    return this.mapRule(updated);
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.delete(tmsRules).where(eq(tmsRules.id, id));
  }

  // ─── Transaction Evaluation ───────────────────────────────────

  async evaluateTransaction(transactionId: string, userId: string): Promise<{ alerts: TmsAlert[]; riskScore: number }> {
    const rules = await this.getActiveRules();
    const txRows = await this.db.select().from(remittanceTransactions).where(eq(remittanceTransactions.id, transactionId)).limit(1);
    const transaction = txRows[0];
    if (!transaction) throw new NotFoundException('Transaction not found');

    const alerts: TmsAlert[] = [];
    let totalRiskScore = 0;

    for (const rule of rules) {
      const triggered = await this.checkRule(rule, transaction, userId);
      if (triggered) {
        const riskScore = this.calculateRuleRisk(rule, transaction);
        totalRiskScore += riskScore;

        const [alert] = await this.db.insert(tmsAlerts).values({
          ruleId: rule.id,
          transactionId,
          userId,
          riskScore,
          status: 'open',
        }).returning();

        alerts.push(this.mapAlert(alert));
        this.logger.warn(`TMS Alert triggered: rule=${rule.name}, tx=${transactionId}, score=${riskScore}`);
      }
    }

    return { alerts, riskScore: Math.min(totalRiskScore, 100) };
  }

  private async checkRule(rule: TmsRule, tx: any, userId: string): Promise<boolean> {
    const cfg = rule.config as Record<string, any>;

    switch (rule.type as TmsRuleType) {
      case 'velocity':
        return this.checkVelocityRule(userId, cfg, tx);
      case 'threshold':
        return this.checkThresholdRule(tx, cfg);
      case 'pattern':
        return this.checkPatternRule(userId, cfg, tx);
      case 'geographic':
        return this.checkGeographicRule(tx, cfg);
      case 'new_user':
        return this.checkNewUserRule(userId, cfg, tx);
      case 'sanctions':
        return await this.checkSanctionsRule(tx, cfg);
      default:
        return false;
    }
  }

  private async checkVelocityRule(userId: string, cfg: any, tx: any): Promise<boolean> {
    const windowHours = cfg.timeWindowHours || 24;
    const maxAmount = cfg.maxAmountUsd || 5000;
    const maxCount = cfg.maxTransactionCount || 5;

    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const recentTx = await this.db.select().from(remittanceTransactions)
      .where(and(
        eq(remittanceTransactions.userId, userId),
        gte(remittanceTransactions.createdAt, since),
        eq(remittanceTransactions.status, 'completed'),
      ));

    const totalAmount = recentTx.reduce((sum, t) => sum + Number(t.amount), 0);
    return totalAmount > maxAmount || recentTx.length >= maxCount;
  }

  private checkThresholdRule(tx: any, cfg: any): boolean {
    const amount = Number(tx.amount);
    const threshold = cfg.amountUsd || 10000;
    const currency = cfg.currency;
    if (currency && tx.currency !== currency) return false;
    return amount > threshold;
  }

  private async checkPatternRule(userId: string, cfg: any, tx: any): Promise<boolean> {
    const smallThreshold = cfg.smallTransactionThreshold || 500;
    const countThreshold = cfg.countThreshold || 5;
    const windowDays = cfg.timeWindowDays || 7;

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const smallTx = await this.db.select().from(remittanceTransactions)
      .where(and(
        eq(remittanceTransactions.userId, userId),
        gte(remittanceTransactions.createdAt, since),
        lte(remittanceTransactions.amount, String(smallThreshold)),
      ));

    return smallTx.length >= countThreshold;
  }

  private checkGeographicRule(tx: any, cfg: any): boolean {
    const highRisk = cfg.highRiskCountries || [];
    return highRisk.includes(tx.currency) || highRisk.includes(tx.targetCurrency);
  }

  private async checkNewUserRule(userId: string, cfg: any, tx: any): Promise<boolean> {
    const maxAmount = cfg.maxAmountForNewUser || 2000;
    const ageDays = cfg.accountAgeDays || 30;

    const profile = await this.db.select().from(kycProfiles).where(eq(kycProfiles.userId, userId)).limit(1);
    if (!profile.length) return Number(tx.amount) > maxAmount;

    const accountAge = Date.now() - new Date(profile[0].createdAt).getTime();
    const ageInDays = accountAge / (24 * 60 * 60 * 1000);
    return ageInDays < ageDays && Number(tx.amount) > maxAmount;
  }

  private async checkSanctionsRule(tx: any, cfg: any): Promise<boolean> {
    const matchThreshold = cfg.matchThreshold || 0.8;
    const recipientName = tx.recipientName || '';
    const senderName = tx.metadata?.senderName || '';

    const sanctions = await this.db.select().from(tmsSanctions).where(eq(tmsSanctions.listType, 'ofac'));
    for (const entry of sanctions) {
      const names = [entry.entityName, ...(entry.aliases || [])];
      for (const name of names) {
        if (this.fuzzyMatch(recipientName, name) >= matchThreshold) return true;
        if (this.fuzzyMatch(senderName, name) >= matchThreshold) return true;
      }
    }
    return false;
  }

  private fuzzyMatch(a: string, b: string): number {
    if (!a || !b) return 0;
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === bLower) return 1;
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.9;
    // Simple word overlap
    const aWords = aLower.split(/\s+/);
    const bWords = bLower.split(/\s+/);
    const overlap = aWords.filter(w => bWords.includes(w)).length;
    return overlap / Math.max(aWords.length, bWords.length);
  }

  private calculateRuleRisk(rule: TmsRule, tx: any): number {
    const baseScore = { velocity: 30, threshold: 40, pattern: 50, geographic: 25, new_user: 20, sanctions: 100 };
    return baseScore[rule.type as TmsRuleType] || 20;
  }

  // ─── Alert Management ───────────────────────────────────────────

  async listAlerts(status?: AlertStatus, assignedTo?: string): Promise<TmsAlert[]> {
    let conditions: any[] = [];
    if (status) conditions.push(eq(tmsAlerts.status, status));
    if (assignedTo) conditions.push(eq(tmsAlerts.assignedTo, assignedTo));

    const rows = await this.db.select().from(tmsAlerts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tmsAlerts.createdAt));
    return rows.map(this.mapAlert);
  }

  async getAlert(id: string): Promise<TmsAlert | null> {
    const rows = await this.db.select().from(tmsAlerts).where(eq(tmsAlerts.id, id)).limit(1);
    return rows.length ? this.mapAlert(rows[0]) : null;
  }

  async resolveAlert(id: string, dto: ResolveAlertDto, assignedTo?: string): Promise<TmsAlert> {
    const alert = await this.getAlert(id);
    if (!alert) throw new NotFoundException('Alert not found');

    const [updated] = await this.db.update(tmsAlerts).set({
      status: dto.status as AlertStatus,
      notes: dto.notes,
      assignedTo: assignedTo || alert.assignedTo,
      resolvedAt: dto.status === 'confirmed' || dto.status === 'false_positive' ? new Date() : undefined,
    }).where(eq(tmsAlerts.id, id)).returning();

    return this.mapAlert(updated);
  }

  // ─── Case Management ────────────────────────────────────────────

  async createCase(dto: CreateCaseDto, createdBy?: string): Promise<TmsCase> {
    this.caseCounter++;
    const caseNumber = `CASE-${Date.now()}-${this.caseCounter}`;

    const [caseEntry] = await this.db.insert(tmsCases).values({
      caseNumber,
      status: 'open',
      priority: dto.priority as CasePriority,
      assignedTo: createdBy,
      notes: dto.notes,
      linkedAlertIds: dto.alertIds,
    }).returning();

    return this.mapCase(caseEntry);
  }

  async listCases(status?: CaseStatus): Promise<TmsCase[]> {
    let conditions: any[] = [];
    if (status) conditions.push(eq(tmsCases.status, status));

    const rows = await this.db.select().from(tmsCases)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tmsCases.createdAt));
    return rows.map(this.mapCase);
  }

  async getCase(id: string): Promise<TmsCase | null> {
    const rows = await this.db.select().from(tmsCases).where(eq(tmsCases.id, id)).limit(1);
    return rows.length ? this.mapCase(rows[0]) : null;
  }

  async updateCase(id: string, dto: UpdateCaseDto): Promise<TmsCase> {
    const updates: any = {};
    if (dto.status) updates.status = dto.status;
    if (dto.notes) updates.notes = dto.notes;
    if (dto.status === 'closed') updates.closedAt = new Date();
    updates.updatedAt = new Date();

    const [updated] = await this.db.update(tmsCases).set(updates).where(eq(tmsCases.id, id)).returning();
    if (!updated) throw new NotFoundException('Case not found');
    return this.mapCase(updated);
  }

  // ─── Sanctions List ───────────────────────────────────────────

  async addSanctionEntry(entry: Omit<TmsSanctionEntry, 'id' | 'lastUpdated'>): Promise<TmsSanctionEntry> {
    const [row] = await this.db.insert(tmsSanctions).values({
      name: entry.name,
      listType: entry.listType,
      entityName: entry.entityName,
      aliases: entry.aliases,
      program: entry.program,
      riskLevel: entry.riskLevel,
    }).returning();
    return this.mapSanction(row);
  }

  async listSanctions(listType?: string): Promise<TmsSanctionEntry[]> {
    let conditions: any[] = [];
    if (listType) conditions.push(eq(tmsSanctions.listType, listType));
    const rows = await this.db.select().from(tmsSanctions)
      .where(conditions.length ? and(...conditions) : undefined);
    return rows.map(this.mapSanction);
  }

  // ─── Mappers ────────────────────────────────────────────────────

  private mapRule(row: any): TmsRule {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      config: row.config,
      isActive: row.isActive,
      priority: row.priority,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapAlert(row: any): TmsAlert {
    return {
      id: row.id,
      ruleId: row.ruleId,
      transactionId: row.transactionId,
      userId: row.userId,
      riskScore: row.riskScore,
      status: row.status,
      assignedTo: row.assignedTo,
      notes: row.notes,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private mapCase(row: any): TmsCase {
    return {
      id: row.id,
      caseNumber: row.caseNumber,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assignedTo,
      notes: row.notes,
      linkedAlertIds: row.linkedAlertIds,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
    };
  }

  private mapSanction(row: any): TmsSanctionEntry {
    return {
      id: row.id,
      name: row.name,
      listType: row.listType,
      entityName: row.entityName,
      aliases: row.aliases,
      program: row.program,
      riskLevel: row.riskLevel,
      lastUpdated: row.lastUpdated,
    };
  }
}
