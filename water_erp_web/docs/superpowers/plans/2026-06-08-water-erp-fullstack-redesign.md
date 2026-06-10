# 智慧水发招采 ERP 全栈系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack water-erp system with Next.js frontend and NestJS backend, completing the full bid opening/evaluation module with real CRUD, plus shell pages for all other modules.

**Architecture:** pnpm monorepo with `apps/web` (Next.js 16), `apps/api` (NestJS 11), `packages/config`, `packages/ui`. PostgreSQL via Prisma 7. Docker Compose for infrastructure. JWT auth via HttpOnly cookies. Frontend proxies `/api/*` to backend.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, React Query, NestJS 11, Prisma 7, PostgreSQL 16, Redis 7, MinIO, Passport JWT, Docker Compose, pnpm 10.

---

## File Structure

### Root
- Create: `water-erp/package.json`
- Create: `water-erp/pnpm-workspace.yaml`
- Create: `water-erp/docker-compose.yml`
- Create: `water-erp/.env`

### apps/api
- Create: `water-erp/apps/api/package.json`
- Create: `water-erp/apps/api/tsconfig.json`
- Create: `water-erp/apps/api/tsconfig.build.json`
- Create: `water-erp/apps/api/nest-cli.json`
- Create: `water-erp/apps/api/prisma/schema.prisma`
- Create: `water-erp/apps/api/prisma/seed.ts`
- Create: `water-erp/apps/api/src/main.ts`
- Create: `water-erp/apps/api/src/app.module.ts`
- Create: `water-erp/apps/api/src/prisma/prisma.module.ts`
- Create: `water-erp/apps/api/src/prisma/prisma.service.ts`
- Create: `water-erp/apps/api/src/auth/auth.module.ts`
- Create: `water-erp/apps/api/src/auth/auth.controller.ts`
- Create: `water-erp/apps/api/src/auth/auth.service.ts`
- Create: `water-erp/apps/api/src/auth/auth.guard.ts`
- Create: `water-erp/apps/api/src/auth/admin.guard.ts`
- Create: `water-erp/apps/api/src/auth/auth.types.ts`
- Create: `water-erp/apps/api/src/auth/current-user.decorator.ts`
- Create: `water-erp/apps/api/src/auth/dto/login.dto.ts`
- Create: `water-erp/apps/api/src/auth/dto/register.dto.ts`
- Create: `water-erp/apps/api/src/bid/bid.module.ts`
- Create: `water-erp/apps/api/src/bid/bid.controller.ts`
- Create: `water-erp/apps/api/src/bid/bid.service.ts`
- Create: `water-erp/apps/api/src/bid/dto/create-bid-project.dto.ts`
- Create: `water-erp/apps/api/src/bid/dto/update-bid-project.dto.ts`
- Create: `water-erp/apps/api/src/bid/dto/submit-bid.dto.ts`
- Create: `water-erp/apps/api/src/bid/dto/create-score.dto.ts`
- Create: `water-erp/apps/api/src/bid/dto/create-clarification.dto.ts`

### apps/web
- Create: `water-erp/apps/web/package.json`
- Create: `water-erp/apps/web/tsconfig.json`
- Create: `water-erp/apps/web/next.config.ts`
- Create: `water-erp/apps/web/postcss.config.mjs`
- Create: `water-erp/apps/web/src/app/globals.css`
- Create: `water-erp/apps/web/src/app/layout.tsx`
- Create: `water-erp/apps/web/src/app/page.tsx`
- Create: `water-erp/apps/web/src/app/login/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/layout.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/dashboard/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/submit/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/open/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/evaluate/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/supervise/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/bid/archive/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/procurement/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/expert/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/supplier/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/mall/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/notice/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/evaluation/page.tsx`
- Create: `water-erp/apps/web/src/app/(dashboard)/about/page.tsx`
- Create: `water-erp/apps/web/src/middleware.ts`
- Create: `water-erp/apps/web/src/components/app-shell.tsx`
- Create: `water-erp/apps/web/src/components/module-placeholder.tsx`
- Create: `water-erp/apps/web/src/lib/api.ts`
- Create: `water-erp/apps/web/src/lib/types.ts`
- Create: `water-erp/apps/web/src/lib/utils.ts`

---

### Task 1: Initialize Monorepo and Docker Infrastructure

**Files:**
- Create: `water-erp/package.json`
- Create: `water-erp/pnpm-workspace.yaml`
- Create: `water-erp/docker-compose.yml`
- Create: `water-erp/.env`

- [ ] **Step 1: Create project root and package.json**

```bash
mkdir -p water-erp
cd water-erp
```

```json
{
  "name": "water-erp",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "dev": "concurrently -n web,api -c blue,green \"pnpm dev:web\" \"pnpm dev:api\"",
    "dev:web": "pnpm --filter web dev",
    "dev:api": "pnpm --filter api start:dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "db:generate": "pnpm --filter api exec prisma generate",
    "db:migrate": "pnpm --filter api exec prisma migrate dev",
    "db:studio": "pnpm --filter api exec prisma studio",
    "db:seed": "pnpm --filter api exec prisma db seed",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f"
  },
  "devDependencies": {
    "concurrently": "^9.2.1"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - apps/*
  - packages/*

ignoredBuiltDependencies:
  - '@nestjs/core'
  - '@prisma/engines'
  - '@scarf/scarf'
  - esbuild
  - msgpackr-extract
  - prisma
  - sharp
  - unrs-resolver
```

- [ ] **Step 3: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: water-erp-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: water_erp
      POSTGRES_PASSWORD: water_erp_dev
      POSTGRES_DB: water_erp
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U water_erp -d water_erp"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: water-erp-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: water-erp-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: water_erp_minio
      MINIO_ROOT_PASSWORD: water_erp_minio_dev
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

volumes:
  postgres-data:
  redis-data:
  minio-data:
```

- [ ] **Step 4: Create .env**

```
DATABASE_URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp?schema=public"
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=water-erp-jwt-secret-change-in-production
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=water_erp_minio
MINIO_SECRET_KEY=water_erp_minio_dev
```

- [ ] **Step 5: Create packages placeholders and install**

```bash
mkdir -p packages/config packages/ui apps/web apps/api
```

`packages/config/package.json`:
```json
{ "name": "config", "private": true, "version": "0.0.0" }
```

`packages/ui/package.json`:
```json
{ "name": "ui", "private": true, "version": "0.0.0" }
```

```bash
pnpm install
```

- [ ] **Step 6: Start Docker infrastructure**

```bash
docker compose up -d
```

Expected: 3 containers running (postgres, redis, minio).

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: initialize water-erp monorepo with Docker infrastructure"
```

---

### Task 2: Initialize NestJS API

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create apps/api/package.json**

```json
{
  "name": "api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/config": "^4.0.3",
    "@nestjs/core": "^11.0.1",
    "@nestjs/jwt": "^11.0.2",
    "@nestjs/passport": "^11.0.5",
    "@nestjs/platform-express": "^11.0.1",
    "@nestjs/swagger": "^11.2.6",
    "@prisma/client": "^7.7.0",
    "bcryptjs": "^3.0.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.4",
    "cookie-parser": "^1.4.7",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@types/cookie-parser": "^1.4.10",
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/passport-jwt": "^4.0.1",
    "prisma": "^7.7.0",
    "tsx": "^4.21.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

- [ ] **Step 3: Create nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: Create src/main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: ['http://localhost:3002', 'http://127.0.0.1:3002'],
    credentials: true,
  });
  await app.listen(4001);
  console.log('API running on http://localhost:4001');
}
bootstrap();
```

- [ ] **Step 5: Create src/app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BidModule } from './bid/bid.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BidModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Install and verify**

```bash
cd water-erp
pnpm install
cd apps/api
npx nest build
```

Expected: build succeeds, `dist/main.js` created.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize NestJS API with base configuration"
```

---

### Task 3: Prisma Schema and Database

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`
- Create: `apps/api/src/prisma/prisma.service.ts`

- [ ] **Step 1: Create prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── 基础 ──

model Department {
  id   String @id @default(cuid())
  name String @unique
  code String? @unique
  users User[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id           String     @id @default(cuid())
  username     String     @unique
  displayName  String
  email        String?
  passwordHash String?
  role         String     @default("internal_user")
  isActive     Boolean    @default(true)
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}

// ── 开评标 ──

enum BidStage {
  DOWNLOAD
  SUBMIT
  OPENING
  EVALUATING
  ARCHIVED
}

enum DecryptStatus {
  PENDING
  RUNNING
  SUCCESS
  DANGER
}

enum ConfirmStatus {
  CONFIRMED
  PENDING
  EXCEPTION
}

enum ScoreCategory {
  QUALIFICATION
  RESPONSIVE
  BUSINESS
  TECHNICAL
  PRICE
}

enum ArchiveStatus {
  ARCHIVED
  PENDING_CONFIRM
  NOT_STARTED
}

model BidProject {
  id               String    @id @default(cuid())
  projectCode      String    @unique
  name             String
  procurementMethod String
  openTime         DateTime
  deadline         DateTime
  stage            BidStage  @default(DOWNLOAD)
  riskNote         String?
  suppliers        BidSupplier[]
  openingSession   BidOpeningSession?
  openingRecords   BidOpeningRecord[]
  experts          BidExpert[]
  scoreItems       BidScoreItem[]
  clarifications   BidClarification[]
  supervisionLogs  BidSupervisionLog[]
  archiveItems     BidArchiveItem[]
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([stage])
}

model BidSupplier {
  id             String        @id @default(cuid())
  projectId      String
  supplierName   String
  downloadStatus String        @default("待下载")
  submitStatus   String        @default("待提交")
  encryptStatus  String        @default("待校验")
  receiptNo      String?
  decryptStatus  DecryptStatus @default(PENDING)
  confirmStatus  ConfirmStatus @default(PENDING)
  project        BidProject    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@unique([projectId, supplierName])
}

model BidOpeningSession {
  id                String   @id @default(cuid())
  projectId         String   @unique
  host              String
  supervisor        String
  status            String   @default("待开标")
  decryptWindowStart DateTime
  decryptWindowEnd  DateTime
  remainingSeconds  Int      @default(0)
  project           BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model BidOpeningRecord {
  id            String   @id @default(cuid())
  projectId     String
  supplierName  String
  amount        String
  period        String
  qualityTarget String
  bondStatus    String
  decryptResult String
  confirmStatus String
  project       BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt     DateTime   @default(now())
}

model BidExpert {
  id                String   @id @default(cuid())
  projectId         String
  expertName        String
  major             String
  signedIn          Boolean  @default(false)
  avoidanceConfirmed Boolean @default(false)
  progress          Int      @default(0)
  totalScore        Decimal  @default("0") @db.Decimal(5, 1)
  project           BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scoreRecords      BidScoreRecord[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model BidScoreItem {
  id        String        @id @default(cuid())
  projectId String
  category  ScoreCategory
  name      String
  maxScore  Decimal       @default("0") @db.Decimal(5, 1)
  project   BidProject    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scoreRecords BidScoreRecord[]
  createdAt DateTime @default(now())
}

model BidScoreRecord {
  id          String      @id @default(cuid())
  expertId    String
  scoreItemId String
  score       Decimal     @db.Decimal(5, 1)
  reason      String?
  expert      BidExpert   @relation(fields: [expertId], references: [id], onDelete: Cascade)
  scoreItem   BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  createdAt   DateTime    @default(now())
}

model BidClarification {
  id           String   @id @default(cuid())
  projectId    String
  question     String
  issuer       String
  supplierName String
  status       String   @default("待回复")
  reply        String?
  project      BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}

model BidSupervisionLog {
  id        String   @id @default(cuid())
  projectId String
  time      DateTime
  role      String
  target    String
  action    String
  result    String
  riskFlag  String   @default("无")
  project   BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt DateTime   @default(now())
}

model BidArchiveItem {
  id          String        @id @default(cuid())
  projectId   String
  name        String
  ownerRole   String
  status      ArchiveStatus @default(NOT_STARTED)
  hashDigest  String?
  archivedAt  DateTime?
  project     BidProject    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
```

- [ ] **Step 2: Create prisma/seed.ts**

```typescript
import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 部门
  const dept = await prisma.department.upsert({
    where: { name: '采购中心' },
    update: {},
    create: { name: '采购中心', code: 'PROC' },
  });

  // 用户
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      displayName: '系统管理员',
      passwordHash: hashSync('admin123', 10),
      role: 'admin',
      departmentId: dept.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'lizhuren' },
    update: {},
    create: {
      username: 'lizhuren',
      displayName: '李主任',
      passwordHash: hashSync('123456', 10),
      role: 'bid_host',
      departmentId: dept.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'wangjg' },
    update: {},
    create: {
      username: 'wangjg',
      displayName: '王建国',
      passwordHash: hashSync('123456', 10),
      role: 'bid_expert',
      departmentId: dept.id,
    },
  });

  // 开评标演示项目
  const project = await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0518',
      name: '2026年度水利工程物资集中采购',
      procurementMethod: '公开招标',
      openTime: new Date('2026-06-08T09:30:00'),
      deadline: new Date('2026-06-08T09:00:00'),
      stage: 'OPENING',
      riskNote: '解密窗口进行中',
      suppliers: {
        create: [
          { supplierName: '四川川水建设工程有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-001', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
          { supplierName: '成都华西物资供应有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-002', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
          { supplierName: '四川智水科技有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-003', decryptStatus: 'RUNNING', confirmStatus: 'PENDING' },
          { supplierName: '四川宏达水利工程有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-004', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' },
          { supplierName: '成都诚信建材有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-005', decryptStatus: 'PENDING', confirmStatus: 'PENDING' },
        ],
      },
      openingSession: {
        create: {
          host: '采购中心-李主任',
          supervisor: '纪检监督-周老师',
          status: '解密中',
          decryptWindowStart: new Date('2026-06-08T09:30:00'),
          decryptWindowEnd: new Date('2026-06-08T10:00:00'),
          remainingSeconds: 1122,
        },
      },
      openingRecords: {
        create: [
          { supplierName: '四川川水建设工程有限公司', amount: '1260.00万元', period: '120日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '已确认' },
          { supplierName: '成都华西物资供应有限公司', amount: '1288.50万元', period: '118日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '已确认' },
          { supplierName: '四川智水科技有限公司', amount: '1320.00万元', period: '115日历天', qualityTarget: '合格', bondStatus: '电子保函', decryptResult: '解密中', confirmStatus: '待确认' },
        ],
      },
      experts: {
        create: [
          { expertName: '王建国', major: '水利工程', signedIn: true, avoidanceConfirmed: true, progress: 92, totalScore: 91.6 },
          { expertName: '刘晓梅', major: '机电设备', signedIn: true, avoidanceConfirmed: true, progress: 86, totalScore: 89.4 },
          { expertName: '陈志强', major: '造价咨询', signedIn: true, avoidanceConfirmed: true, progress: 78, totalScore: 88.1 },
        ],
      },
      scoreItems: {
        create: [
          { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
          { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
          { category: 'BUSINESS', name: '商务评分', maxScore: 20 },
          { category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
          { category: 'PRICE', name: '价格评分', maxScore: 30 },
        ],
      },
      clarifications: {
        create: [
          { question: '请说明主要设备交货计划与施工节点衔接安排。', issuer: '王建国', supplierName: '四川智水科技有限公司', status: '已回复', reply: '已补充交货计划说明，不改变投标实质内容。' },
        ],
      },
      supervisionLogs: {
        create: [
          { time: new Date('2026-06-08T08:55:00'), role: '系统', target: '投标文件', action: '投标截止自动锁定', result: '成功', riskFlag: '无' },
          { time: new Date('2026-06-08T09:30:00'), role: '开标主持人', target: '在线开标大厅', action: '启动开标', result: '成功', riskFlag: '无' },
          { time: new Date('2026-06-08T09:42:00'), role: '供应商', target: '投标文件解密', action: '证书校验失败', result: '异常', riskFlag: '投标人原因待确认' },
          { time: new Date('2026-06-08T10:05:00'), role: '专家', target: '技术评分', action: '提交评分', result: '成功', riskFlag: '存在偏差提醒' },
        ],
      },
      archiveItems: {
        create: [
          { name: '招标文件定稿', ownerRole: '招标管理端', status: 'ARCHIVED', hashDigest: 'SHA256-A19C8E', archivedAt: new Date('2026-06-08T08:30:00') },
          { name: '招标文件下载日志', ownerRole: '供应商端', status: 'ARCHIVED', hashDigest: 'SHA256-B72F31', archivedAt: new Date('2026-06-08T08:31:00') },
          { name: '投标文件提交回执', ownerRole: '供应商端', status: 'ARCHIVED', hashDigest: 'SHA256-C08A92', archivedAt: new Date('2026-06-08T09:00:00') },
          { name: '在线开标记录', ownerRole: '开标主持端', status: 'ARCHIVED', hashDigest: 'SHA256-D55E02', archivedAt: new Date('2026-06-08T10:05:00') },
          { name: '专家评分汇总表', ownerRole: '专家评标端', status: 'NOT_STARTED' },
          { name: '评标报告', ownerRole: '专家评标端', status: 'PENDING_CONFIRM' },
          { name: '结果公示截图', ownerRole: '归档端', status: 'NOT_STARTED' },
        ],
      },
    },
  });

  console.log(`Seeded: project ${project.projectCode}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Create Prisma service files**

`src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

`src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 4: Generate Prisma client and run migration**

```bash
cd apps/api
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

Expected: migration applied, seed data inserted.

- [ ] **Step 5: Verify API starts**

```bash
cd ../..
pnpm dev:api
```

Expected: "API running on http://localhost:4001".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, migration, seed data, and Prisma service"
```

---

### Task 4: Auth Module (Backend)

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.guard.ts`
- Create: `apps/api/src/auth/admin.guard.ts`
- Create: `apps/api/src/auth/auth.types.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/dto/register.dto.ts`

- [ ] **Step 1: Create DTOs**

`src/auth/dto/login.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
```

`src/auth/dto/register.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}
```

- [ ] **Step 2: Create auth.types.ts**

```typescript
export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}
```

- [ ] **Step 3: Create current-user.decorator.ts**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
```

- [ ] **Step 4: Create auth.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(dto: RegisterDto) {
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: dto.email,
        passwordHash: hashSync(dto.password, 10),
      },
    });
    return this.issueToken(user.id, user.username, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !user.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      return null;
    }
    return this.issueToken(user.id, user.username, user.role);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true },
    });
  }

  private issueToken(sub: string, username: string, role: string) {
    const access_token = this.jwt.sign({ sub, username, role });
    return { access_token };
  }
}
```

- [ ] **Step 5: Create auth.controller.ts**

```typescript
import { Controller, Post, Get, Body, Res, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    res.cookie('token', result.access_token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if (!result) return { error: '用户名或密码错误' };
    res.cookie('token', result.access_token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token');
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }
}
```

- [ ] **Step 6: Create auth.guard.ts and admin.guard.ts**

`src/auth/auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.token as string | undefined;
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      (req as any).user = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
```

`src/auth/admin.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.token as string | undefined;
    if (!token) throw new ForbiddenException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload.role !== 'admin') throw new ForbiddenException();
      (req as any).user = payload;
    } catch (e) {
      throw e instanceof ForbiddenException ? e : new ForbiddenException();
    }
    return true;
  }
}
```

- [ ] **Step 7: Create auth.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'water-erp-jwt-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 8: Verify auth endpoints**

```bash
# Restart API
pnpm dev:api

# Test register
curl -X POST http://localhost:4001/api/auth/register -H "Content-Type: application/json" -d '{"username":"test","displayName":"Test","password":"123456"}'

# Test login
curl -X POST http://localhost:4001/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' -v
```

Expected: JWT token returned and set in cookie.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add auth module with JWT login, register, logout, and guards"
```

---

### Task 5: Bid Module (Backend)

**Files:**
- Create: `apps/api/src/bid/bid.module.ts`
- Create: `apps/api/src/bid/bid.controller.ts`
- Create: `apps/api/src/bid/bid.service.ts`
- Create: `apps/api/src/bid/dto/create-bid-project.dto.ts`
- Create: `apps/api/src/bid/dto/update-bid-project.dto.ts`
- Create: `apps/api/src/bid/dto/submit-bid.dto.ts`
- Create: `apps/api/src/bid/dto/create-score.dto.ts`
- Create: `apps/api/src/bid/dto/create-clarification.dto.ts`

- [ ] **Step 1: Create DTOs**

`src/bid/dto/create-bid-project.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class CreateBidProjectDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() procurementMethod: string;
  @IsDateString() openTime: string;
  @IsDateString() deadline: string;
  @IsString() @IsOptional() riskNote?: string;
}
```

`src/bid/dto/update-bid-project.dto.ts`:
```typescript
import { IsString, IsOptional } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() stage?: string;
  @IsString() @IsOptional() riskNote?: string;
}
```

`src/bid/dto/submit-bid.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitBidDto {
  @IsString() @IsNotEmpty() supplierName: string;
}
```

`src/bid/dto/create-score.dto.ts`:
```typescript
import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateScoreDto {
  @IsString() expertId: string;
  @IsString() scoreItemId: string;
  @IsNumber() score: number;
  @IsString() @IsOptional() reason?: string;
}
```

`src/bid/dto/create-clarification.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateClarificationDto {
  @IsString() @IsNotEmpty() question: string;
  @IsString() @IsNotEmpty() issuer: string;
  @IsString() @IsNotEmpty() supplierName: string;
}
```

- [ ] **Step 2: Create bid.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';

@Injectable()
export class BidService {
  constructor(private prisma: PrismaService) {}

  // ── Projects ──

  listProjects() {
    return this.prisma.bidProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
  }

  getProject(id: string) {
    return this.prisma.bidProject.findUnique({
      where: { id },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: true } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'desc' } },
        archiveItems: true,
      },
    });
  }

  createProject(dto: CreateBidProjectDto) {
    return this.prisma.bidProject.create({
      data: {
        name: dto.name,
        projectCode: `BID-${Date.now()}`,
        procurementMethod: dto.procurementMethod,
        openTime: new Date(dto.openTime),
        deadline: new Date(dto.deadline),
        riskNote: dto.riskNote,
      },
    });
  }

  updateProject(id: string, dto: UpdateBidProjectDto) {
    return this.prisma.bidProject.update({
      where: { id },
      data: { ...(dto.stage && { stage: dto.stage as any }), ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }) },
    });
  }

  // ── Suppliers ──

  listSuppliers(projectId: string) {
    return this.prisma.bidSupplier.findMany({ where: { projectId } });
  }

  submitBid(projectId: string, dto: SubmitBidDto) {
    const receiptNo = `TB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
    return this.prisma.bidSupplier.create({
      data: {
        projectId,
        supplierName: dto.supplierName,
        downloadStatus: '已下载',
        submitStatus: '已提交',
        encryptStatus: '密文已校验',
        receiptNo,
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
      },
    });
  }

  // ── Opening ──

  startOpening(projectId: string) {
    return this.prisma.bidProject.update({
      where: { id: projectId },
      data: { stage: 'OPENING' },
    });
  }

  decryptSupplier(projectId: string, supplierId: string) {
    return this.prisma.bidSupplier.update({
      where: { id: supplierId },
      data: { decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
    });
  }

  listOpeningRecords(projectId: string) {
    return this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
  }

  // ── Experts & Scores ──

  listExperts(projectId: string) {
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  submitScore(projectId: string, dto: CreateScoreDto) {
    return this.prisma.bidScoreRecord.create({
      data: {
        expertId: dto.expertId,
        scoreItemId: dto.scoreItemId,
        score: dto.score,
        reason: dto.reason,
      },
    });
  }

  listScores(projectId: string) {
    return this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });
  }

  // ── Clarifications ──

  listClarifications(projectId: string) {
    return this.prisma.bidClarification.findMany({ where: { projectId } });
  }

  createClarification(projectId: string, dto: CreateClarificationDto) {
    return this.prisma.bidClarification.create({
      data: { projectId, question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName },
    });
  }

  // ── Supervision ──

  listSupervisionLogs(projectId: string) {
    return this.prisma.bidSupervisionLog.findMany({ where: { projectId }, orderBy: { time: 'desc' } });
  }

  // ── Archive ──

  listArchives(projectId: string) {
    return this.prisma.bidArchiveItem.findMany({ where: { projectId } });
  }

  archiveAll(projectId: string) {
    const now = new Date();
    return this.prisma.bidArchiveItem.updateMany({
      where: { projectId, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED', hashDigest: `SHA256-${Date.now().toString(16).toUpperCase().slice(0, 6)}`, archivedAt: now },
    });
  }

  // ── Dashboard Stats ──

  getDashboardStats() {
    return this.prisma.bidProject.aggregate({ _count: true });
  }
}
```

- [ ] **Step 3: Create bid.controller.ts**

```typescript
import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { BidService } from './bid.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';

@Controller('bid')
@UseGuards(AuthGuard)
export class BidController {
  constructor(private bidService: BidService) {}

  // Projects
  @Get('projects')
  listProjects() { return this.bidService.listProjects(); }

  @Post('projects')
  createProject(@Body() dto: CreateBidProjectDto) { return this.bidService.createProject(dto); }

  @Get('projects/:id')
  getProject(@Param('id') id: string) { return this.bidService.getProject(id); }

  @Patch('projects/:id')
  updateProject(@Param('id') id: string, @Body() dto: UpdateBidProjectDto) { return this.bidService.updateProject(id, dto); }

  // Suppliers
  @Get('projects/:id/suppliers')
  listSuppliers(@Param('id') id: string) { return this.bidService.listSuppliers(id); }

  @Post('projects/:id/suppliers')
  submitBid(@Param('id') id: string, @Body() dto: SubmitBidDto) { return this.bidService.submitBid(id, dto); }

  // Opening
  @Post('projects/:id/open')
  startOpening(@Param('id') id: string) { return this.bidService.startOpening(id); }

  @Post('projects/:id/decrypt/:supplierId')
  decryptSupplier(@Param('id') id: string, @Param('supplierId') supplierId: string) { return this.bidService.decryptSupplier(id, supplierId); }

  @Get('projects/:id/opening-records')
  listOpeningRecords(@Param('id') id: string) { return this.bidService.listOpeningRecords(id); }

  // Experts & Scores
  @Get('projects/:id/experts')
  listExperts(@Param('id') id: string) { return this.bidService.listExperts(id); }

  @Post('projects/:id/scores')
  submitScore(@Param('id') id: string, @Body() dto: CreateScoreDto) { return this.bidService.submitScore(id, dto); }

  @Get('projects/:id/scores')
  listScores(@Param('id') id: string) { return this.bidService.listScores(id); }

  // Clarifications
  @Get('projects/:id/clarifications')
  listClarifications(@Param('id') id: string) { return this.bidService.listClarifications(id); }

  @Post('projects/:id/clarifications')
  createClarification(@Param('id') id: string, @Body() dto: CreateClarificationDto) { return this.bidService.createClarification(id, dto); }

  // Supervision
  @Get('projects/:id/supervision-logs')
  listSupervisionLogs(@Param('id') id: string) { return this.bidService.listSupervisionLogs(id); }

  // Archive
  @Get('projects/:id/archives')
  listArchives(@Param('id') id: string) { return this.bidService.listArchives(id); }

  @Post('projects/:id/archive-all')
  archiveAll(@Param('id') id: string) { return this.bidService.archiveAll(id); }
}
```

- [ ] **Step 4: Create bid.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { BidController } from './bid.controller';
import { BidService } from './bid.service';

@Module({
  controllers: [BidController],
  providers: [BidService],
})
export class BidModule {}
```

- [ ] **Step 5: Verify API endpoints**

```bash
pnpm dev:api
# In another terminal:
curl -b cookie.txt -c cookie.txt -X POST http://localhost:4001/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
curl -b cookie.txt http://localhost:4001/api/bid/projects
```

Expected: list of bid projects from seed data.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add bid module with full CRUD for projects, suppliers, scores, clarifications, archives"
```

---

### Task 6: Initialize Next.js Frontend

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/types.ts`
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002",
    "lint": "eslint ."
  },
  "dependencies": {
    "@tanstack/react-query": "^5.96.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.8.0",
    "next": "16.2.3",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^24.0.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  rewrites: [
    { source: '/api/:path*', destination: 'http://localhost:4001/:path*' },
  ],
};

export default nextConfig;
```

- [ ] **Step 4: Create postcss.config.mjs**

```javascript
const config = {
  plugins: ["@tailwindcss/postcss"],
};
export default config;
```

- [ ] **Step 5: Create globals.css**

```css
@import "tailwindcss";

:root {
  --primary: #064ea2;
  --primary-light: #0e62d0;
  --primary-dark: #042a58;
  --success: #11a874;
  --warning: #f5a623;
  --danger: #e74c3c;
  --bg: #f6f9fd;
  --card: #ffffff;
  --border: #e8f0fa;
  --text-primary: #18243a;
  --text-secondary: #5a6d8a;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text-primary);
}
```

- [ ] **Step 6: Create lib/api.ts**

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
};
```

- [ ] **Step 7: Create lib/types.ts**

```typescript
export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: string;
  isActive: boolean;
}

export interface BidProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  _count?: { suppliers: number };
}

export interface BidSupplier {
  id: string;
  supplierName: string;
  downloadStatus: string;
  submitStatus: string;
  encryptStatus: string;
  receiptNo?: string;
  decryptStatus: string;
  confirmStatus: string;
}

export interface BidExpert {
  id: string;
  expertName: string;
  major: string;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  progress: number;
  totalScore: number;
}

export interface BidScoreItem {
  id: string;
  category: string;
  name: string;
  maxScore: number;
}

export interface BidSupervisionLog {
  id: string;
  time: string;
  role: string;
  target: string;
  action: string;
  result: string;
  riskFlag: string;
}

export interface BidArchiveItem {
  id: string;
  name: string;
  ownerRole: string;
  status: string;
  hashDigest?: string;
  archivedAt?: string;
}

export interface BidClarification {
  id: string;
  question: string;
  issuer: string;
  supplierName: string;
  status: string;
  reply?: string;
}

export interface BidProjectDetail extends BidProject {
  suppliers: BidSupplier[];
  openingSession?: { host: string; supervisor: string; status: string; decryptWindowStart: string; decryptWindowEnd: string; remainingSeconds: number };
  openingRecords: { supplierName: string; amount: string; period: string; qualityTarget: string; bondStatus: string; decryptResult: string; confirmStatus: string }[];
  experts: BidExpert[];
  scoreItems: BidScoreItem[];
  clarifications: BidClarification[];
  supervisionLogs: BidSupervisionLog[];
  archiveItems: BidArchiveItem[];
}
```

- [ ] **Step 8: Create lib/utils.ts**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9: Create src/app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '智慧水发·招采ERP系统',
  description: '四川水发集团电子化招标采购平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Create src/app/page.tsx (homepage redirect)**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

- [ ] **Step 11: Create src/middleware.ts**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/api'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 12: Install dependencies and verify**

```bash
cd ../..
pnpm install
pnpm dev:web
```

Expected: Next.js running on http://localhost:3002, redirects to /login.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js frontend with Tailwind, API client, middleware auth"
```

---

### Task 7: Login Page and App Shell

**Files:**
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/(dashboard)/layout.tsx`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Create login page**

`src/app/login/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`/api/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(isLogin ? { username: form.username, password: form.password } : form),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      router.push('/dashboard');
    } catch { setError('请求失败'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#042a58] via-[#064ea2] to-[#073a78]">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#18243a]">智慧水发·招采ERP系统</h1>
          <p className="text-sm text-[#5a6d8a] mt-2">{isLogin ? '登录您的账户' : '注册新账户'}</p>
        </div>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="用户名" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          {!isLogin && (
            <input type="text" placeholder="显示名称" required value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          )}
          <input type="password" placeholder="密码" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className="w-full px-4 py-3 border border-[#e8f0fa] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064ea2]" />
          <button type="submit" className="w-full py-3 bg-[#064ea2] text-white font-bold rounded-lg hover:bg-[#0e62d0] transition">
            {isLogin ? '登 录' : '注 册'}
          </button>
        </form>
        <p className="text-center text-sm text-[#5a6d8a] mt-6">
          {isLogin ? '没有账户？' : '已有账户？'}
          <button onClick={() => setIsLogin(!isLogin)} className="text-[#064ea2] font-semibold ml-1">{isLogin ? '注册' : '登录'}</button>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create app-shell component**

`src/components/app-shell.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { User } from '@/lib/types';

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
  { label: '供应商管理', path: '/supplier', icon: '🏢' },
  { label: '电子商城', path: '/mall', icon: '🛒' },
  { label: '信息公告', path: '/notice', icon: '📢' },
  { label: '评价管理', path: '/evaluation', icon: '⭐' },
  { label: '关于我们', path: '/about', icon: 'ℹ️' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-gradient-to-b from-[#042a58] to-[#064ea2] text-white flex-shrink-0 transition-all duration-300 flex flex-col`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          {!collapsed && <span className="font-bold text-sm">智慧水发 · ERP</span>}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto text-white/60 hover:text-white">{collapsed ? '→' : '←'}</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map(item => (
            <div key={item.label}>
              {item.children ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 text-white/70 text-sm font-semibold px-2 py-1">
                    <span>{item.icon}</span>{!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && item.children.map(child => (
                    <button key={child.path} onClick={() => router.push(child.path)}
                      className={`block w-full text-left px-8 py-2 text-sm rounded transition ${isActive(child.path) ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/8'}`}>
                      {child.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => router.push(item.path!)}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition ${isActive(item.path!) ? 'bg-white/15 text-white font-semibold border-l-3 border-[#39a8ff]' : 'text-white/60 hover:text-white hover:bg-white/8'}`}>
                  <span>{item.icon}</span>{!collapsed && <span>{item.label}</span>}
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white shadow-sm flex items-center justify-between px-6 flex-shrink-0">
          <span className="text-sm text-[#5a6d8a]">{pathname}</span>
          <div className="flex items-center gap-4">
            {user && <span className="text-sm font-semibold text-[#18243a]">{user.displayName}</span>}
            <button onClick={logout} className="text-sm text-[#5a6d8a] hover:text-[#064ea2]">退出</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-[#f6f9fd] p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create dashboard layout and page**

`src/app/(dashboard)/layout.tsx`:
```tsx
import AppShell from '@/components/app-shell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

`src/app/(dashboard)/dashboard/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/types';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-2">欢迎回来，{user?.displayName || '...'}</h1>
      <p className="text-[#5a6d8a] mb-8">智慧水发招采ERP系统管理后台</p>
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '开评标管理', desc: '在线开标、专家评审、监督归档', path: '/bid', color: 'from-blue-600 to-blue-800' },
          { label: '采购管理', desc: '立项申请、项目管理、招标文件', path: '/procurement', color: 'from-cyan-600 to-cyan-800' },
          { label: '专家管理', desc: '专家库、专家抽取、专家评价', path: '/expert', color: 'from-purple-600 to-purple-800' },
          { label: '供应商管理', desc: '注册审核、供应商库、评价', path: '/supplier', color: 'from-green-600 to-green-800' },
          { label: '电子商城', desc: '集中采购、员工内购、商家入驻', path: '/mall', color: 'from-orange-500 to-orange-700' },
          { label: '信息公告', desc: '招标公告、中标公示、政策法规', path: '/notice', color: 'from-teal-600 to-teal-800' },
          { label: '评价管理', desc: '评价列表、发起评价、统计', path: '/evaluation', color: 'from-pink-600 to-pink-800' },
          { label: '关于我们', desc: '平台介绍、联系方式', path: '/about', color: 'from-gray-600 to-gray-800' },
        ].map(item => (
          <button key={item.path} onClick={() => router.push(item.path)}
            className="bg-white rounded-xl p-6 border border-[#e8f0fa] hover:shadow-lg hover:-translate-y-1 transition-all text-left">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${item.color} mb-4`} />
            <h3 className="font-bold text-[#18243a] mb-1">{item.label}</h3>
            <p className="text-xs text-[#5a6d8a]">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify login flow**

```bash
pnpm dev:web
```

Open http://localhost:3002 → redirects to /login → login with admin/admin123 → redirects to /dashboard with sidebar.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add login page, app shell with sidebar, dashboard home"
```

---

### Task 8: Bid Frontend Pages (6 Workbenches)

**Files:**
- Create: `apps/web/src/app/(dashboard)/bid/page.tsx`
- Create: `apps/web/src/app/(dashboard)/bid/submit/page.tsx`
- Create: `apps/web/src/app/(dashboard)/bid/open/page.tsx`
- Create: `apps/web/src/app/(dashboard)/bid/evaluate/page.tsx`
- Create: `apps/web/src/app/(dashboard)/bid/supervise/page.tsx`
- Create: `apps/web/src/app/(dashboard)/bid/archive/page.tsx`

- [ ] **Step 1: Create `/bid` Dashboard page**

`src/app/(dashboard)/bid/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProject } from '@/lib/types';

export default function BidDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<BidProject[]>([]);

  useEffect(() => {
    api.get<BidProject[]>('/bid/projects').then(setProjects).catch(() => {});
  }, []);

  const stageLabel: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标', EVALUATING: '专家评标', ARCHIVED: '资料归档' };
  const stageColor: Record<string, string> = { DOWNLOAD: '#064ea2', SUBMIT: '#064ea2', OPENING: '#f5a623', EVALUATING: '#064ea2', ARCHIVED: '#11a874' };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#18243a]">开评标系统</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">统一入口、多端协同、安全可控、限时开标、独立评审、全程留痕</p>
        </div>
        <button onClick={() => router.push('/bid/open')} className="px-5 py-2 bg-[#064ea2] text-white rounded-lg font-semibold hover:bg-[#0e62d0] transition">进入在线开标大厅</button>
      </div>

      <div className="flex gap-4 mb-6">
        {['供应商端', '开标主持端', '专家评标端', '监督端', '归档端'].map((label, i) => {
          const paths = ['/bid/submit', '/bid/open', '/bid/evaluate', '/bid/supervise', '/bid/archive'];
          const descs = ['插件授权、加密投递', '在线解密、开标记录', '独立评分、报告确认', '日志追溯、不可干预', '资料归档、防篡改'];
          return (
            <button key={label} onClick={() => router.push(paths[i])} className="flex-1 bg-white rounded-xl p-4 border border-[#e8f0fa] hover:shadow-md hover:-translate-y-1 transition text-left">
              <h3 className="font-bold text-[#18243a] mb-1">{label}</h3>
              <p className="text-xs text-[#5a6d8a]">{descs[i]}</p>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-lg text-[#18243a] mb-4">项目状态</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-3">项目编号</th><th className="pb-3">项目名称</th><th className="pb-3">开标时间</th><th className="pb-3">阶段</th><th className="pb-3">风险提示</th></tr></thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-[#e8f0fa] hover:bg-[#f8fbff] cursor-pointer" onClick={() => router.push('/bid/open')}>
                <td className="py-3 text-[#064ea2] font-semibold">{p.projectCode}</td>
                <td className="py-3">{p.name}</td>
                <td className="py-3 text-[#5a6d8a]">{new Date(p.openTime).toLocaleString('zh-CN')}</td>
                <td className="py-3"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: stageColor[p.stage], backgroundColor: stageColor[p.stage] + '18' }}>{stageLabel[p.stage]}</span></td>
                <td className="py-3 text-[#5a6d8a]">{p.riskNote || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `/bid/submit` page**

`src/app/(dashboard)/bid/submit/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidSubmitPage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">供应商端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">企业唯一安全组件、招标文件受控下载、投标文件加密上传与回执</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">招标文件受控下载</h2>
          <div className="bg-[#f8fbff] rounded-lg p-4 text-sm text-[#5a6d8a]">
            <p>文件：{project.projectCode} 招标文件.ofd</p>
            <p>水印：动态水印已嵌入</p>
            <p>哈希：SHA256-A19C8E</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">投标文件加密投递</h2>
          <div className="border-2 border-dashed border-[#e8f0fa] rounded-lg p-8 text-center text-[#5a6d8a]">
            <p className="text-lg mb-2">拖拽投标文件到此处</p>
            <p className="text-xs">演示流程：本地签章 → 哈希计算 → 加密上传 → 生成回执</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">投标状态</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">投标单位</th><th className="pb-2">投递状态</th><th className="pb-2">加密状态</th><th className="pb-2">回执编号</th></tr></thead>
          <tbody>{project.suppliers.slice(0, 1).map(s => (
            <tr key={s.id} className="border-b border-[#e8f0fa]"><td className="py-2">{s.supplierName}</td><td className="py-2">{s.submitStatus}</td><td className="py-2">{s.encryptStatus}</td><td className="py-2 text-[#064ea2]">{s.receiptNo}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `/bid/open` page**

`src/app/(dashboard)/bid/open/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidOpenPage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const session = project.openingSession;
  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '解密成功', DANGER: '异常' };
  const decryptColor: Record<string, string> = { PENDING: '#f5a623', RUNNING: '#064ea2', SUCCESS: '#11a874', DANGER: '#e74c3c' };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">在线开标大厅</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">到时自动提取投标文件，提示投标人在线解密，生成开标记录</p>

      {session && (
        <div className="bg-gradient-to-r from-[#063f82] to-[#0a7ed3] text-white rounded-xl p-6 mb-4 flex items-center gap-6">
          <div className="text-4xl">⚖️</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-1">{project.name}</h2>
            <p className="text-white/80 text-sm">开标时间：{new Date(project.openTime).toLocaleString('zh-CN')} ｜ 主持人：{session.host} ｜ 监督人：{session.supervisor}</p>
          </div>
          <div className="bg-white/15 rounded-lg p-4 text-center"><span className="text-xs text-white/80">状态</span><div className="text-lg font-bold">{session.status}</div></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5 mb-4">
        <h2 className="font-bold text-[#18243a] mb-3">投标人在线解密状态</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">投标单位</th><th className="pb-2">投标回执</th><th className="pb-2">密文状态</th><th className="pb-2">解密状态</th><th className="pb-2">确认状态</th></tr></thead>
          <tbody>{project.suppliers.map(s => (
            <tr key={s.id} className="border-b border-[#e8f0fa]">
              <td className="py-2">{s.supplierName}</td>
              <td className="py-2 text-[#064ea2]">{s.receiptNo}</td>
              <td className="py-2">{s.encryptStatus}</td>
              <td className="py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: decryptColor[s.decryptStatus], backgroundColor: decryptColor[s.decryptStatus] + '18' }}>{decryptLabel[s.decryptStatus]}</span></td>
              <td className="py-2 text-[#5a6d8a]">{s.confirmStatus === 'CONFIRMED' ? '已确认' : s.confirmStatus === 'EXCEPTION' ? '异常待处理' : '待确认'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">开标记录</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">供应商</th><th className="pb-2">报价</th><th className="pb-2">工期</th><th className="pb-2">质量</th><th className="pb-2">保证金</th><th className="pb-2">确认</th></tr></thead>
          <tbody>{project.openingRecords.map((r, i) => (
            <tr key={i} className="border-b border-[#e8f0fa]"><td className="py-2">{r.supplierName}</td><td className="py-2 font-semibold">{r.amount}</td><td className="py-2">{r.period}</td><td className="py-2">{r.qualityTarget}</td><td className="py-2">{r.bondStatus}</td><td className="py-2">{r.confirmStatus}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `/bid/evaluate` page**

`src/app/(dashboard)/bid/evaluate/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidEvaluatePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [activeSupplier, setActiveSupplier] = useState('');

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(p => { setProject(p); setActiveSupplier(p.suppliers[0]?.supplierName || ''); });
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const totalScore = project.scoreItems.reduce((sum, item) => sum + Number(item.maxScore), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">专家评标端</h1>
      <p className="text-sm text-[#5a6d8a] mb-4">身份核验、保密承诺、回避确认后进入独立评审</p>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-4 mb-4">
        <div className="flex gap-8 text-sm">
          {['身份核验 ✓', '保密承诺 ✓', '回避确认 ✓', '评标纪律 ✓'].map(s => <span key={s} className="text-[#11a874] font-semibold">{s}</span>)}
        </div>
      </div>

      <div className="grid grid-cols-[260px_1fr_360px] gap-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-4">
          <h2 className="font-bold text-sm text-[#18243a] mb-3">投标单位</h2>
          {project.suppliers.map(s => (
            <button key={s.id} onClick={() => setActiveSupplier(s.supplierName)}
              className={`block w-full text-left p-3 rounded-lg mb-2 text-sm border transition ${activeSupplier === s.supplierName ? 'border-[#064ea2] bg-[#eef6ff]' : 'border-[#e8f0fa] hover:border-[#b8d4f5]'}`}>
              <div className="font-semibold">{s.supplierName}</div>
              <div className="text-xs text-[#5a6d8a] mt-1">{s.encryptStatus} ｜ {s.confirmStatus === 'CONFIRMED' ? '已确认' : '待确认'}</div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-[#18243a]">文件与响应摘要</h2><span className="text-sm text-[#064ea2] font-semibold">{activeSupplier}</span></div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {['资格文件：已提交', '技术响应：完整', '商务报价：有效区间'].map(t => (
              <div key={t} className="bg-[#f8fbff] rounded-lg p-4 text-sm"><div className="font-semibold text-[#18243a]">{t.split('：')[0]}</div><div className="text-[#5a6d8a] mt-1">{t.split('：')[1]}</div></div>
            ))}
          </div>
          {project.clarifications.length > 0 && (
            <div className="bg-[#fff8e8] rounded-lg p-4">
              <h3 className="font-bold text-sm mb-2">澄清说明</h3>
              {project.clarifications.map(c => <p key={c.id} className="text-sm text-[#5a6d8a]">{c.question} —— {c.status}：{c.reply}</p>)}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-[#18243a]">评分表</h2><span className="text-xs text-[#11a874] font-semibold">本人独立评分</span></div>
          {project.scoreItems.map(item => (
            <div key={item.id} className="border-b border-[#e8f0fa] py-3">
              <div className="flex justify-between text-sm text-[#5a6d8a] mb-2"><strong>{item.name}</strong><span>{item.maxScore > 0 ? `满分 ${item.maxScore}` : item.category === 'QUALIFICATION' ? '通过' : '通过'}</span></div>
            </div>
          ))}
          <div className="py-3 text-[#18243a]">总分满分：<strong className="text-xl text-[#064ea2]">{totalScore}</strong></div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `/bid/supervise` page**

`src/app/(dashboard)/bid/supervise/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidSupervisePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">监督端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">可监督、不可干预：查看节点、日志、异常和证据链，不修改评分或敏感文件</p>

      <div className="bg-gradient-to-r from-[#f8fbff] to-[#eef6ff] rounded-xl border border-[#e8f0fa] p-5 mb-4 flex items-center gap-4">
        <div className="text-3xl">👁️</div>
        <div className="flex-1"><h2 className="font-bold text-[#18243a] mb-1">监督权限边界</h2><p className="text-sm text-[#5a6d8a]">监督人员可查看过程、日志和异常，但不具备开标前查看明文、修改评分、替专家提交意见的能力。</p></div>
        <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-bold rounded">禁止干预评分</span>
      </div>

      <div className="grid grid-cols-[1fr_0.8fr] gap-4 mb-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-4">过程时间线</h2>
          <div className="space-y-4">
            {project.supervisionLogs.map(log => (
              <div key={log.id} className="flex gap-3 items-start">
                <div className="w-2 h-2 rounded-full bg-[#064ea2] mt-2 flex-shrink-0" />
                <div><div className="text-xs text-[#5a6d8a]">{new Date(log.time).toLocaleString('zh-CN')}</div><div className="text-sm">{log.role} · {log.action}（{log.result}）</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-4">异常事件</h2>
          <div className="bg-[#fff8e8] rounded-lg p-4 text-sm text-[#8a6d3b] mb-3">⚠️ 四川宏达水利工程有限公司解密证书校验失败</div>
          <div className="bg-[#e8f4fd] rounded-lg p-4 text-sm text-[#3a6d8a]">ℹ️ 专家技术评分偏离平均值，已要求填写确认理由</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">监督日志</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">时间</th><th className="pb-2">角色</th><th className="pb-2">对象</th><th className="pb-2">操作</th><th className="pb-2">结果</th><th className="pb-2">风险标记</th></tr></thead>
          <tbody>{project.supervisionLogs.map(log => (
            <tr key={log.id} className="border-b border-[#e8f0fa]"><td className="py-2 text-[#5a6d8a]">{new Date(log.time).toLocaleString('zh-CN')}</td><td className="py-2">{log.role}</td><td className="py-2">{log.target}</td><td className="py-2">{log.action}</td><td className="py-2">{log.result}</td><td className="py-2">{log.riskFlag}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `/bid/archive` page**

`src/app/(dashboard)/bid/archive/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidArchivePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const archived = project.archiveItems.filter(a => a.status === 'ARCHIVED').length;
  const rate = Math.round((archived / project.archiveItems.length) * 100);
  const statusLabel: Record<string, string> = { ARCHIVED: '已归档', PENDING_CONFIRM: '待确认', NOT_STARTED: '未开始' };
  const statusColor: Record<string, string> = { ARCHIVED: '#11a874', PENDING_CONFIRM: '#f5a623', NOT_STARTED: '#8a9aaa' };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">归档端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">开标记录、评分表、澄清记录、评标报告、结果公示统一归档</p>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5 mb-4 flex items-center gap-6">
        <div className="text-4xl">📦</div>
        <div><h2 className="font-bold text-[#18243a]">电子档案编号：ARCH-{project.projectCode}</h2><p className="text-sm text-[#5a6d8a]">防篡改摘要：HASH-CHAIN-20260608-AF39C8E2</p></div>
        <div className="text-center"><div className="text-3xl font-bold text-[#064ea2]">{rate}%</div><div className="text-xs text-[#5a6d8a]">归档完整率</div></div>
        <button onClick={async () => { await api.post(`/bid/projects/${project.id}/archive-all`, {}); const ps = await api.get<BidProjectDetail[]>('/bid/projects'); if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject); }}
          className="px-5 py-2 bg-[#11a874] text-white rounded-lg font-semibold hover:bg-[#0e8f62] transition">一键归档演示</button>
      </div>

      <div className="grid grid-cols-[1.4fr_0.7fr] gap-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">归档资料清单</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">资料名称</th><th className="pb-2">责任端</th><th className="pb-2">状态</th><th className="pb-2">哈希摘要</th></tr></thead>
            <tbody>{project.archiveItems.map(a => (
              <tr key={a.id} className="border-b border-[#e8f0fa]">
                <td className="py-2">{a.name}</td><td className="py-2 text-[#5a6d8a]">{a.ownerRole}</td>
                <td className="py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: statusColor[a.status], backgroundColor: statusColor[a.status] + '18' }}>{statusLabel[a.status]}</span></td>
                <td className="py-2 text-[#5a6d8a] font-mono text-xs">{a.hashDigest || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">缺失提醒</h2>
          {project.archiveItems.filter(a => a.status !== 'ARCHIVED').map(a => (
            <div key={a.id} className="bg-[#fff8e8] rounded-lg p-3 text-sm text-[#8a6d3b] mb-2">⚠️ {a.name}{a.status === 'PENDING_CONFIRM' ? '待确认' : '未开始'}</div>
          ))}
          {project.archiveItems.filter(a => a.status === 'ARCHIVED').length > 0 && (
            <div className="bg-[#e8fff0] rounded-lg p-3 text-sm text-[#0e8f62]">✅ {project.archiveItems.filter(a => a.status === 'ARCHIVED').map(a => a.name).join('、')}已入档</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify all bid pages**

Open http://localhost:3002, login, then navigate through all 6 bid pages via sidebar.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add all 6 bid workbench pages with real API data"
```

---

### Task 9: Shell Pages for Remaining Modules

**Files:**
- Create: `apps/web/src/components/module-placeholder.tsx`
- Create: `apps/web/src/app/(dashboard)/procurement/page.tsx`
- Create: `apps/web/src/app/(dashboard)/expert/page.tsx`
- Create: `apps/web/src/app/(dashboard)/supplier/page.tsx`
- Create: `apps/web/src/app/(dashboard)/mall/page.tsx`
- Create: `apps/web/src/app/(dashboard)/notice/page.tsx`
- Create: `apps/web/src/app/(dashboard)/evaluation/page.tsx`
- Create: `apps/web/src/app/(dashboard)/about/page.tsx`

- [ ] **Step 1: Create module-placeholder component**

`src/components/module-placeholder.tsx`:
```tsx
export default function ModulePlaceholder({ title, desc, features }: { title: string; desc: string; features: string[] }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">{title}</h1>
      <p className="text-sm text-[#5a6d8a] mb-8">{desc}</p>
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-8 text-center">
        <div className="text-5xl mb-4">🚧</div>
        <h2 className="text-lg font-bold text-[#18243a] mb-2">模块开发中</h2>
        <p className="text-[#5a6d8a] mb-6">该模块正在建设中，敬请期待</p>
        <div className="flex flex-wrap justify-center gap-3">
          {features.map(f => <span key={f} className="px-4 py-2 bg-[#f8fbff] text-sm text-[#064ea2] rounded-lg border border-[#e8f0fa]">{f}</span>)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create all shell pages**

`src/app/(dashboard)/procurement/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function ProcurementPage() {
  return <ModulePlaceholder title="采购管理" desc="立项申请、项目管理、招标文件编写与审查" features={['个人中心', '立项申请', '数据库与数据分析', '项目管理与归档', '招标文件编写', '招标文件审查']} />;
}
```

`src/app/(dashboard)/expert/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function ExpertPage() {
  return <ModulePlaceholder title="专家管理" desc="专家库管理、随机抽取、回避设置、考核评价" features={['专家库', '专家抽取', '通知确认', '专家评价']} />;
}
```

`src/app/(dashboard)/supplier/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function SupplierPage() {
  return <ModulePlaceholder title="供应商管理" desc="供应商注册审核、供应商库、信息变更、评价管理" features={['供应商注册', '供应商库', '供应商评价', '信息变更']} />;
}
```

`src/app/(dashboard)/mall/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function MallPage() {
  return <ModulePlaceholder title="电子商城" desc="集中采购、员工内购、商家入驻与管理" features={['集中采购', '员工内购', '商家入驻', '商家管理', '员工福利']} />;
}
```

`src/app/(dashboard)/notice/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function NoticePage() {
  return <ModulePlaceholder title="信息公告" desc="招标公告、中标公示、政策法规、平台通知" features={['招标公告', '中标公示', '政策法规', '平台通知']} />;
}
```

`src/app/(dashboard)/evaluation/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function EvaluationPage() {
  return <ModulePlaceholder title="评价管理" desc="评价列表、发起评价、评价统计、异常记录" features={['评价列表', '发起评价', '评价详情', '评价统计', '异常记录', '指标配置']} />;
}
```

`src/app/(dashboard)/about/page.tsx`:
```tsx
import ModulePlaceholder from '@/components/module-placeholder';
export default function AboutPage() {
  return <ModulePlaceholder title="关于我们" desc="平台介绍、联系方式、帮助中心" features={['平台介绍', '联系方式', '帮助中心']} />;
}
```

- [ ] **Step 3: Verify all pages accessible from sidebar**

Navigate through all sidebar items. Expected: shell pages show "模块开发中" with feature tags.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add shell pages for all remaining modules"
```

---

### Task 10: Full Integration Verification

- [ ] **Step 1: Start all services**

```bash
docker compose up -d
pnpm dev
```

Expected: API on 4001, Web on 3002, PostgreSQL/Redis/MinIO running.

- [ ] **Step 2: Test auth flow**

Open http://localhost:3002 → redirects to /login → login with admin/admin123 → dashboard.

- [ ] **Step 3: Test bid pages**

Click through all 6 bid sidebar items. Each page loads real data from API.

- [ ] **Step 4: Test shell pages**

Click through all other sidebar items. Each shows placeholder.

- [ ] **Step 5: Test API proxy**

Open browser dev tools Network tab. Verify bid page requests go to `/api/bid/projects` and return real data.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: water-erp Phase 1 complete — full-stack skeleton with complete bid module"
```
