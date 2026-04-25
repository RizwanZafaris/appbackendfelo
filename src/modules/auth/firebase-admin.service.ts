import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as fs from 'node:fs';

/**
 * Lazily initializes Firebase Admin from either:
 *   - FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON string), or
 *   - FIREBASE_SERVICE_ACCOUNT_PATH (path to a JSON file).
 *
 * If neither is set we fall back to a stub that rejects token verification —
 * useful for local dev where you can mint test JWTs directly via /auth/dev-login
 * (only enabled in non-production).
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app?: admin.app.App;

  constructor(private readonly cfg: ConfigService) {}

  onModuleInit(): void {
    const json = this.cfg.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    const path = this.cfg.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

    let credential: admin.credential.Credential | undefined;
    if (json) {
      try {
        credential = admin.credential.cert(JSON.parse(json) as admin.ServiceAccount);
      } catch (err) {
        this.logger.error('FIREBASE_SERVICE_ACCOUNT_JSON failed to parse', err);
      }
    } else if (path && fs.existsSync(path)) {
      const content = fs.readFileSync(path, 'utf-8');
      credential = admin.credential.cert(JSON.parse(content) as admin.ServiceAccount);
    }

    if (credential) {
      this.app = admin.initializeApp({ credential }, 'felo');
      this.logger.log('Firebase Admin initialized');
    } else {
      this.logger.warn(
        'Firebase Admin not initialized — token verification will fail. ' +
          'Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.',
      );
    }
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    if (!this.app) {
      throw new Error('Firebase Admin not initialized');
    }
    return this.app.auth().verifyIdToken(idToken);
  }

  isInitialized(): boolean {
    return !!this.app;
  }
}
