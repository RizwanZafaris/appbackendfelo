import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { users } from '@db/schema';

import { FirebaseAdminService } from './firebase-admin.service';
import { ExchangeRequestDto, ExchangeResponseDto } from './dto/exchange.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  /**
   * Exchange a Firebase ID token for a Felo backend JWT pair.
   * Creates the felo users row on first sight (just-in-time provisioning).
   */
  async exchange(input: ExchangeRequestDto): Promise<ExchangeResponseDto> {
    const decoded = await this.firebase.verifyIdToken(input.firebaseIdToken).catch(() => {
      throw new UnauthorizedException('Invalid Firebase ID token');
    });

    const email = decoded.email;
    if (!email) {
      throw new UnauthorizedException('Firebase token has no email claim');
    }

    // Upsert by firebase_uid.
    let row = await this.db.query.users.findFirst({
      where: eq(users.firebaseUid, decoded.uid),
    });

    if (!row) {
      const inserted = await this.db
        .insert(users)
        .values({
          firebaseUid: decoded.uid,
          email,
          displayName: decoded.name ?? null,
          phoneE164: decoded.phone_number ?? null,
          corridor: input.corridor ?? 'other',
          languageCode: input.languageCode ?? 'en',
        })
        .returning();
      row = inserted[0];
    }

    const accessToken = await this.jwt.signAsync(
      { sub: row.id, fbUid: row.firebaseUid, email: row.email },
      {
        secret: this.cfg.get<string>('JWT_SECRET'),
        expiresIn: this.cfg.get<string>('JWT_ACCESS_TTL', '15m'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: row.id, type: 'refresh' },
      {
        secret: this.cfg.get<string>('JWT_SECRET'),
        expiresIn: this.cfg.get<string>('JWT_REFRESH_TTL', '30d'),
      },
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        corridor: row.corridor,
        languageCode: row.languageCode,
        kycStatus: row.kycStatus,
      },
    };
  }
}
