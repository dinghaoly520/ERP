# 专家履职评价：从数值评分改为 A-E 等级制

**日期：** 2026-07-26  
**范围：** 管理端专家履职评价（:3005 `/expert/evaluation` + 后端 `ExpertEvaluation` 模型）  
**目标：** 彻底去除 0-100 数值评分，改用 A/B/C/D/E 五级纯等级评价

---

## 一、数据模型 (Prisma)

### 1.1 枚举变更

```prisma
// 当前
enum ExpertLevel { A B C D }

// 新
enum ExpertLevel { A B C D E }
// A=优秀 B=良好 C=合格 D=待改进 E=不合格
```

### 1.2 表字段变更 — `ExpertEvaluation`

| 当前字段 | 类型 | 新字段 | 类型 | 说明 |
|----------|------|--------|------|------|
| `attendanceScore` | `Int` | `attendanceGrade` | `ExpertLevel` | 出勤纪律等级 |
| `qualityScore` | `Int` | `qualityGrade` | `ExpertLevel` | 评审质量等级（权重 50%） |
| `disciplineScore` | `Int` | `disciplineGrade` | `ExpertLevel` | 廉洁纪律等级（权重 30%） |
| `overallScore` | `Int` | `overallGrade` | `ExpertLevel` | 综合等级 |
| `level` | `ExpertLevel` | — 废弃 | — | 被 `overallGrade` 取代 |

### 1.3 综合等级计算

```
A=5, B=4, C=3, D=2, E=1
weighted = qualityGrade × 0.5 + disciplineGrade × 0.3 + attendanceGrade × 0.2
四舍五入 → {5→A, 4→B, 3→C, 2→D, 1→E}
```

### 1.4 历史数据迁移

Score → Grade 映射：

| 分数区间 | 等级 |
|----------|------|
| ≥ 90 | A |
| 80-89 | B |
| 70-79 | C |
| 60-69 | D |
| < 60 | E |

`overallScore` 同理。`level` 字段直接映射到 `overallGrade`。

---

## 二、后端 API

### 2.1 DTO — `CreateExpertEvaluationDto`

```typescript
// 改为
attendanceGrade!: ExpertLevel;  // @IsEnum(ExpertLevel)
qualityGrade!: ExpertLevel;     // @IsEnum(ExpertLevel)
disciplineGrade!: ExpertLevel;  // @IsEnum(ExpertLevel)
// overallGrade 由 service 自动计算，不暴露给 DTO
```

### 2.2 Service — `createEvaluation()`

1. 接收 `{ expertUserId, projectId, attendanceGrade, qualityGrade, disciplineGrade, comment? }`
2. 按 1.3 公式计算 `overallGrade`
3. 写入 `ExpertEvaluation` 新字段

### 2.3 AI 建议 — `aiSuggestEvaluation()`

返回体从 `{ attendanceScore, qualityScore, disciplineScore }` 改为 `{ attendanceGrade, qualityGrade, disciplineGrade, analysis }`。Prompt 明确要求 LLM 输出 A-E 等级。

### 2.4 统计 — `getEvaluationStats()`

```typescript
// 返回体变化
{
  levelCounts: { A: number, B: number, C: number, D: number, E: number },
  excellentRatio: number,  // (A+B) / total — 替代 avgScore
  total: number,
}
// 废弃：avgScore
```

### 2.5 维度分布 — `getDimensionStats()`

```typescript
// 当前返回 { attendanceAvg, qualityAvg, disciplineAvg, total }
// 改为每个维度的等级分布
{
  attendance: { A: number, B: number, C: number, D: number, E: number },
  quality:    { A: number, B: number, C: number, D: number, E: number },
  discipline: { A: number, B: number, C: number, D: number, E: number },
  total: number,
}
```

### 2.6 列表查询 — `listExperts()`

每行 `avgEvalScore` → 废弃，改为 `latestGrade`（最新一次 overallGrade）。排序依据从均分 → 等级分布（A 数量优先）。

---

## 三、前端

### 3.1 统计卡片区

- 5 个 KPI 卡片：A/B/C/D/E 各一，含等级名称 + 人数
- "累计评价 X 次 · 平均得分 Y" → "累计评价 X 次 · 优良率 Y%"

### 3.2 专家列表表格

| 列 | 当前 | 新 |
|----|------|-----|
| 平均评分 | 数字 (85) | **废弃此列** |
| 最新评分 | 数字 + [A] Badge | 纯 [A] Badge |

### 3.3 评价弹窗（核心改动）

**三维等级选择器：** 每个维度一行 A/B/C/D/E 按钮组，未选中性色，选中按等级着色：

| 等级 | 颜色 |
|------|------|
| A | 绿色 (success) |
| B | 蓝色 (accent) |
| C | 琥珀/橙 |
| D | 黄色 (warning) |
| E | 红色 (danger) |

按钮使用 `.neu-btn-soft` 基础风格。

**AI 分析栏：** 文案从"建议分数"改为"建议等级"。Prompt 调整获得等级输出。

**综合等级预览：** 展示计算后的 `overallGrade` Badge + 权重说明 `"质量(50%) + 纪律(30%) + 出勤(20%)"`，替代当前的分数+Badge 预览。

### 3.4 三维评分分布区

从 0-100 进度条改为小柱状，每个维度展示 A/B/C/D/E 五个等级的人数分布条。

### 3.5 共享常量

`packages/shared/src/constants.ts` 新增：

```typescript
export const LEVEL_LABEL: Record<string, string> = {
  A: '优秀', B: '良好', C: '合格', D: '待改进', E: '不合格'
};
export const LEVEL_WEIGHT = { qualityGrade: 0.5, disciplineGrade: 0.3, attendanceGrade: 0.2 };
```

---

## 四、影响范围清单

| 层 | 文件 | 变更性质 |
|----|------|----------|
| DB | `prisma/schema.prisma` | 枚举 + 表字段 |
| DB | 迁移脚本 | 新建 migration + 数据回填 |
| API | `expert/dto/create-expert-evaluation.dto.ts` | 字段重写 |
| API | `expert/expert-admin.service.ts` | 计算逻辑 + 统计逻辑 |
| API | `expert/expert-admin.controller.ts` | 响应体适配 |
| API | `expert/expert.service.ts` | 如有引用校验 |
| API | `expert/expert-deviation.ts` | 如有依赖 score 的偏离计算 |
| 前端 | `web/.../expert/evaluation/page.tsx` | 弹窗 + 表格 + 统计卡片 |
| 前端 | `web/lib/api/expert.ts` | 类型定义 |
| 共享 | `packages/shared/src/types.ts` | `ExpertListItem`、统计类型 |
| 共享 | `packages/shared/src/constants.ts` | 新增 LEVEL_LABEL 等常量 |

---

## 五、不修改的范围

- **专家投标评分**（BidScoreRecord 等）：维持数值制，未动
- **供应商履约评价**（SupplierEvaluation）：维持数值制，未动
- **平板端（tablet）**：不存在管理端评价功能，无需修改
