import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceProviders } from '@db/schema';

@Injectable()
export class RemittanceProvidersService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get catalog of active remittance providers, sorted by rank. */
  async getCatalog() {
    return this.db
      .select()
      .from(remittanceProviders)
      .where(eq(remittanceProviders.isActive, true))
      .orderBy(asc(remittanceProviders.rank));
  }

  /** Get single provider by code. */
  async getByCode(code: string) {
    return this.db.query.remittanceProviders.findFirst({
      where: and(eq(remittanceProviders.code, code), eq(remittanceProviders.isActive, true)),
    });
  }
}
