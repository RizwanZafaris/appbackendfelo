import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseJwtGuard } from '@/common/guards/supabase-jwt.guard';
import { Inject } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceProviders, remittanceRoutes, remittanceTransactions } from '@/common/db/schema/remittance.schema';
import { PayoutProviderFactory } from './providers/provider-factory.service';

@ApiTags('admin-remittance')
@Controller('admin/remittance')
@UseGuards(SupabaseJwtGuard)
export class RemittanceAdminController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly factory: PayoutProviderFactory,
  ) {}

  // ===== PROVIDERS =====

  @Get('providers')
  @ApiOperation({ summary: 'List all remittance providers' })
  async listProviders() {
    return this.db.select().from(remittanceProviders).orderBy(remittanceProviders.name);
  }

  @Post('providers')
  @ApiOperation({ summary: 'Create a new remittance provider' })
  async createProvider(@Body() body: {
    name: string;
    providerCode: string;
    baseUrl: string;
    authType: string;
    credentials: Record<string, string>;
    supportedCorridors: string[];
    supportedCurrencies: string[];
    payoutMethods: string[];
    rateLimitPerMin?: number;
    ipWhitelist?: string[];
    enabled?: boolean;
  }) {
    const [provider] = await this.db
      .insert(remittanceProviders)
      .values({
        name: body.name,
        providerCode: body.providerCode,
        baseUrl: body.baseUrl,
        authType: body.authType,
        credentials: body.credentials,
        supportedCorridors: body.supportedCorridors,
        supportedCurrencies: body.supportedCurrencies,
        payoutMethods: body.payoutMethods,
        rateLimitPerMin: body.rateLimitPerMin || 60,
        ipWhitelist: body.ipWhitelist || [],
        enabled: body.enabled ?? true,
      })
      .returning();

    await this.factory.reloadProviders();
    return provider;
  }

  @Get('providers/:id')
  @ApiOperation({ summary: 'Get provider details' })
  async getProvider(@Param('id') id: string) {
    const [provider] = await this.db
      .select()
      .from(remittanceProviders)
      .where(eq(remittanceProviders.id, id));
    return provider;
  }

  @Put('providers/:id')
  @ApiOperation({ summary: 'Update provider' })
  async updateProvider(@Param('id') id: string, @Body() body: any) {
    const [provider] = await this.db
      .update(remittanceProviders)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(remittanceProviders.id, id))
      .returning();

    await this.factory.reloadProviders();
    return provider;
  }

  @Delete('providers/:id')
  @ApiOperation({ summary: 'Delete provider' })
  async deleteProvider(@Param('id') id: string) {
    await this.db.delete(remittanceProviders).where(eq(remittanceProviders.id, id));
    await this.factory.reloadProviders();
    return { deleted: true };
  }

  @Post('providers/:id/validate')
  @ApiOperation({ summary: 'Validate provider credentials' })
  async validateProvider(@Param('id') id: string) {
    const provider = this.factory.getProvider(id);
    if (!provider) {
      return { valid: false, message: 'Provider not loaded' };
    }
    const valid = await provider.validateCredentials();
    return { valid, message: valid ? 'Credentials valid' : 'Credentials invalid' };
  }

  // ===== ROUTES =====

  @Get('routes')
  @ApiOperation({ summary: 'List all remittance routes' })
  async listRoutes() {
    const rows = await this.db
      .select({
        route: remittanceRoutes,
        provider: {
          id: remittanceProviders.id,
          name: remittanceProviders.name,
          providerCode: remittanceProviders.providerCode,
        },
      })
      .from(remittanceRoutes)
      .leftJoin(remittanceProviders, eq(remittanceRoutes.providerId, remittanceProviders.id))
      .orderBy(remittanceRoutes.corridor);

    return rows.map(r => ({
      ...r.route,
      providerName: r.provider?.name,
      providerCode: r.provider?.providerCode,
    }));
  }

  @Post('routes')
  @ApiOperation({ summary: 'Create a new remittance route' })
  async createRoute(@Body() body: {
    name: string;
    corridor: string;
    sourceCurrency: string;
    targetCurrency: string;
    providerId: string;
    payoutMethod: string;
    feeBps?: number;
    fxMarkupBps?: number;
    minAmount?: number;
    maxAmount?: number;
    estimatedMinutes?: number;
    priority?: number;
    enabled?: boolean;
  }) {
    const [route] = await this.db
      .insert(remittanceRoutes)
      .values({
        name: body.name,
        corridor: body.corridor,
        sourceCurrency: body.sourceCurrency,
        targetCurrency: body.targetCurrency,
        providerId: body.providerId,
        payoutMethod: body.payoutMethod,
        feeBps: body.feeBps || 50,
        fxMarkupBps: body.fxMarkupBps || 100,
        minAmount: body.minAmount?.toString() || '10',
        maxAmount: body.maxAmount?.toString() || '10000',
        estimatedMinutes: body.estimatedMinutes || 30,
        priority: body.priority || 0,
        enabled: body.enabled ?? true,
      })
      .returning();

    return route;
  }

  @Get('routes/:id')
  @ApiOperation({ summary: 'Get route details' })
  async getRoute(@Param('id') id: string) {
    const [route] = await this.db
      .select()
      .from(remittanceRoutes)
      .where(eq(remittanceRoutes.id, id));
    return route;
  }

  @Put('routes/:id')
  @ApiOperation({ summary: 'Update route' })
  async updateRoute(@Param('id') id: string, @Body() body: any) {
    const [route] = await this.db
      .update(remittanceRoutes)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(remittanceRoutes.id, id))
      .returning();
    return route;
  }

  @Delete('routes/:id')
  @ApiOperation({ summary: 'Delete route' })
  async deleteRoute(@Param('id') id: string) {
    await this.db.delete(remittanceRoutes).where(eq(remittanceRoutes.id, id));
    return { deleted: true };
  }

  // ===== TRANSACTIONS =====

  @Get('transactions')
  @ApiOperation({ summary: 'List all remittance transactions' })
  async listTransactions(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('status') status?: string,
  ) {
    const offset = (page - 1) * limit;
    
    let query = this.db.select().from(remittanceTransactions).orderBy(desc(remittanceTransactions.createdAt));
    if (status) {
      // Apply status filter
    }
    
    const rows = await query.limit(limit).offset(offset);
    return rows;
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get transaction details' })
  async getTransaction(@Param('id') id: string) {
    const [tx] = await this.db
      .select()
      .from(remittanceTransactions)
      .where(eq(remittanceTransactions.id, id));
    return tx;
  }
}
