import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { mockExecutionContext, testUser } from '../../../test/setup';

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

  describe('CurrentUser decorator', () => {
    it('should extract user from request context', () => {
      const ctx = mockExecutionContext();
      const decoratorFn = CurrentUser();
      const result = decoratorFn(undefined, ctx as ExecutionContext);
      expect(result).toEqual(testUser);
    });

    it('should return undefined when no user is on the request', () => {
      const ctx = mockExecutionContext({ user: undefined });
      const decoratorFn = CurrentUser();
      const result = decoratorFn(undefined, ctx as ExecutionContext);
      expect(result).toBeUndefined();
    });
  });
});
