import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequestUser } from '@/common/types/request-user';

import {
  CreateCategoryDto,
  SuggestCategoryDto,
  UpdateCategoryDto,
} from './dto/categorization.dto';
import { CategorizationService } from './categorization.service';

@ApiTags('categorization')
@ApiBearerAuth()
@Controller()
export class CategorizationController {
  constructor(private readonly svc: CategorizationService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Get full category taxonomy tree' })
  getTree() {
    return this.svc.getTaxonomyTree();
  }

  @Get('categories/:key')
  @ApiOperation({ summary: 'Get a single category with children' })
  getCategory(@Param('key') key: string) {
    return this.svc.getCategory(key);
  }

  @Post('categorization/suggest')
  @ApiOperation({ summary: 'Suggest category for merchant/description' })
  suggest(@Body() dto: SuggestCategoryDto) {
    return this.svc.suggest(dto);
  }

  // Admin CRUD endpoints
  @Post('admin/categories')
  @ApiOperation({ summary: '[Admin] Create category' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.svc.createCategory(dto);
  }

  @Patch('admin/categories/:key')
  @ApiOperation({ summary: '[Admin] Update category' })
  updateCategory(@Param('key') key: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(key, dto);
  }

  @Delete('admin/categories/:key')
  @ApiOperation({ summary: '[Admin] Soft-delete category' })
  deleteCategory(@Param('key') key: string) {
    return this.svc.deleteCategory(key);
  }
}
