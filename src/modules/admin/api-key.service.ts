import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import * as crypto from 'crypto';

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  permissions: string[];
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  rateLimitPerMinute?: number;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private keys: Map<string, ApiKey> = new Map();

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async createKey(
    name: string,
    permissions: string[] = ['read'],
    expiresInDays?: number,
    rateLimitPerMinute?: number,
  ): Promise<{ apiKey: string; keyId: string }> {
    const id = crypto.randomUUID();
    const rawKey = `felo_${crypto.randomBytes(32).toString('base64url')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    const key: ApiKey = {
      id,
      name,
      keyHash,
      keyPrefix,
      permissions,
      createdAt: new Date(),
      expiresAt: expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : undefined,
      rateLimitPerMinute,
    };

    this.keys.set(id, key);
    this.logger.log(`API key created: ${name} (${keyPrefix}...)`);

    return { apiKey: rawKey, keyId: id };
  }

  async validateKey(key: string): Promise<ApiKey | null> {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    for (const apiKey of this.keys.values()) {
      if (apiKey.keyHash === keyHash) {
        if (apiKey.revokedAt) {
          this.logger.warn(`Revoked API key used: ${apiKey.keyPrefix}...`);
          return null;
        }
        
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
          this.logger.warn(`Expired API key used: ${apiKey.keyPrefix}...`);
          return null;
        }

        apiKey.lastUsedAt = new Date();
        return apiKey;
      }
    }

    return null;
  }

  async revokeKey(keyId: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key) return false;

    key.revokedAt = new Date();
    this.logger.log(`API key revoked: ${key.name} (${key.keyPrefix}...)`);
    return true;
  }

  async listKeys(): Promise<Omit<ApiKey, 'keyHash'>[]> {
    return Array.from(this.keys.values())
      .filter(k => !k.revokedAt)
      .map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        permissions: k.permissions,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        rateLimitPerMinute: k.rateLimitPerMinute,
      }));
  }

  async getKeyUsage(keyId: string): Promise<{
    keyId: string;
    name: string;
    createdAt: Date;
    lastUsedAt?: Date;
    totalCalls?: number;
  }> {
    const key = this.keys.get(keyId);
    if (!key) throw new UnauthorizedException('Key not found');

    return {
      keyId: key.id,
      name: key.name,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    };
  }
}
