import { Test, TestingModule } from '@nestjs/testing';

import { DRIZZLE } from '@/common/db/db.module';
import { CategorizationService } from './categorization.service';

describe('CategorizationService', () => {
  let service: CategorizationService;

  const mockCategories = [
    { id: 'cat-1', key: 'food_dining', labelEn: 'Food & Dining', labelUr: null, parentKey: null, sortOrder: 1, isActive: true, keywords: ['restaurant', 'cafe', 'food'], createdAt: new Date(), updatedAt: new Date() },
    { id: 'cat-2', key: 'groceries', labelEn: 'Groceries', labelUr: null, parentKey: 'food_dining', sortOrder: 1, isActive: true, keywords: ['grocery', 'supermarket', 'walmart'], createdAt: new Date(), updatedAt: new Date() },
    { id: 'cat-3', key: 'restaurants', labelEn: 'Restaurants', labelUr: null, parentKey: 'food_dining', sortOrder: 2, isActive: true, keywords: ['restaurant', 'mcdonalds', 'starbucks'], createdAt: new Date(), updatedAt: new Date() },
    { id: 'cat-4', key: 'transport', labelEn: 'Transportation', labelUr: null, parentKey: null, sortOrder: 3, isActive: true, keywords: ['gas', 'uber', 'transit'], createdAt: new Date(), updatedAt: new Date() },
    { id: 'cat-5', key: 'other', labelEn: 'Other', labelUr: null, parentKey: null, sortOrder: 99, isActive: true, keywords: [], createdAt: new Date(), updatedAt: new Date() },
  ];

  function buildDbStub() {
    return {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(async () => mockCategories.filter((c) => c.isActive)),
          })),
        })),
      })),
      query: {
        categories: {
          findFirst: jest.fn(async ({ where }: { where: { equals: string } }) =>
            mockCategories.find((c) => c.key === where.equals),
          ),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn((vals: Record<string, unknown>) => ({
          returning: jest.fn(async () => [{ id: 'new-cat', ...vals }]),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{ ...mockCategories[0], labelEn: 'Updated' }]),
          })),
        })),
      })),
    };
  }

  async function buildService(dbStub: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategorizationService, { provide: DRIZZLE, useValue: dbStub }],
    }).compile();
    return module.get(CategorizationService);
  }

  describe('getTaxonomyTree', () => {
    it('returns nested category tree', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const tree = await service.getTaxonomyTree();
      expect(Array.isArray(tree)).toBe(true);
      expect(tree.length).toBeGreaterThan(0);
      // food_dining should have children
      const foodNode = tree.find((n: { key: string }) => n.key === 'food_dining');
      expect(foodNode).toBeDefined();
      expect(foodNode?.children.length).toBe(2);
    });
  });

  describe('getCategory', () => {
    it('returns single category with children', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const cat = await service.getCategory('food_dining');
      expect(cat.key).toBe('food_dining');
      expect(cat.children.length).toBe(2);
    });

    it('throws for non-existent category', async () => {
      const db = buildDbStub();
      db.query.categories.findFirst = jest.fn(async () => null);
      service = await buildService(db);

      await expect(service.getCategory('nonexistent')).rejects.toThrow('Category not found');
    });
  });

  describe('suggest', () => {
    it('suggests food_dining for starbucks', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.suggest({ merchant: 'starbucks' });
      expect(result.suggestedKey).toBe('restaurants'); // starbucks is in restaurants keywords
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('suggests transport for uber', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.suggest({ description: 'Uber ride to airport' });
      expect(result.suggestedKey).toBe('transport');
    });

    it('returns other for empty query', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.suggest({});
      expect(result.suggestedKey).toBe('other');
      expect(result.confidence).toBe(0);
    });
  });

  describe('createCategory', () => {
    it('creates a new category', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.createCategory({
        key: 'new_cat',
        labelEn: 'New Category',
        parentKey: 'food_dining',
        sortOrder: 5,
        keywords: ['test'],
      });
      expect(result.key).toBe('new_cat');
    });
  });

  describe('updateCategory', () => {
    it('updates existing category', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.updateCategory('food_dining', { labelEn: 'Updated' });
      expect(result.labelEn).toBe('Updated');
    });
  });

  describe('deleteCategory', () => {
    it('soft-deletes a category', async () => {
      const db = buildDbStub();
      service = await buildService(db);

      const result = await service.deleteCategory('food_dining');
      expect(result.ok).toBe(true);
    });
  });
});
