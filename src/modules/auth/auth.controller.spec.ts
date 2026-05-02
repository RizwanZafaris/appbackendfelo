import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { testUser } from '../../../test/setup';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('me', () => {
    it('should echo back the authenticated user identity', () => {
      const result = controller.me(testUser);
      expect(result).toEqual(testUser);
    });

    it('should return the user with id, firebaseUid and email', () => {
      const result = controller.me(testUser);
      expect(result.id).toBe(testUser.id);
      expect(result.firebaseUid).toBe(testUser.firebaseUid);
      expect(result.email).toBe(testUser.email);
    });
  });
});
