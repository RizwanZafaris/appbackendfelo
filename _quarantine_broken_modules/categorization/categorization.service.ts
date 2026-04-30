import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { categories } from '@db/schema';

import { CreateCategoryDto, SuggestCategoryDto, UpdateCategoryDto } from './dto/categorization.dto';

@Injectable()
export class CategorizationService {
  private readonly logger = new Logger(CategorizationService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get full taxonomy tree as nested structure. */
  async getTaxonomyTree(): Promise<Array<CategoryNode>> {
    const all = await this.db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder));

    const rootNodes: CategoryNode[] = [];
    const nodeMap = new Map<string, CategoryNode>();

    // First pass: create all nodes
    for (const cat of all) {
      const node: CategoryNode = {
        key: cat.key,
        labelEn: cat.labelEn,
        labelUr: cat.labelUr,
        sortOrder: cat.sortOrder,
        children: [],
      };
      nodeMap.set(cat.key, node);
    }

    // Second pass: build tree
    for (const cat of all) {
      const node = nodeMap.get(cat.key)!;
      if (cat.parentKey && nodeMap.has(cat.parentKey)) {
        nodeMap.get(cat.parentKey)!.children.push(node);
      } else if (!cat.parentKey) {
        rootNodes.push(node);
      }
    }

    return rootNodes;
  }

  /** Get a single category by key, with children. */
  async getCategory(key: string) {
    const cat = await this.db.query.categories.findFirst({
      where: eq(categories.key, key),
    });
    if (!cat) throw new NotFoundException('Category not found');

    const children = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.parentKey, key), eq(categories.isActive, true)))
      .orderBy(asc(categories.sortOrder));

    return { ...cat, children };
  }

  /** Suggest category for merchant/description using keyword matching. */
  async suggest(dto: SuggestCategoryDto) {
    const query = dto.merchant ?? dto.description ?? '';
    if (!query.trim()) {
      return { suggestedKey: 'other', confidence: 0, alternatives: [] };
    }

    const allCategories = await this.db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true));

    const queryLower = query.toLowerCase();
    const scores: Array<{ key: string; label: string; score: number }> = [];

    for (const cat of allCategories) {
      let score = 0;

      // Keyword matching
      const keywords = (cat.keywords ?? []) as string[];
      for (const kw of keywords) {
        if (queryLower.includes(kw.toLowerCase())) {
          score += 0.3; // keyword match bonus
        }
      }

      // Label matching
      if (queryLower.includes(cat.labelEn.toLowerCase())) {
        score += 0.4;
      }

      // Parent label matching (if child category)
      if (cat.parentKey) {
        const parent = allCategories.find((c) => c.key === cat.parentKey);
        if (parent && queryLower.includes(parent.labelEn.toLowerCase())) {
          score += 0.15;
        }
      }

      if (score > 0) {
        scores.push({ key: cat.key, label: cat.labelEn, score: Math.min(score, 0.95) });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    const top = scores[0];
    return {
      suggestedKey: top?.key ?? 'other',
      confidence: top?.score ?? 0,
      alternatives: scores.slice(1, 4).map((s) => ({ key: s.key, label: s.label, score: s.score })),
    };
  }

  /** Admin: create a new category. */
  async createCategory(dto: CreateCategoryDto) {
    const inserted = await this.db
      .insert(categories)
      .values({
        key: dto.key,
        labelEn: dto.labelEn,
        labelUr: dto.labelUr ?? null,
        parentKey: dto.parentKey ?? null,
        sortOrder: dto.sortOrder ?? 0,
        keywords: dto.keywords ?? [],
      })
      .returning();
    return inserted[0];
  }

  /** Admin: update a category. */
  async updateCategory(key: string, dto: UpdateCategoryDto) {
    const updated = await this.db
      .update(categories)
      .set({
        labelEn: dto.labelEn,
        labelUr: dto.labelUr,
        parentKey: dto.parentKey,
        sortOrder: dto.sortOrder,
        keywords: dto.keywords,
        isActive: dto.isActive,
        updatedAt: new Date(),
      })
      .where(eq(categories.key, key))
      .returning();
    if (!updated[0]) throw new NotFoundException('Category not found');
    return updated[0];
  }

  /** Admin: soft-delete a category. */
  async deleteCategory(key: string) {
    const updated = await this.db
      .update(categories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(categories.key, key))
      .returning();
    if (!updated[0]) throw new NotFoundException('Category not found');
    return { ok: true };
  }
}

interface CategoryNode {
  key: string;
  labelEn: string;
  labelUr: string | null;
  sortOrder: number;
  children: CategoryNode[];
}
