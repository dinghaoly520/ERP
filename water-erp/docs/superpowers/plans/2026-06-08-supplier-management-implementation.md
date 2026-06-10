# 供应商管理模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现供应商管理模块，包括供应商注册、供应商库管理、信息变更、供应商评价功能。

**Architecture:** 采用 NestJS 模块化架构，后端创建 SupplierModule 和 NotificationModule，前端在 Next.js App Router 下创建 supplier 相关页面。数据模型使用 Prisma 管理，权限使用 Guard 实现。

**Tech Stack:** NestJS + Prisma + PostgreSQL (后端), Next.js 16 + React 19 + Tailwind CSS (前端)

---

## 文件结构

### 后端新增文件
```
apps/api/src/
├── supplier/
│   ├── supplier.module.ts
│   ├── supplier.controller.ts
│   ├── supplier.service.ts
│   ├── supplier.guard.ts           # 供应商权限守卫
│   ├── procurement.guard.ts        # 采购中心权限守卫
│   ├── owner.guard.ts              # 数据所有权守卫
│   └── dto/
│       ├── register-supplier.dto.ts
│       ├── create-contact.dto.ts
│       ├── create-qualification.dto.ts
│       ├── update-supplier-status.dto.ts
│       ├── create-evaluation.dto.ts
│       ├── create-change-request.dto.ts
│       ├── approve-change.dto.ts
│       └── create-classification.dto.ts
├── notification/
│   ├── notification.module.ts
│   ├── notification.controller.ts
│   ├── notification.service.ts
│   └── dto/
│       └── create-notification.dto.ts
```

### 后端修改文件
```
apps/api/
├── prisma/schema.prisma            # 新增供应商相关数据模型
├── src/app.module.ts               # 导入新模块
├── src/auth/dto/register.dto.ts    # 添加 role 字段
```

### 前端新增文件
```
apps/web/src/
├── app/(dashboard)/supplier/
│   ├── page.tsx                    # 供应商库列表
│   ├── register/page.tsx           # 供应商注册
│   ├── audit/page.tsx              # 注册审核
│   ├── [id]/
│   │   ├── page.tsx               # 供应商详情
│   │   ├── edit/page.tsx          # 信息变更
│   │   ├── qualifications/page.tsx
│   │   ├── evaluations/page.tsx
│   │   └── changes/page.tsx
│   ├── classifications/page.tsx   # 分类管理
│   └── stats/page.tsx             # 统计页面
├── lib/
│   ├── api/
│   │   └── supplier.ts            # 供应商API
│   ├── types/
│   │   └── supplier.ts            # 供应商类型定义
├── components/supplier/
│   ├── supplier-list.tsx          # 供应商列表组件
│   ├── supplier-form.tsx          # 注册表单组件
│   ├── supplier-detail-tabs.tsx   # 详情页Tab组件
│   ├── qualification-upload.tsx   # 资质上传组件
│   ├── evaluation-form.tsx        # 评价表单组件
│   └── change-request-form.tsx    # 变更申请表单
```

### 前端修改文件
```
apps/web/src/
├── components/app-shell.tsx        # 添加供应商导航项
├── lib/types.ts                   # 添加供应商类型
```

---

## Task 1: 数据模型 - Prisma Schema 扩展

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 在 schema.prisma 末尾添加供应商相关枚举和模型**

```prisma
// ── 供应商管理 ──

enum SupplierStatus {
  PENDING      // 待审核
  RETURNED     // 退回补正
  APPROVED     // 审核通过/已入库
  REJECTED     // 审核不通过
  DISABLED     // 停用
  BLACKLIST    // 黑名单
}

enum ChangeStatus {
  PENDING   // 待审核
  APPROVED  // 已通过
  REJECTED  // 已拒绝
}

model Supplier {
  id                 String            @id @default(cuid())
  userId             String            @unique
  name               String
  normalizedName     String            @unique
  creditCode         String            @unique
  enterpriseType     String
  legalPerson        String
  registeredAddress  String
  businessScope      String
  status             SupplierStatus    @default(PENDING)
  classificationId   String?
  rejectReason       String?
  returnReason       String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  classification     SupplierClassification? @relation(fields: [classificationId], references: [id])
  contacts           SupplierContact[]
  qualifications     SupplierQualification[]
  evaluations        SupplierEvaluation[]
  changeRecords      SupplierChangeRecord[]

  @@index([status])
  @@index([creditCode])
}

model SupplierContact {
  id          String   @id @default(cuid())
  supplierId  String
  name        String
  phone       String
  email       String?
  isPrimary   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  supplier    Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
}

model SupplierQualification {
  id          String    @id @default(cuid())
  supplierId  String
  type        String
  name        String
  fileUrl     String
  validFrom   DateTime?
  validTo     DateTime?
  status      String    @default("有效")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  supplier    Supplier  @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([validTo])
}

model SupplierClassification {
  id          String   @id @default(cuid())
  name        String   @unique
  code        String   @unique
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  suppliers   Supplier[]
}

model SupplierEvaluation {
  id                  String    @id @default(cuid())
  supplierId          String
  projectId           String?
  evaluatorId         String
  score               Decimal   @db.Decimal(5, 1)
  level               String
  completenessScore   Decimal   @db.Decimal(5, 1)
  responsivenessScore Decimal   @db.Decimal(5, 1)
  cooperationScore    Decimal   @db.Decimal(5, 1)
  complianceScore     Decimal   @db.Decimal(5, 1)
  overallScore        Decimal   @db.Decimal(5, 1)
  comment             String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  supplier            Supplier  @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([evaluatorId])
}

model SupplierChangeRecord {
  id           String        @id @default(cuid())
  supplierId   String
  fieldName    String
  fieldLabel   String
  oldValue     String?
  newValue     String?
  reason       String?
  status       ChangeStatus  @default(PENDING)
  reviewedBy   String?
  reviewedAt   DateTime?
  rejectReason String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  supplier     Supplier      @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId])
  @@index([status])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String
  title     String
  content   String
  isRead    Boolean  @default(false)
  link      String?
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
}
```

- [ ] **Step 2: 在 User 模型中添加关联字段**

在 User 模型末尾添加：
```prisma
  supplier            Supplier?
  notifications       Notification[]
  supplierEvaluations SupplierEvaluation[]
```

- [ ] **Step 3: 运行 Prisma 生成客户端**

Run: `cd water-erp && pnpm db:generate`
Expected: 成功生成 Prisma Client

- [ ] **Step 4: 创建数据库迁移**

Run: `cd water-erp && pnpm db:migrate --name add_supplier_management`
Expected: 迁移文件创建成功

- [ ] **Step 5: 提交数据模型更改**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(supplier): add supplier management data models"
```

---

## Task 2: 后端 - SupplierModule 基础结构

**Files:**
- Create: `apps/api/src/supplier/supplier.module.ts`
- Create: `apps/api/src/supplier/supplier.service.ts`
- Create: `apps/api/src/supplier/supplier.controller.ts`
- Create: `apps/api/src/supplier/dto/register-supplier.dto.ts`
- Create: `apps/api/src/supplier/dto/create-contact.dto.ts`
- Create: `apps/api/src/supplier/dto/create-qualification.dto.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 register-supplier.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsEmail, IsOptional, ValidateNested, IsArray, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateContactDto } from './create-contact.dto';
import { CreateQualificationDto } from './create-qualification.dto';

export class RegisterSupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/)
  creditCode: string;

  @IsString() @IsNotEmpty()
  enterpriseType: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  legalPerson: string;

  @IsString() @IsNotEmpty()
  registeredAddress: string;

  @IsString() @IsNotEmpty()
  businessScope: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string;

  @IsString() @IsNotEmpty() @MinLength(6)
  password: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateContactDto)
  contacts: CreateContactDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateQualificationDto)
  qualifications: CreateQualificationDto[];
}
```

- [ ] **Step 2: 创建 create-contact.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsEmail, IsOptional, IsBoolean, Matches, MaxLength } from 'class-validator';

export class CreateContactDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @Matches(/^1[3-9]\d{9}$/)
  phone: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsBoolean()
  isPrimary: boolean;
}
```

- [ ] **Step 3: 创建 create-qualification.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreateQualificationDto {
  @IsString() @IsNotEmpty()
  type: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  fileUrl: string;

  @IsDateString() @IsOptional()
  validFrom?: string;

  @IsDateString() @IsOptional()
  validTo?: string;
}
```

- [ ] **Step 4: 创建 supplier.service.ts 基础方法**

```typescript
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterSupplierDto } from './dto/register-supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async register(dto: RegisterSupplierDto) {
    // 检查信用代码是否重复
    const existingCreditCode = await this.prisma.supplier.findUnique({
      where: { creditCode: dto.creditCode },
    });
    if (existingCreditCode) {
      throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
    }

    // 检查企业名称是否重复（标准化）
    const normalizedName = dto.name.trim().toLowerCase();
    const existingName = await this.prisma.supplier.findUnique({
      where: { normalizedName },
    });
    if (existingName) {
      throw new BadRequestException({ error: '企业名称已存在', code: 'DUPLICATE_NAME' });
    }

    // 检查用户名是否重复
    const existingUser = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUser) {
      throw new BadRequestException({ error: '用户名已存在', code: 'DUPLICATE_USERNAME' });
    }

    // 创建用户和供应商
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: dto.email,
        passwordHash: hashSync(dto.password, 10),
        role: 'supplier',
        isActive: false, // 待审核后激活
      },
    });

    const supplier = await this.prisma.supplier.create({
      data: {
        userId: user.id,
        name: dto.name,
        normalizedName,
        creditCode: dto.creditCode,
        enterpriseType: dto.enterpriseType,
        legalPerson: dto.legalPerson,
        registeredAddress: dto.registeredAddress,
        businessScope: dto.businessScope,
        contacts: {
          create: dto.contacts.map(c => ({
            name: c.name,
            phone: c.phone,
            email: c.email,
            isPrimary: c.isPrimary,
          })),
        },
        qualifications: {
          create: dto.qualifications.map(q => ({
            type: q.type,
            name: q.name,
            fileUrl: q.fileUrl,
            validFrom: q.validFrom ? new Date(q.validFrom) : undefined,
            validTo: q.validTo ? new Date(q.validTo) : undefined,
          })),
        },
      },
      include: {
        contacts: true,
        qualifications: true,
      },
    });

    return { user, supplier };
  }

  async list(params: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.classificationId) {
      where.classificationId = params.classificationId;
    }
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { creditCode: { contains: params.search } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          classification: true,
          contacts: { where: { isPrimary: true } },
          _count: { select: { evaluations: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  async get(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true } },
        classification: true,
        contacts: true,
        qualifications: true,
        evaluations: { orderBy: { createdAt: 'desc' }, take: 10 },
        changeRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async getRegisterStatus(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, status: true, returnReason: true, rejectReason: true },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    return supplier;
  }
}
```

- [ ] **Step 5: 创建 supplier.controller.ts 注册和列表接口**

```typescript
import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { AuthGuard } from '../auth/auth.guard';
import { RegisterSupplierDto } from './dto/register-supplier.dto';

@Controller('supplier')
export class SupplierController {
  constructor(private supplierService: SupplierService) {}

  // 公开接口：供应商注册
  @Post('register')
  async register(@Body() dto: RegisterSupplierDto) {
    return this.supplierService.register(dto);
  }

  // 供应商查询注册状态（需登录）
  @Get('register/status')
  @UseGuards(AuthGuard)
  async getRegisterStatus(@Request() req: any) {
    return this.supplierService.getRegisterStatus(req.user.sub);
  }

  // 供应商库列表（采购中心权限）
  @Get('list')
  @UseGuards(AuthGuard)
  async list(
    @Query('status') status?: string,
    @Query('classificationId') classificationId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.supplierService.list({ status, classificationId, search, page, pageSize });
  }

  // 供应商详情
  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return this.supplierService.get(id);
  }
}
```

- [ ] **Step 6: 创建 supplier.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';

@Module({
  controllers: [SupplierController],
  providers: [SupplierService],
  exports: [SupplierService],
})
export class SupplierModule {}
```

- [ ] **Step 7: 在 app.module.ts 导入 SupplierModule**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BidModule } from './bid/bid.module';
import { SupplierModule } from './supplier/supplier.module'; // 新增

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BidModule,
    SupplierModule, // 新增
  ],
})
export class AppModule {}
```

- [ ] **Step 8: 验证后端启动**

Run: `cd water-erp && pnpm dev:api`
Expected: NestJS 服务启动成功，无报错

- [ ] **Step 9: 提交 SupplierModule 基础代码**

```bash
git add apps/api/src/supplier/ apps/api/src/app.module.ts
git commit -m "feat(supplier): add supplier module with register and list endpoints"
```

---

## Task 3: 后端 - 供应商审核功能

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`
- Modify: `apps/api/src/supplier/supplier.controller.ts`
- Create: `apps/api/src/supplier/procurement.guard.ts`
- Create: `apps/api/src/supplier/dto/update-supplier-status.dto.ts`

- [ ] **Step 1: 创建 procurement.guard.ts**

```typescript
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ProcurementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }
    
    if (user.role !== 'procurement_staff' && user.role !== 'admin') {
      throw new ForbiddenException({ error: '无权操作，需要采购中心或管理员权限', code: 'FORBIDDEN' });
    }
    
    return true;
  }
}
```

- [ ] **Step 2: 创建 update-supplier-status.dto.ts**

```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateSupplierStatusDto {
  @IsString() @IsNotEmpty()
  reason: string;
}
```

- [ ] **Step 3: 在 supplier.service.ts 添加审核方法**

添加以下方法到 SupplierService：
```typescript
  async approve(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, include: { user: true } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // 更新供应商状态和用户激活状态
    await this.prisma.$transaction([
      this.prisma.supplier.update({
        where: { id },
        data: { status: 'APPROVED', returnReason: null, rejectReason: null },
      }),
      this.prisma.user.update({
        where: { id: supplier.userId },
        data: { isActive: true },
      }),
    ]);

    return { success: true };
  }

  async reject(id: string, reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplier.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });
  }

  async return(id: string, reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许退回', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplier.update({
      where: { id },
      data: { status: 'RETURNED', returnReason: reason },
    });
  }

  async updateStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以调整状态', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplier.update({
      where: { id },
      data: { status, returnReason: reason },
    });
  }
```

- [ ] **Step 4: 在 supplier.controller.ts 添加审核接口**

添加以下接口到 SupplierController：
```typescript
  // 审核通过（采购中心权限）
  @Post(':id/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  async approve(@Param('id') id: string) {
    return this.supplierService.approve(id);
  }

  // 审核不通过（采购中心权限）
  @Post(':id/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  async reject(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.reject(id, dto.reason);
  }

  // 退回补正（采购中心权限）
  @Post(':id/return')
  @UseGuards(AuthGuard, ProcurementGuard)
  async return(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.return(id, dto.reason);
  }

  // 更新状态（管理员权限）
  @Patch(':id/status')
  @UseGuards(AuthGuard)
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: 'DISABLED' | 'BLACKLIST',
    @Body() dto: UpdateSupplierStatusDto,
    @Request() req: any,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以调整供应商状态', code: 'FORBIDDEN' });
    }
    return this.supplierService.updateStatus(id, status, dto.reason);
  }
```

- [ ] **Step 5: 验证审核接口**

Run: `cd water-erp && pnpm dev:api`
Expected: 服务启动成功

- [ ] **Step 6: 提交审核功能代码**

```bash
git add apps/api/src/supplier/
git commit -m "feat(supplier): add supplier audit endpoints (approve/reject/return)"
```

---

## Task 4: 后端 - 信息变更功能

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`
- Modify: `apps/api/src/supplier/supplier.controller.ts`
- Create: `apps/api/src/supplier/owner.guard.ts`
- Create: `apps/api/src/supplier/dto/create-change-request.dto.ts`
- Create: `apps/api/src/supplier/dto/approve-change.dto.ts`

- [ ] **Step 1: 创建 owner.guard.ts**

```typescript
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const supplierId = request.params.id;

    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    if (user.role !== 'supplier') {
      // 非供应商用户可以查看，但只有供应商本人可以修改
      return true;
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: user.sub },
    });

    if (!supplier || supplier.id !== supplierId) {
      throw new ForbiddenException({ error: '只能操作自己的供应商信息', code: 'FORBIDDEN' });
    }

    return true;
  }
}
```

- [ ] **Step 2: 创建 create-change-request.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateChangeRequestDto {
  @IsString() @IsNotEmpty()
  fieldName: string;

  @IsString() @IsNotEmpty()
  fieldLabel: string;

  @IsString() @IsNotEmpty()
  newValue: string;

  @IsString() @IsOptional()
  reason?: string;
}
```

- [ ] **Step 3: 创建 approve-change.dto.ts**

```typescript
import { IsString, IsOptional } from 'class-validator';

export class ApproveChangeDto {
  @IsString() @IsOptional()
  rejectReason?: string;
}
```

- [ ] **Step 4: 在 supplier.service.ts 添加变更方法**

添加以下方法到 SupplierService：
```typescript
  async listChanges(supplierId: string) {
    return this.prisma.supplierChangeRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChangeRequest(supplierId: string, userId: string, dto: CreateChangeRequestDto) {
    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以提交变更', code: 'INVALID_STATUS' });
    }

    // 验证所有权
    if (supplier.userId !== userId) {
      throw new ForbiddenException({ error: '只能提交自己的变更申请', code: 'FORBIDDEN' });
    }

    // 获取旧值
    const oldValue = supplier[dto.fieldName as keyof typeof supplier] as string;

    return this.prisma.supplierChangeRecord.create({
      data: {
        supplierId,
        fieldName: dto.fieldName,
        fieldLabel: dto.fieldLabel,
        oldValue,
        newValue: dto.newValue,
        reason: dto.reason,
        status: 'PENDING',
      },
    });
  }

  async approveChange(changeId: string, reviewerId: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    // 更新变更记录和供应商字段
    await this.prisma.$transaction([
      this.prisma.supplierChangeRecord.update({
        where: { id: changeId },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.supplier.update({
        where: { id: change.supplierId },
        data: { [change.fieldName]: change.newValue },
      }),
    ]);

    return { success: true };
  }

  async rejectChange(changeId: string, reviewerId: string, reason: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplierChangeRecord.update({
      where: { id: changeId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
  }
```

- [ ] **Step 5: 在 supplier.controller.ts 添加变更接口**

添加以下接口到 SupplierController（需要导入 OwnerGuard 和新 DTO）：
```typescript
  // 变更记录列表
  @Get(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  async listChanges(@Param('id') id: string) {
    return this.supplierService.listChanges(id);
  }

  // 提交变更申请（供应商本人）
  @Post(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  async createChangeRequest(@Param('id') id: string, @Body() dto: CreateChangeRequestDto, @Request() req: any) {
    return this.supplierService.createChangeRequest(id, req.user.sub, dto);
  }

  // 审核变更（采购中心）
  @Post('changes/:changeId/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  async approveChange(@Param('changeId') changeId: string, @Request() req: any) {
    return this.supplierService.approveChange(changeId, req.user.sub);
  }

  // 拒绝变更（采购中心）
  @Post('changes/:changeId/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  async rejectChange(@Param('changeId') changeId: string, @Body() dto: ApproveChangeDto, @Request() req: any) {
    return this.supplierService.rejectChange(changeId, req.user.sub, dto.rejectReason ?? '');
  }
```

需要在 SupplierModule 中导入 PrismaModule 以便 OwnerGuard 使用：
```typescript
import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { OwnerGuard } from './owner.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierController],
  providers: [SupplierService, OwnerGuard],
  exports: [SupplierService],
})
export class SupplierModule {}
```

- [ ] **Step 6: 提交信息变更功能代码**

```bash
git add apps/api/src/supplier/
git commit -m "feat(supplier): add supplier change request functionality"
```

---

## Task 5: 后端 - 资质材料管理

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`
- Modify: `apps/api/src/supplier/supplier.controller.ts`

- [ ] **Step 1: 在 supplier.service.ts 添加资质管理方法**

添加以下方法到 SupplierService：
```typescript
  async listQualifications(supplierId: string) {
    return this.prisma.supplierQualification.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addQualification(supplierId: string, dto: CreateQualificationDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }

    return this.prisma.supplierQualification.create({
      data: {
        supplierId,
        type: dto.type,
        name: dto.name,
        fileUrl: dto.fileUrl,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  async deleteQualification(supplierId: string, qualificationId: string) {
    const qualification = await this.prisma.supplierQualification.findUnique({
      where: { id: qualificationId },
    });
    if (!qualification || qualification.supplierId !== supplierId) {
      throw new BadRequestException({ error: '资质材料不存在或不属于此供应商', code: 'NOT_FOUND' });
    }

    return this.prisma.supplierQualification.delete({
      where: { id: qualificationId },
    });
  }

  async checkQualificationExpiry() {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 查找即将过期的资质
    const expiringQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lte: thirtyDaysLater, gte: now },
        status: '有效',
      },
      include: { supplier: true },
    });

    // 更新状态为即将过期
    for (const q of expiringQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '即将过期' },
      });
    }

    // 查找已过期的资质
    const expiredQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lt: now },
        status: { not: '已过期' },
      },
    });

    for (const q of expiredQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '已过期' },
      });
    }

    return { expiring: expiringQualifications.length, expired: expiredQualifications.length };
  }
}
```

- [ ] **Step 2: 在 supplier.controller.ts 添加资质接口**

添加以下接口到 SupplierController：
```typescript
  // 资质材料列表
  @Get(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  async listQualifications(@Param('id') id: string) {
    return this.supplierService.listQualifications(id);
  }

  // 上传资质材料
  @Post(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  async addQualification(@Param('id') id: string, @Body() dto: CreateQualificationDto, @Request() req: any) {
    // 验证供应商所有权
    if (req.user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({ where: { userId: req.user.sub } });
      if (!supplier || supplier.id !== id) {
        throw new ForbiddenException({ error: '只能上传自己的资质材料', code: 'FORBIDDEN' });
      }
    }
    return this.supplierService.addQualification(id, dto);
  }

  // 删除资质材料
  @Delete(':id/qualifications/:qid')
  @UseGuards(AuthGuard, OwnerGuard)
  async deleteQualification(@Param('id') id: string, @Param('qid') qid: string) {
    return this.supplierService.deleteQualification(id, qid);
  }
}
```

需要导入 Delete 方法：`import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';`

- [ ] **Step 3: 提交资质管理代码**

```bash
git add apps/api/src/supplier/
git commit -m "feat(supplier): add qualification management endpoints"
```

---

## Task 6: 后端 - 供应商评价功能

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`
- Modify: `apps/api/src/supplier/supplier.controller.ts`
- Create: `apps/api/src/supplier/dto/create-evaluation.dto.ts`

- [ ] **Step 1: 创建 create-evaluation.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsOptional, IsDecimal, Min, Max } from 'class-validator';

export class CreateEvaluationDto {
  @IsString() @IsOptional()
  projectId?: string;

  @IsDecimal() @Min(0) @Max(20)
  completenessScore: number;  // 资料完整性（20%）

  @IsDecimal() @Min(0) @Max(30)
  responsivenessScore: number;  // 文件响应（30%）

  @IsDecimal() @Min(0) @Max(20)
  cooperationScore: number;  // 配合情况（20%）

  @IsDecimal() @Min(0) @Max(20)
  complianceScore: number;  // 合规情况（20%）

  @IsDecimal() @Min(0) @Max(10)
  overallScore: number;  // 综合评价（10%）

  @IsString() @IsOptional()
  comment?: string;
}
```

- [ ] **Step 2: 在 supplier.service.ts 添加评价方法**

添加以下方法到 SupplierService：
```typescript
  async listEvaluations(supplierId: string) {
    return this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        evaluator: { select: { id: true, displayName: true } },
      },
    });
  }

  async createEvaluation(supplierId: string, evaluatorId: string, dto: CreateEvaluationDto) {
    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只能评价已入库供应商', code: 'INVALID_STATUS' });
    }

    // 计算总分
    const totalScore = dto.completenessScore + dto.responsivenessScore + dto.cooperationScore + dto.complianceScore + dto.overallScore;

    // 确定等级
    let level: string;
    if (totalScore >= 90) {
      level = 'A';
    } else if (totalScore >= 80) {
      level = 'B';
    } else if (totalScore >= 60) {
      level = 'C';
    } else {
      level = 'D';
    }

    return this.prisma.supplierEvaluation.create({
      data: {
        supplierId,
        projectId: dto.projectId,
        evaluatorId,
        score: totalScore,
        level,
        completenessScore: dto.completenessScore,
        responsivenessScore: dto.responsivenessScore,
        cooperationScore: dto.cooperationScore,
        complianceScore: dto.complianceScore,
        overallScore: dto.overallScore,
        comment: dto.comment,
      },
    });
  }

  async getEvaluationStats() {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      select: { level: true, score: true },
    });

    const levelCounts = {
      A: evaluations.filter(e => e.level === 'A').length,
      B: evaluations.filter(e => e.level === 'B').length,
      C: evaluations.filter(e => e.level === 'C').length,
      D: evaluations.filter(e => e.level === 'D').length,
    };

    const avgScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + Number(e.score), 0) / evaluations.length
      : 0;

    return { levelCounts, avgScore, total: evaluations.length };
  }
}
```

- [ ] **Step 3: 在 supplier.controller.ts 添加评价接口**

添加以下接口到 SupplierController：
```typescript
  // 评价记录列表
  @Get(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  async listEvaluations(@Param('id') id: string) {
    return this.supplierService.listEvaluations(id);
  }

  // 发起评价（采购中心）
  @Post(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  async createEvaluation(@Param('id') id: string, @Body() dto: CreateEvaluationDto, @Request() req: any) {
    return this.supplierService.createEvaluation(id, req.user.sub, dto);
  }

  // 评价统计
  @Get('evaluations/stats')
  @UseGuards(AuthGuard)
  async getEvaluationStats(@Request() req: any) {
    if (req.user.role !== 'procurement_staff' && req.user.role !== 'admin' && req.user.role !== 'leader') {
      throw new ForbiddenException({ error: '无权查看评价统计', code: 'FORBIDDEN' });
    }
    return this.supplierService.getEvaluationStats();
  }
}
```

- [ ] **Step 4: 提交评价功能代码**

```bash
git add apps/api/src/supplier/
git commit -m "feat(supplier): add supplier evaluation functionality"
```

---

## Task 7: 后端 - 分类管理功能

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`
- Modify: `apps/api/src/supplier/supplier.controller.ts`
- Create: `apps/api/src/supplier/dto/create-classification.dto.ts`

- [ ] **Step 1: 创建 create-classification.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateClassificationDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsString() @IsNotEmpty() @MaxLength(20)
  code: string;

  @IsString() @IsOptional()
  description?: string;
}

export class UpdateClassificationDto {
  @IsString() @IsOptional() @MaxLength(50)
  name?: string;

  @IsString() @IsOptional() @MaxLength(20)
  code?: string;

  @IsString() @IsOptional()
  description?: string;
}
```

- [ ] **Step 2: 在 supplier.service.ts 添加分类方法**

添加以下方法到 SupplierService：
```typescript
  async listClassifications() {
    return this.prisma.supplierClassification.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { suppliers: true } },
      },
    });
  }

  async createClassification(dto: CreateClassificationDto) {
    // 检查名称和代码是否重复
    const existingName = await this.prisma.supplierClassification.findUnique({
      where: { name: dto.name },
    });
    if (existingName) {
      throw new BadRequestException({ error: '分类名称已存在', code: 'DUPLICATE_NAME' });
    }

    const existingCode = await this.prisma.supplierClassification.findUnique({
      where: { code: dto.code },
    });
    if (existingCode) {
      throw new BadRequestException({ error: '分类代码已存在', code: 'DUPLICATE_CODE' });
    }

    return this.prisma.supplierClassification.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async updateClassification(id: string, dto: UpdateClassificationDto) {
    return this.prisma.supplierClassification.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async deleteClassification(id: string) {
    // 检查是否有供应商使用此分类
    const suppliersCount = await this.prisma.supplier.count({
      where: { classificationId: id },
    });
    if (suppliersCount > 0) {
      throw new BadRequestException({ error: '此分类下有供应商，无法删除', code: 'HAS_SUPPLIERS' });
    }

    return this.prisma.supplierClassification.delete({
      where: { id },
    });
  }
}
```

- [ ] **Step 3: 在 supplier.controller.ts 添加分类接口**

添加以下接口到 SupplierController：
```typescript
  // 分类列表（管理员）
  @Get('classifications')
  @UseGuards(AuthGuard)
  async listClassifications(@Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以管理分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.listClassifications();
  }

  // 创建分类（管理员）
  @Post('classifications')
  @UseGuards(AuthGuard)
  async createClassification(@Body() dto: CreateClassificationDto, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以创建分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.createClassification(dto);
  }

  // 更新分类（管理员）
  @Patch('classifications/:id')
  @UseGuards(AuthGuard)
  async updateClassification(@Param('id') id: string, @Body() dto: UpdateClassificationDto, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以更新分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.updateClassification(id, dto);
  }

  // 删除分类（管理员）
  @Delete('classifications/:id')
  @UseGuards(AuthGuard)
  async deleteClassification(@Param('id') id: string, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以删除分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.deleteClassification(id);
  }
```

需要导入 Patch 和 UpdateClassificationDto：`import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';`

- [ ] **Step 4: 提交分类管理代码**

```bash
git add apps/api/src/supplier/
git commit -m "feat(supplier): add classification management endpoints"
```

---

## Task 8: 后端 - NotificationModule

**Files:**
- Create: `apps/api/src/notification/notification.module.ts`
- Create: `apps/api/src/notification/notification.service.ts`
- Create: `apps/api/src/notification/notification.controller.ts`
- Create: `apps/api/src/notification/dto/create-notification.dto.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 创建 create-notification.dto.ts**

```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateNotificationDto {
  @IsString() @IsNotEmpty()
  userId: string;

  @IsString() @IsNotEmpty()
  type: string;

  @IsString() @IsNotEmpty()
  title: string;

  @IsString() @IsNotEmpty()
  content: string;

  @IsString() @IsOptional()
  link?: string;
}
```

- [ ] **Step 2: 创建 notification.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        link: dto.link,
      },
    });
  }

  async sendToRole(role: string, dto: Omit<CreateNotificationDto, 'userId'>) {
    // 获取所有指定角色的用户
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true },
      select: { id: true },
    });

    // 为每个用户创建通知
    const notifications = await Promise.all(
      users.map(user =>
        this.prisma.notification.create({
          data: {
            userId: user.id,
            type: dto.type,
            title: dto.title,
            content: dto.content,
            link: dto.link,
          },
        })
      )
    );

    return notifications;
  }

  async list(userId: string, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.findMany({
        where: { userId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error('通知不存在或不属于此用户');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
```

- [ ] **Step 3: 创建 notification.controller.ts**

```typescript
import { Controller, Get, Post, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationService } from './notification.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  async list(@Request() req: any, @Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.notificationService.list(req.user.sub, page ?? 1, pageSize ?? 20);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const count = await this.notificationService.getUnreadCount(req.user.sub);
    return { count };
  }

  @Post(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationService.markAsRead(id, req.user.sub);
  }

  @Post('mark-all-read')
  async markAllAsRead(@Request() req: any) {
    return this.notificationService.markAllAsRead(req.user.sub);
  }
}
```

- [ ] **Step 4: 创建 notification.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
```

- [ ] **Step 5: 在 app.module.ts 导入 NotificationModule**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BidModule } from './bid/bid.module';
import { SupplierModule } from './supplier/supplier.module';
import { NotificationModule } from './notification/notification.module'; // 新增

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BidModule,
    SupplierModule,
    NotificationModule, // 新增
  ],
})
export class AppModule {}
```

- [ ] **Step 6: 在 SupplierService 中集成通知**

在 SupplierModule 中导入 NotificationModule，并在审核操作后发送通知：

更新 supplier.module.ts：
```typescript
import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { OwnerGuard } from './owner.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [SupplierController],
  providers: [SupplierService, OwnerGuard],
  exports: [SupplierService],
})
export class SupplierModule {}
```

在 supplier.service.ts 中添加通知发送（需要在构造函数注入 NotificationService）：
```typescript
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService, private notificationService: NotificationService) {}

  // 在 approve 方法末尾添加通知发送
  async approve(id: string) {
    // ... 现有代码 ...
    
    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_APPROVED',
      title: '供应商审核通过',
      content: `您的供应商注册申请已审核通过，企业名称：${supplier.name}`,
      link: `/supplier/${id}`,
    });
    
    return { success: true };
  }

  // 在 reject 方法末尾添加通知发送
  async reject(id: string, reason: string) {
    // ... 现有代码 ...
    
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_REJECTED',
      title: '供应商审核不通过',
      content: `您的供应商注册申请审核不通过，原因：${reason}`,
    });
    
    return result;
  }

  // 在 return 方法末尾添加通知发送
  async return(id: string, reason: string) {
    // ... 现有代码 ...
    
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_RETURNED',
      title: '供应商注册退回补正',
      content: `您的供应商注册申请需补充修改，原因：${reason}`,
      link: `/supplier/register`,
    });
    
    return result;
  }
}
```

- [ ] **Step 7: 验证后端服务启动**

Run: `cd water-erp && pnpm dev:api`
Expected: NestJS 服务启动成功，所有模块加载正常

- [ ] **Step 8: 提交 NotificationModule 代码**

```bash
git add apps/api/src/notification/ apps/api/src/supplier/ apps/api/src/app.module.ts
git commit -m "feat(notification): add notification module and integrate with supplier module"
```

---

## Task 9: 前端 - 供应商类型定义

**Files:**
- Create: `apps/web/src/lib/types/supplier.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: 创建 supplier.ts 类型定义**

```typescript
export type SupplierStatus = 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLACKLIST';

export type ChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  creditCode: string;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  status: SupplierStatus;
  classificationId?: string;
  rejectReason?: string;
  returnReason?: string;
  createdAt: string;
  updatedAt: string;
  classification?: SupplierClassification;
  contacts?: SupplierContact[];
  qualifications?: SupplierQualification[];
  evaluations?: SupplierEvaluation[];
  changeRecords?: SupplierChangeRecord[];
  _count?: { evaluations: number };
}

export interface SupplierContact {
  id: string;
  supplierId: string;
  name: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}

export interface SupplierQualification {
  id: string;
  supplierId: string;
  type: string;
  name: string;
  fileUrl: string;
  validFrom?: string;
  validTo?: string;
  status: string;
}

export interface SupplierClassification {
  id: string;
  name: string;
  code: string;
  description?: string;
  _count?: { suppliers: number };
}

export interface SupplierEvaluation {
  id: string;
  supplierId: string;
  projectId?: string;
  evaluatorId: string;
  score: number;
  level: string;
  completenessScore: number;
  responsivenessScore: number;
  cooperationScore: number;
  complianceScore: number;
  overallScore: number;
  comment?: string;
  createdAt: string;
  evaluator?: { id: string; displayName: string };
}

export interface SupplierChangeRecord {
  id: string;
  supplierId: string;
  fieldName: string;
  fieldLabel: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  status: ChangeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReason?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  link?: string;
  createdAt: string;
}

export interface SupplierListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Supplier[];
}
```

- [ ] **Step 2: 在 types.ts 中导出供应商类型**

添加导出语句：
```typescript
export * from './types/supplier';
```

- [ ] **Step 3: 提交类型定义**

```bash
git add apps/web/src/lib/types/
git commit -m "feat(supplier): add supplier type definitions"
```

---

## Task 10: 前端 - 供应商 API 函数

**Files:**
- Create: `apps/web/src/lib/api/supplier.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: 创建 supplier.ts API 函数**

```typescript
import { api } from '../api';
import type { Supplier, SupplierListResponse, SupplierClassification, SupplierEvaluation, SupplierChangeRecord, SupplierQualification, Notification } from '../types';

// 供应商注册
export function registerSupplier(data: {
  name: string;
  creditCode: string;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  username: string;
  displayName: string;
  password: string;
  email?: string;
  contacts: { name: string; phone: string; email?: string; isPrimary: boolean }[];
  qualifications: { type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }[];
}) {
  return api.post<{ user: any; supplier: Supplier }>('/supplier/register', data);
}

// 查询注册状态
export function getRegisterStatus() {
  return api.get<{ id: string; name: string; status: string; returnReason?: string; rejectReason?: string }>('/supplier/register/status');
}

// 供应商列表
export function getSupplierList(params?: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.classificationId) query.set('classificationId', params.classificationId);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  return api.get<SupplierListResponse>(`/supplier/list?${query.toString()}`);
}

// 供应商详情
export function getSupplier(id: string) {
  return api.get<Supplier>(`/supplier/${id}`);
}

// 审核通过
export function approveSupplier(id: string) {
  return api.post<{ success: boolean }>(`/supplier/${id}/approve`, {});
}

// 审核不通过
export function rejectSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/reject`, { reason });
}

// 退回补正
export function returnSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/return`, { reason });
}

// 更新状态
export function updateSupplierStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
  return api.patch<Supplier>(`/supplier/${id}/status?status=${status}`, { reason });
}

// 变更记录列表
export function getSupplierChanges(id: string) {
  return api.get<SupplierChangeRecord[]>(`/supplier/${id}/changes`);
}

// 提交变更申请
export function createChangeRequest(id: string, data: { fieldName: string; fieldLabel: string; newValue: string; reason?: string }) {
  return api.post<SupplierChangeRecord>(`/supplier/${id}/changes`, data);
}

// 审核变更
export function approveChange(changeId: string) {
  return api.post<{ success: boolean }>(`/supplier/changes/${changeId}/approve`, {});
}

// 拒绝变更
export function rejectChange(changeId: string, rejectReason: string) {
  return api.post<SupplierChangeRecord>(`/supplier/changes/${changeId}/reject`, { rejectReason });
}

// 资质材料列表
export function getQualifications(id: string) {
  return api.get<SupplierQualification[]>(`/supplier/${id}/qualifications`);
}

// 上传资质材料
export function addQualification(id: string, data: { type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }) {
  return api.post<SupplierQualification>(`/supplier/${id}/qualifications`, data);
}

// 删除资质材料
export function deleteQualification(id: string, qid: string) {
  return api.delete<SupplierQualification>(`/supplier/${id}/qualifications/${qid}`);
}

// 评价记录列表
export function getSupplierEvaluations(id: string) {
  return api.get<SupplierEvaluation[]>(`/supplier/${id}/evaluations`);
}

// 发起评价
export function createEvaluation(id: string, data: {
  projectId?: string;
  completenessScore: number;
  responsivenessScore: number;
  cooperationScore: number;
  complianceScore: number;
  overallScore: number;
  comment?: string;
}) {
  return api.post<SupplierEvaluation>(`/supplier/${id}/evaluations`, data);
}

// 评价统计
export function getEvaluationStats() {
  return api.get<{ levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number }>('/supplier/evaluations/stats');
}

// 分类列表
export function getClassifications() {
  return api.get<SupplierClassification[]>('/supplier/classifications');
}

// 创建分类
export function createClassification(data: { name: string; code: string; description?: string }) {
  return api.post<SupplierClassification>('/supplier/classifications', data);
}

// 更新分类
export function updateClassification(id: string, data: { name?: string; code?: string; description?: string }) {
  return api.patch<SupplierClassification>(`/supplier/classifications/${id}`, data);
}

// 删除分类
export function deleteClassification(id: string) {
  return api.delete<SupplierClassification>(`/supplier/classifications/${id}`);
}

// 通知列表
export function getNotifications(page?: number, pageSize?: number) {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));
  return api.get<{ total: number; page: number; pageSize: number; items: Notification[] }>(`/notifications?${query.toString()}`);
}

// 未读通知数量
export function getUnreadNotificationCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}

// 标记已读
export function markNotificationRead(id: string) {
  return api.post<Notification>(`/notifications/${id}/read`, {});
}

// 全部标记已读
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}
```

- [ ] **Step 2: 在 api.ts 中导出供应商 API**

添加导出语句：
```typescript
export * from './api/supplier';
```

需要更新 api.ts 添加 delete 方法：
```typescript
const BASE = '/api';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    fetchApi<T>(path, { method: 'DELETE' }),
};
```

- [ ] **Step 3: 提交 API 函数代码**

```bash
git add apps/web/src/lib/api/
git commit -m "feat(supplier): add supplier API functions"
```

---

## Task 11: 前端 - 供应商库列表页

**Files:**
- Create: `apps/web/src/app/(dashboard)/supplier/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`

- [ ] **Step 1: 创建供应商库列表页 page.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupplierList, getClassifications } from '@/lib/api/supplier';
import type { Supplier, SupplierClassification, SupplierStatus } from '@/lib/types';

const statusLabels: Record<SupplierStatus, string> = {
  PENDING: '待审核',
  RETURNED: '退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '停用',
  BLACKLIST: '黑名单',
};

const statusColors: Record<SupplierStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  RETURNED: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  DISABLED: 'bg-gray-100 text-gray-800',
  BLACKLIST: 'bg-black text-white',
};

export default function SupplierListPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [classificationFilter, setClassificationFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    loadData();
  }, [page, statusFilter, classificationFilter, search]);

  async function loadData() {
    setLoading(true);
    try {
      const [supplierRes, classRes] = await Promise.all([
        getSupplierList({ status: statusFilter, classificationId: classificationFilter, search, page, pageSize }),
        getClassifications(),
      ]);
      setSuppliers(supplierRes.items);
      setTotal(supplierRes.total);
      setClassifications(classRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    setPage(1);
    loadData();
  }

  return (
    <div className="min-h-full">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#18243a]">供应商库</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">管理已注册供应商，支持审核、查询、导出</p>
      </header>

      {/* 搜索和筛选 */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-4">
          <input
            type="text"
            placeholder="搜索企业名称或信用代码"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-md text-sm"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm"
          >
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={classificationFilter}
            onChange={e => setClassificationFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm"
          >
            <option value="">全部分类</option>
            {classifications.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-[#064ea2] text-white rounded-md text-sm hover:bg-[#042a58]"
          >
            搜索
          </button>
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">企业名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">信用代码</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">分类</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">联系人</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">评价次数</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">注册时间</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">加载中...</td>
              </tr>
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无数据</td>
              </tr>
            ) : (
              suppliers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-[#18243a]">{s.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s.creditCode}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs ${statusColors[s.status]}`}>
                      {statusLabels[s.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s.classification?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {s.contacts?.[0]?.name || '-'}
                    {s.contacts?.[0]?.phone && ` (${s.contacts[0].phone})`}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s._count?.evaluations || 0}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => router.push(`/supplier/${s.id}`)}
                      className="text-[#064ea2] hover:underline"
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <span className="text-sm text-gray-600">
              共 {total} 条，第 {page} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * pageSize >= total}
                className="px-3 py-1 text-sm border rounded disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 app-shell.tsx 中添加供应商导航项**

在 navItems 数组中添加（已有"供应商管理"项，确认路径正确）：
```typescript
const navItems = [
  { label: '首页', path: '/dashboard', icon: '🏠' },
  { label: '采购管理', path: '/procurement', icon: '📋' },
  {
    label: '开评标管理', icon: '⚖️', children: [
      { label: '总览驾驶舱', path: '/bid' },
      { label: '供应商端', path: '/bid/submit' },
      { label: '开标主持端', path: '/bid/open' },
      { label: '专家评标端', path: '/bid/evaluate' },
      { label: '监督端', path: '/bid/supervise' },
      { label: '归档端', path: '/bid/archive' },
    ],
  },
  { label: '专家管理', path: '/expert', icon: '👨‍💼' },
  { label: '供应商管理', path: '/supplier', icon: '🏢' }, // 确保此项存在
  { label: '电子商城', path: '/mall', icon: '🛒' },
  { label: '信息公告', path: '/notice', icon: '📢' },
  { label: '评价管理', path: '/evaluation', icon: '⭐' },
  { label: '关于我们', path: '/about', icon: 'ℹ️' },
];
```

- [ ] **Step 3: 创建目录结构**

Run: `mkdir -p water-erp/apps/web/src/app/\(dashboard\)/supplier`

- [ ] **Step 4: 验证前端页面**

Run: `cd water-erp && pnpm dev:web`
Expected: Next.js 服务启动成功，访问 /supplier 页面正常显示

- [ ] **Step 5: 提交供应商列表页代码**

```bash
git add apps/web/src/app/(dashboard)/supplier/page.tsx apps/web/src/components/app-shell.tsx
git commit -m "feat(supplier): add supplier list page"
```

---

## Task 12: 前端 - 供应商注册页

**Files:**
- Create: `apps/web/src/app/(dashboard)/supplier/register/page.tsx`

- [ ] **Step 1: 创建供应商注册页**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerSupplier } from '@/lib/api/supplier';

type Step = 'basic' | 'contact' | 'qualification' | 'confirm';

export default function SupplierRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('basic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 基础信息
  const [name, setName] = useState('');
  const [creditCode, setCreditCode] = useState('');
  const [enterpriseType, setEnterpriseType] = useState('');
  const [legalPerson, setLegalPerson] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [businessScope, setBusinessScope] = useState('');

  // 用户信息
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  // 联系人
  const [contacts, setContacts] = useState<{ name: string; phone: string; email?: string; isPrimary: boolean }[]>([
    { name: '', phone: '', email: '', isPrimary: true },
  ]);

  // 资质材料
  const [qualifications, setQualifications] = useState<{ type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }[]>([
    { type: '营业执照', name: '', fileUrl: '' },
  ]);

  const enterpriseTypes = ['国有企业', '民营企业', '外资企业', '合资企业', '个体工商户', '其他'];
  const qualificationTypes = ['营业执照', '资质证书', '授权委托书', '安全生产许可证', 'ISO认证证书', '其他'];

  function addContact() {
    setContacts([...contacts, { name: '', phone: '', email: '', isPrimary: false }]);
  }

  function updateContact(index: number, field: string, value: string | boolean) {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'isPrimary' && value === true) {
      updated.forEach((c, i) => {
        if (i !== index) c.isPrimary = false;
      });
    }
    setContacts(updated);
  }

  function removeContact(index: number) {
    setContacts(contacts.filter((_, i) => i !== index));
  }

  function addQualification() {
    setQualifications([...qualifications, { type: '其他', name: '', fileUrl: '' }]);
  }

  function updateQualification(index: number, field: string, value: string) {
    const updated = [...qualifications];
    updated[index] = { ...updated[index], [field]: value };
    setQualifications(updated);
  }

  function removeQualification(index: number) {
    setQualifications(qualifications.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');

    try {
      await registerSupplier({
        name,
        creditCode,
        enterpriseType,
        legalPerson,
        registeredAddress,
        businessScope,
        username,
        displayName,
        password,
        email,
        contacts,
        qualifications,
      });
      router.push('/supplier/register/status');
    } catch (e: any) {
      setError(e.message || '注册失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'basic', label: '企业信息' },
    { key: 'contact', label: '联系人' },
    { key: 'qualification', label: '资质材料' },
    { key: 'confirm', label: '确认提交' },
  ];

  return (
    <div className="min-h-full max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#18243a]">供应商注册</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">请填写企业信息和资质材料，提交后等待采购中心审核</p>
      </header>

      {/* 步骤指示器 */}
      <div className="flex mb-8">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm ${
                step === s.key ? 'bg-[#064ea2] text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {i + 1}
            </div>
            <span className={`ml-2 text-sm ${step === s.key ? 'text-[#064ea2] font-medium' : 'text-gray-600'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-12 h-px bg-gray-200 mx-2" />}
          </div>
        ))}
      </div>

      {/* 表单内容 */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {step === 'basic' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">企业名称 *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
                placeholder="工商登记名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">统一社会信用代码 *</label>
              <input
                type="text"
                value={creditCode}
                onChange={e => setCreditCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
                placeholder="18位信用代码"
                maxLength={18}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">企业类型 *</label>
              <select
                value={enterpriseType}
                onChange={e => setEnterpriseType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              >
                <option value="">请选择</option>
                {enterpriseTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">法定代表人 *</label>
              <input
                type="text"
                value={legalPerson}
                onChange={e => setLegalPerson(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">注册地址 *</label>
              <input
                type="text"
                value={registeredAddress}
                onChange={e => setRegisteredAddress(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">经营范围 *</label>
              <textarea
                value={businessScope}
                onChange={e => setBusinessScope(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
                rows={3}
              />
            </div>
            
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">账号信息</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">用户名 *</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">显示名称 *</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">密码 *</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'contact' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700">联系人信息</h3>
            {contacts.map((c, i) => (
              <div key={i} className="border rounded-md p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">联系人姓名 *</label>
                    <input
                      type="text"
                      value={c.name}
                      onChange={e => updateContact(i, 'name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">手机号 *</label>
                    <input
                      type="text"
                      value={c.phone}
                      onChange={e => updateContact(i, 'phone', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                      maxLength={11}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">邮箱</label>
                    <input
                      type="email"
                      value={c.email || ''}
                      onChange={e => updateContact(i, 'email', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    />
                  </div>
                  <div className="flex items-center">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.isPrimary}
                        onChange={e => updateContact(i, 'isPrimary', e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-600">主要联系人</span>
                    </label>
                  </div>
                </div>
                {contacts.length > 1 && (
                  <button
                    onClick={() => removeContact(i)}
                    className="mt-2 text-sm text-red-500 hover:underline"
                  >
                    删除此联系人
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addContact}
              className="text-sm text-[#064ea2] hover:underline"
            >
              + 添加联系人
            </button>
          </div>
        )}

        {step === 'qualification' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700">资质材料</h3>
            {qualifications.map((q, i) => (
              <div key={i} className="border rounded-md p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">资质类型 *</label>
                    <select
                      value={q.type}
                      onChange={e => updateQualification(i, 'type', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    >
                      {qualificationTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">资质名称 *</label>
                    <input
                      type="text"
                      value={q.name}
                      onChange={e => updateQualification(i, 'name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-600 mb-1">文件路径 *</label>
                    <input
                      type="text"
                      value={q.fileUrl}
                      onChange={e => updateQualification(i, 'fileUrl', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                      placeholder="/uploads/xxx.pdf"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">有效期起</label>
                    <input
                      type="date"
                      value={q.validFrom || ''}
                      onChange={e => updateQualification(i, 'validFrom', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">有效期止</label>
                    <input
                      type="date"
                      value={q.validTo || ''}
                      onChange={e => updateQualification(i, 'validTo', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md"
                    />
                  </div>
                </div>
                {qualifications.length > 1 && (
                  <button
                    onClick={() => removeQualification(i)}
                    className="mt-2 text-sm text-red-500 hover:underline"
                  >
                    删除此资质
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addQualification}
              className="text-sm text-[#064ea2] hover:underline"
            >
              + 添加资质材料
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700">确认信息</h3>
            <div className="border rounded-md p-4 space-y-2">
              <p><strong>企业名称：</strong>{name}</p>
              <p><strong>信用代码：</strong>{creditCode}</p>
              <p><strong>企业类型：</strong>{enterpriseType}</p>
              <p><strong>法定代表人：</strong>{legalPerson}</p>
              <p><strong>注册地址：</strong>{registeredAddress}</p>
              <p><strong>经营范围：</strong>{businessScope}</p>
              <p><strong>联系人数量：</strong>{contacts.length}</p>
              <p><strong>资质材料数量：</strong>{qualifications.length}</p>
            </div>
            <div className="border rounded-md p-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="rounded" />
                <span className="text-sm text-gray-600">
                  我确认以上信息真实有效，并同意平台管理规则
                </span>
              </label>
            </div>
            {error && (
              <div className="text-red-500 text-sm">{error}</div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-between mt-6 pt-4 border-t">
          <button
            onClick={() => {
              const currentIndex = steps.findIndex(s => s.key === step);
              if (currentIndex > 0) setStep(steps[currentIndex - 1].key);
            }}
            disabled={step === 'basic'}
            className="px-4 py-2 text-sm border rounded-md disabled:opacity-50"
          >
            上一步
          </button>
          {step !== 'confirm' ? (
            <button
              onClick={() => {
                const currentIndex = steps.findIndex(s => s.key === step);
                if (currentIndex < steps.length - 1) setStep(steps[currentIndex + 1].key);
              }}
              className="px-4 py-2 text-sm bg-[#064ea2] text-white rounded-md hover:bg-[#042a58]"
            >
              下一步
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-4 py-2 text-sm bg-[#064ea2] text-white rounded-md hover:bg-[#042a58] disabled:opacity-50"
            >
              {loading ? '提交中...' : '提交注册'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建目录并提交**

Run: `mkdir -p water-erp/apps/web/src/app/\(dashboard\)/supplier/register`

```bash
git add apps/web/src/app/(dashboard)/supplier/register/page.tsx
git commit -m "feat(supplier): add supplier registration page"
```

---

## Task 13: 前端 - 供应商详情页

**Files:**
- Create: `apps/web/src/app/(dashboard)/supplier/[id]/page.tsx`

- [ ] **Step 1: 创建供应商详情页**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupplier, approveSupplier, rejectSupplier, returnSupplier, getSupplierChanges, getSupplierEvaluations, getQualifications } from '@/lib/api/supplier';
import type { Supplier, SupplierChangeRecord, SupplierEvaluation, SupplierQualification, SupplierStatus } from '@/lib/types';

const statusLabels: Record<SupplierStatus, string> = {
  PENDING: '待审核',
  RETURNED: '退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '停用',
  BLACKLIST: '黑名单',
};

type Tab = 'info' | 'qualifications' | 'changes' | 'evaluations';

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [qualifications, setQualifications] = useState<SupplierQualification[]>([]);
  const [changes, setChanges] = useState<SupplierChangeRecord[]>([]);
  const [evaluations, setEvaluations] = useState<SupplierEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('info');
  const [actionLoading, setActionLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [showActionModal, setShowActionModal] = useState<'approve' | 'reject' | 'return' | null>(null);

  useEffect(() => {
    loadSupplier();
  }, [id]);

  async function loadSupplier() {
    setLoading(true);
    try {
      const data = await getSupplier(id);
      setSupplier(data);
      
      // 加载其他数据
      const [quals, ch, evs] = await Promise.all([
        getQualifications(id),
        getSupplierChanges(id),
        getSupplierEvaluations(id),
      ]);
      setQualifications(quals);
      setChanges(ch);
      setEvaluations(evs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: 'approve' | 'reject' | 'return') {
    setActionLoading(true);
    try {
      if (action === 'approve') {
        await approveSupplier(id);
      } else if (action === 'reject') {
        await rejectSupplier(id, reason);
      } else if (action === 'return') {
        await returnSupplier(id, reason);
      }
      setShowActionModal(null);
      setReason('');
      loadSupplier();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <div className="min-h-full flex items-center justify-center">加载中...</div>;
  }

  if (!supplier) {
    return <div className="min-h-full flex items-center justify-center">供应商不存在</div>;
  }

  const canAudit = supplier.status === 'PENDING' || supplier.status === 'RETURNED';

  return (
    <div className="min-h-full">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#18243a]">{supplier.name}</h1>
            <p className="text-sm text-[#5a6d8a] mt-1">{supplier.creditCode}</p>
          </div>
          {canAudit && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowActionModal('approve')}
                className="px-4 py-2 bg-green-500 text-white rounded-md text-sm hover:bg-green-600"
              >
                审核通过
              </button>
              <button
                onClick={() => setShowActionModal('return')}
                className="px-4 py-2 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600"
              >
                退回补正
              </button>
              <button
                onClick={() => setShowActionModal('reject')}
                className="px-4 py-2 bg-red-500 text-white rounded-md text-sm hover:bg-red-600"
              >
                审核不通过
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Tab 导航 */}
      <div className="flex gap-4 mb-4 border-b">
        {(['info', 'qualifications', 'changes', 'evaluations'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t ? 'text-[#064ea2] border-[#064ea2]' : 'text-gray-500 border-transparent'
            }`}
          >
            {t === 'info' && '基础信息'}
            {t === 'qualifications' && '资质材料'}
            {t === 'changes' && '变更记录'}
            {t === 'evaluations' && '评价记录'}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {tab === 'info' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">状态</p>
              <p className="font-medium">{statusLabels[supplier.status]}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">企业类型</p>
              <p className="font-medium">{supplier.enterpriseType}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">法定代表人</p>
              <p className="font-medium">{supplier.legalPerson}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">注册地址</p>
              <p className="font-medium">{supplier.registeredAddress}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-500">经营范围</p>
              <p className="font-medium">{supplier.businessScope}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-500 mt-4">联系人</p>
              <div className="mt-2 space-y-2">
                {supplier.contacts?.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-gray-500">{c.phone}</span>
                    {c.email && <span className="text-gray-500">{c.email}</span>}
                    {c.isPrimary && <span className="text-xs bg-blue-100 text-blue-600 px-1 rounded">主要</span>}
                  </div>
                ))}
              </div>
            </div>
            {supplier.returnReason && (
              <div className="col-span-2">
                <p className="text-sm text-orange-500">退回原因</p>
                <p className="font-medium">{supplier.returnReason}</p>
              </div>
            )}
            {supplier.rejectReason && (
              <div className="col-span-2">
                <p className="text-sm text-red-500">拒绝原因</p>
                <p className="font-medium">{supplier.rejectReason}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'qualifications' && (
          <div className="space-y-4">
            {qualifications.length === 0 ? (
              <p className="text-gray-400">暂无资质材料</p>
            ) : (
              qualifications.map(q => (
                <div key={q.id} className="border rounded-md p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{q.name}</p>
                      <p className="text-sm text-gray-500">{q.type}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      q.status === '有效' ? 'bg-green-100 text-green-600' :
                      q.status === '即将过期' ? 'bg-orange-100 text-orange-600' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {q.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">文件：{q.fileUrl}</p>
                  {q.validTo && (
                    <p className="text-sm text-gray-500">有效期至：{new Date(q.validTo).toLocaleDateString()}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'changes' && (
          <div className="space-y-4">
            {changes.length === 0 ? (
              <p className="text-gray-400">暂无变更记录</p>
            ) : (
              changes.map(c => (
                <div key={c.id} className="border rounded-md p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{c.fieldLabel}</p>
                      <p className="text-sm text-gray-500">
                        从 "{c.oldValue}" 变更为 "{c.newValue}"
                      </p>
                      {c.reason && <p className="text-sm text-gray-500">原因：{c.reason}</p>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      c.status === 'PENDING' ? 'bg-yellow-100 text-yellow-600' :
                      c.status === 'APPROVED' ? 'bg-green-100 text-green-600' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {c.status === 'PENDING' ? '待审核' : c.status === 'APPROVED' ? '已通过' : '已拒绝'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-2">
                    提交时间：{new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'evaluations' && (
          <div className="space-y-4">
            {evaluations.length === 0 ? (
              <p className="text-gray-400">暂无评价记录</p>
            ) : (
              evaluations.map(e => (
                <div key={e.id} className="border rounded-md p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">总评分：{e.score}分</p>
                      <p className="text-sm text-gray-500">等级：{e.level}</p>
                    </div>
                    <span className={`text-xl font-bold ${
                      e.level === 'A' ? 'text-green-500' :
                      e.level === 'B' ? 'text-blue-500' :
                      e.level === 'C' ? 'text-yellow-500' :
                      'text-red-500'
                    }`}>
                      {e.level}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2 mt-4 text-sm">
                    <div className="text-center">
                      <p className="text-gray-500">完整性</p>
                      <p className="font-medium">{e.completenessScore}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">响应性</p>
                      <p className="font-medium">{e.responsivenessScore}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">配合度</p>
                      <p className="font-medium">{e.cooperationScore}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">合规性</p>
                      <p className="font-medium">{e.complianceScore}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-500">综合</p>
                      <p className="font-medium">{e.overallScore}</p>
                    </div>
                  </div>
                  {e.comment && (
                    <p className="text-sm text-gray-500 mt-2">评价意见：{e.comment}</p>
                  )}
                  <p className="text-sm text-gray-400 mt-2">
                    评价人：{e.evaluator?.displayName} | 时间：{new Date(e.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 操作弹窗 */}
      {showActionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {showActionModal === 'approve' && '确认审核通过'}
              {showActionModal === 'reject' && '审核不通过'}
              {showActionModal === 'return' && '退回补正'}
            </h3>
            {showActionModal !== 'approve' && (
              <div className="mb-4">
                <label className="block text-sm text-gray-600 mb-1">原因</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  rows={3}
                  placeholder="请输入原因..."
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowActionModal(null)}
                className="px-4 py-2 text-sm border rounded-md"
              >
                取消
              </button>
              <button
                onClick={() => handleAction(showActionModal)}
                disabled={actionLoading || (showActionModal !== 'approve' && !reason)}
                className="px-4 py-2 text-sm bg-[#064ea2] text-white rounded-md disabled:opacity-50"
              >
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建目录并提交**

Run: `mkdir -p water-erp/apps/web/src/app/\(dashboard\)/supplier/\[id\]`

```bash
git add apps/web/src/app/(dashboard)/supplier/[id]/page.tsx
git commit -m "feat(supplier): add supplier detail page with tabs"
```

---

## Task 14: 前端 - 审核列表页

**Files:**
- Create: `apps/web/src/app/(dashboard)/supplier/audit/page.tsx`

- [ ] **Step 1: 创建审核列表页**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';

export default function SupplierAuditPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingSuppliers();
  }, []);

  async function loadPendingSuppliers() {
    setLoading(true);
    try {
      const res = await getSupplierList({ status: 'PENDING', pageSize: 50 });
      setSuppliers(res.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#18243a]">注册审核</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">处理待审核的供应商注册申请</p>
      </header>

      <div className="bg-white rounded-lg shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无待审核供应商</div>
        ) : (
          <div className="divide-y">
            {suppliers.map(s => (
              <div key={s.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="font-medium text-[#18243a]">{s.name}</p>
                  <p className="text-sm text-gray-500">{s.creditCode}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    提交时间：{new Date(s.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-1 rounded">待审核</span>
                  <button
                    onClick={() => router.push(`/supplier/${s.id}`)}
                    className="px-3 py-1 text-sm text-[#064ea2] border border-[#064ea2] rounded hover:bg-[#064ea2] hover:text-white"
                  >
                    去审核
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建目录并提交**

Run: `mkdir -p water-erp/apps/web/src/app/\(dashboard\)/supplier/audit`

```bash
git add apps/web/src/app/(dashboard)/supplier/audit/page.tsx
git commit -m "feat(supplier): add supplier audit list page"
```

---

## Task 15: 验证与集成测试

**Files:**
- 无新增文件

- [ ] **Step 1: 启动后端服务**

Run: `cd water-erp && pnpm dev:api`
Expected: NestJS 服务启动在 http://localhost:3000

- [ ] **Step 2: 启动前端服务**

Run: `cd water-erp && pnpm dev:web`
Expected: Next.js 服务启动在 http://localhost:3002

- [ ] **Step 3: 测试供应商注册流程**

1. 访问 http://localhost:3002/supplier/register
2. 填写企业信息、联系人、资质材料
3. 提交注册
4. 检查数据库是否创建了 User 和 Supplier 记录

- [ ] **Step 4: 测试审核流程**

1. 使用采购中心账号登录
2. 访问 http://localhost:3002/supplier/audit
3. 点击待审核供应商，进入详情页
4. 点击"审核通过"按钮
5. 检查供应商状态变为 APPROVED，用户 isActive 变为 true

- [ ] **Step 5: 测试信息变更流程**

1. 使用供应商账号登录（审核通过后）
2. 访问供应商详情页
3. 提交变更申请
4. 使用采购中心账号审核变更
5. 检查变更是否生效

- [ ] **Step 6: 测试评价流程**

1. 使用采购中心账号登录
2. 访问供应商详情页的评价记录 Tab
3. 点击发起评价（需要添加评价功能按钮）
4. 填写各项评分
5. 检查评价记录是否创建

- [ ] **Step 7: 提交最终代码**

```bash
git add -A
git commit -m "feat(supplier): complete supplier management module"
```

---

## Spec Coverage 检查

| 需求 | 任务覆盖 |
|---|---|
| Supplier 数据模型 | Task 1 ✓ |
| SupplierContact 数据模型 | Task 1 ✓ |
| SupplierQualification 数据模型 | Task 1 ✓ |
| SupplierClassification 数据模型 | Task 1 ✓ |
| SupplierEvaluation 数据模型 | Task 1 ✓ |
| SupplierChangeRecord 数据模型 | Task 1 ✓ |
| Notification 数据模型 | Task 1 ✓ |
| 供应商注册 API | Task 2 ✓ |
| 供应商列表 API | Task 2 ✓ |
| 审核通过/拒绝/退回 API | Task 3 ✓ |
| 信息变更 API | Task 4 ✓ |
| 资质材料管理 API | Task 5 ✓ |
| 供应商评价 API | Task 6 ✓ |
| 分类管理 API | Task 7 ✓ |
| 通知服务 API | Task 8 ✓ |
| 权限守卫 | Task 3, 4 ✓ |
| 前端类型定义 | Task 9 ✓ |
| 前端 API 函数 | Task 10 ✓ |
| 供应商库列表页 | Task 11 ✓ |
| 供应商注册页 | Task 12 ✓ |
| 供应商详情页 | Task 13 ✓ |
| 审核列表页 | Task 14 ✓ |

所有需求已覆盖。

---

Plan complete and saved to `water-erp/docs/superpowers/plans/2026-06-08-supplier-management-implementation.md`. 

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**