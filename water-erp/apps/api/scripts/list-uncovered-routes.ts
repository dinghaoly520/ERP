/**
 * 无角色覆盖路由扫描脚本（RolesGuard 默认拒绝 · Task 2）
 *
 * 目的：列出「三 key（@Roles / @Public / @AnyRole）皆无」的路由（Task 8 翻转默认拒绝后
 * 将 403 NO_ROLE_CONFIGURED），作为 Task 3-7 逐批标注的基线清单与 Task 8 的清零验证。
 * 同时按账本 Task 1 Ruling 检测「类级 @AnyRole + 方法级 @Roles」冲突组合（WARN 段，不阻塞）。
 *
 * 三档实现（自动选择，--static 强制三档）：
 *   一档 runtime-app-context——NestFactory.createApplicationContext(AppModule) 后经
 *     ModulesContainer 遍历已注册 controller。仅当运行器能产出 design:paramtypes
 *     （PARAMTYPES_METADATA 探测通过）才尝试：tsx=esbuild 转换**不发射**该元数据，
 *     Nest DI 解析必挂且挂相极差（ExceptionsZone 直接 process.exit(1)，错误日志还会被
 *     exit 截断吞掉——脚本对 boot 期间的 process.exit 做了拦截转异常）。本仓 tsx 4.22
 *     下此档恒不可用，探测失败即跳过；tsc/ts-jest 等全量编译环境可用。
 *   二档 module-metadata（本仓默认档）——import 全部 src 下的 .module.ts 文件，读
 *     @Module 装饰器写入的 controllers 元数据得到「实际注册的 controller 类集合」，
 *     再对每类反射 PATH_METADATA / METHOD_METADATA / 三 key。仍是**运行时装饰器
 *     元数据**（@Roles(...SPREAD) 常量已展开为真实角色数组；类级/方法级层级精确），
 *     但不实例化 DI 容器——零基础设施依赖、零 DB 副作用（跳过全部 onModuleInit，
 *     如 tender-review 启动恢复、bid 管理证书 bootstrap）。
 *   三档 static-regex——正则解析 .controller.ts 源文件装饰块（降级兜底；--static 可
 *     强制）。局限：@Roles(...SPREAD) 无法求值（按 covered 处理、roles 记占位符）、
 *     异形装饰块（块内夹注释等）可能漏检——清单需人工复核。
 *   说明：父任务原设想的「createApplicationContext 或 Express router.stack」两法在本仓
 *   工具链下均不可行（同因：DI 元数据缺失），二档即「运行时元数据」语义的最优可用实现。
 *
 * 输出契约（三档完全一致）：
 *   stdout（人类可读）：
 *     [METHOD] /path → Controller.handler  [建议动作]
 *     ...
 *     total: N
 *     WARN 段（类级 @AnyRole + 方法级 @Roles 冲突；不影响 exit code）
 *   --json <out.json>：
 *     { mode, generatedAt, total, scannedTotal, routes: [{method, path, controller,
 *       handler, hasPublic, roles, hasAnyRole}], warnings: [...] }
 *     routes 仅含无覆盖路由；total = 无覆盖路由数。
 *   退出码：0 = 扫描完成（含存在无覆盖路由与 WARN）；1 = 三档均失败或参数错误。
 *
 * 用法（在 apps/api 下运行）：
 *   npx tsx scripts/list-uncovered-routes.ts                       # 自动选档（本仓=二档）
 *   npx tsx scripts/list-uncovered-routes.ts --json out.json       # 另写机器可读清单
 *   npx tsx scripts/list-uncovered-routes.ts --static --json out.json  # 强制三档（正则静态）
 *
 * 说明：
 * - 路径含全局前缀 /api（main.ts setGlobalPrefix('api')），与真实请求 URL 一致；
 * - 覆盖判定按 Task 8 翻转后的语义（Task 1 Ruling）：方法级任一 key 命中即以方法级
 *   为准，否则落类级——与守卫翻转后的实际行为一致，避免扫描口径超前/滞后于守卫。
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, PARAMTYPES_METADATA } from '@nestjs/common/constants';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { ANY_ROLE_KEY } from '../src/common/decorators/any-role.decorator';

// main.ts `app.setGlobalPrefix('api')`——脚本侧同步前缀，输出即真实请求 URL
const GLOBAL_PREFIX = 'api';

/** 运行时类引用（构造函数）——装饰器元数据的反射载体 */
type ClassRef = abstract new (...args: never[]) => unknown;

type Mode = 'runtime-app-context' | 'module-metadata' | 'static-regex';

interface Keys {
  hasPublic: boolean;
  roles: string[] | null;
  hasAnyRole: boolean;
}

/** 路由全量记录（含有效覆盖判定；「无覆盖」= uncovered=true） */
interface RouteFinding extends Keys {
  method: string;
  path: string;
  controller: string;
  handler: string;
  uncovered: boolean;
}

interface CoverageWarning {
  controller: string;
  handler: string;
  method: string;
  path: string;
  issue: string;
}

interface ScanResult {
  mode: Mode;
  all: RouteFinding[]; // 全部路由（含已覆盖）——对账/调试用
  warnings: CoverageWarning[];
}

const WARN_ANYROLE_ROLES =
  '类级 @AnyRole + 方法级 @Roles 并存——Task 8 方法级严格优先后类级 AnyRole 被忽略（Task 1 Ruling），标注期应消除此组合';

// ── 覆盖判定（Task 8 语义：方法级任一 key 命中即以方法级为准，否则类级）──
function computeCoverage(handlerKeys: Keys, classKeys: Keys): Keys & { uncovered: boolean } {
  const handlerHasKey = handlerKeys.hasPublic || handlerKeys.hasAnyRole || handlerKeys.roles !== null;
  const eff = handlerHasKey ? handlerKeys : classKeys;
  const uncovered = !eff.hasPublic && !eff.hasAnyRole && !(eff.roles && eff.roles.length > 0);
  return { ...eff, uncovered };
}

function joinPath(...segments: (string | undefined | null)[]): string {
  const parts = segments
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0);
  return '/' + parts.join('/');
}

function fullRoutePath(controllerPath: string | undefined, methodPath: string): string {
  return joinPath(GLOBAL_PREFIX, controllerPath, methodPath);
}

function suggestAction(f: RouteFinding): string {
  if (f.path === `/${GLOBAL_PREFIX}` || f.path === `/${GLOBAL_PREFIX}/health`) {
    return '建议: @Public（健康检查/根探测，spec §3.4）';
  }
  const name = `${f.controller}.${f.handler}`.toLowerCase();
  if (/(login|logout|register|captcha|verify-code|public)/.test(name)) {
    return '建议: @Public 候选（认证/公开语义，逐条核对 spec §3.4）';
  }
  return '建议: 按 spec §3.4 归类（具体角色集 / @AnyRole / @Public）';
}

// ══════════════ 二档：module 装饰器元数据（本仓默认） ══════════════

// @Module 装饰器把每个属性（imports/providers/controllers/exports）**各自**定义为独立
// 元数据键（见 @nestjs/common/decorators/modules/module.decorator.js——逐键
// Reflect.defineMetadata(property, ...)），不是单一对象；controllers 键为字符串字面量。
const CONTROLLERS_METADATA = 'controllers';

/**
 * 收集 @Module 注册的 controller 类集合。发现范围 = src 下全部 .ts（非 spec），
 * 先做 @Module( 文本预筛再 import——module 类不全住在 *.module.ts
 * （如 company/company-scope.ts 的 CompanyScopeModule，经 AppModule 真实接线）；
 * 预筛也天然排除 main.ts 等有启动副作用的入口文件（它们不含 @Module）。
 */
export async function collectRegisteredControllers(srcDir: string): Promise<Set<ClassRef>> {
  const tsFiles = walkFiles(srcDir, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts') && f !== 'main.ts');
  const registered = new Set<ClassRef>();
  for (const file of tsFiles) {
    if (!/@Module\s*\(/.test(readFileSync(file, 'utf8'))) continue;
    const mod: Record<string, unknown> = await import(pathToFileURL(file).href);
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const controllers = Reflect.getMetadata(CONTROLLERS_METADATA, exported) as unknown[] | undefined;
      if (Array.isArray(controllers)) {
        for (const c of controllers) if (typeof c === 'function') registered.add(c as ClassRef);
      }
    }
  }
  return registered;
}

/** 对单个 controller 类反射枚举路由（一档/二档共用；ctor.prototype 无需实例化）。 */
export function scanControllerClass(
  ctor: ClassRef,
  sink: { all: RouteFinding[]; warnings: CoverageWarning[] },
): void {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, ctor) as string | undefined;
  const classKeys: Keys = {
    hasPublic: !!Reflect.getMetadata(IS_PUBLIC_KEY, ctor),
    roles: (Reflect.getMetadata(ROLES_KEY, ctor) as string[] | undefined) ?? null,
    hasAnyRole: !!Reflect.getMetadata(ANY_ROLE_KEY, ctor),
  };
  const proto = (ctor.prototype ?? {}) as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const methodValue = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    if (methodValue === undefined) continue; // 非路由方法
    const methodPath = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
    const method = RequestMethod[methodValue] ?? String(methodValue);
    const path = fullRoutePath(controllerPath, methodPath);

    const handlerKeys: Keys = {
      hasPublic: !!Reflect.getMetadata(IS_PUBLIC_KEY, handler),
      roles: (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ?? null,
      hasAnyRole: !!Reflect.getMetadata(ANY_ROLE_KEY, handler),
    };
    if (classKeys.hasAnyRole && handlerKeys.roles !== null) {
      sink.warnings.push({ controller: ctor.name, handler: name, method, path, issue: WARN_ANYROLE_ROLES });
    }
    sink.all.push({ method, path, controller: ctor.name, handler: name, ...computeCoverage(handlerKeys, classKeys) });
  }
}

export async function scanModuleMetadata(srcDir: string): Promise<ScanResult> {
  const registered = await collectRegisteredControllers(srcDir);
  const sink = { all: [] as RouteFinding[], warnings: [] as CoverageWarning[] };
  for (const ctor of registered) scanControllerClass(ctor, sink);
  return { mode: 'module-metadata', ...sink };
}

// ══════════════ 一档：AppModule app context（需 design:paramtypes） ══════════════

const BOOT_TIMEOUT_MS = 60_000;

/**
 * 探测运行器是否发射 design:paramtypes（emitDecoratorMetadata）。
 * tsx=esbuild 不发射（Nest DI 必挂）；tsc/ts-jest 编译环境发射。
 * 样本：AuthService（3 个类型化构造参数，构造注入典型）。
 */
async function decoratorMetadataAvailable(): Promise<boolean> {
  try {
    const { AuthService } = (await import('../src/auth/auth.service')) as { AuthService?: ClassRef };
    if (!AuthService) return false;
    return Array.isArray(Reflect.getMetadata(PARAMTYPES_METADATA, AuthService));
  } catch {
    return false;
  }
}

async function scanAppContext(): Promise<ScanResult> {
  loadEnvFn([join(__dirname, '..', '.env'), join(process.cwd(), '.env')]);
  const { AppModule } = await import('../src/app.module');
  const { NestFactory, ModulesContainer } = await import('@nestjs/core');

  // ExceptionsZone 在初始化异常时直接 process.exit(1)（错误日志还会被 exit 截断）。
  // boot 期间拦截 process.exit → 转为可捕获异常，保证降级链路可达。
  const origExit = process.exit.bind(process);
  let exitDuringBoot: { code: number | undefined; at: string } | null = null;
  process.exit = ((code?: number) => {
    exitDuringBoot = { code, at: new Error('process.exit during AppModule boot').stack?.split('\n')[2]?.trim() ?? '' };
    throw new Error(`AppModule 初始化触发 process.exit(${code})（Nest ExceptionsZone 兜底退出）`);
  }) as typeof process.exit;

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;
  try {
    const boot = NestFactory.createApplicationContext(AppModule, { logger: false });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`AppModule 启动超时（${BOOT_TIMEOUT_MS / 1000}s）——外部依赖未就绪？`)),
        BOOT_TIMEOUT_MS,
      ),
    );
    app = await Promise.race([boot, timeout]);
    const modules = app.get(ModulesContainer);
    const sink = { all: [] as RouteFinding[], warnings: [] as CoverageWarning[] };
    for (const module of modules.values()) {
      for (const wrapper of module.controllers.values()) {
        const ctor: ClassRef | undefined = (wrapper.metatype as ClassRef | undefined) ?? wrapper.instance?.constructor;
        if (ctor) scanControllerClass(ctor, sink);
      }
    }
    return { mode: 'runtime-app-context', ...sink };
  } catch (err) {
    const extra = exitDuringBoot ? `；boot 期间 process.exit(${exitDuringBoot.code}) @ ${exitDuringBoot.at}` : '';
    throw new Error(`${(err as Error)?.message ?? err}${extra}`);
  } finally {
    process.exit = origExit;
    if (app) {
      try {
        await app.close();
      } catch {
        // 关闭失败不影响扫描结果（进程末尾 exitWith 兜底）
      }
    }
  }
}

// ══════════════ 三档：源文件正则静态扫描 ══════════════

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'];

interface Deco {
  name: string;
  /** @Name( 内部实参原文（跨行已拼平；含引号原样） */
  args: string;
}

/** 从 "@Name(" 起按括号配平提取实参（跳过引号内的括号）。openIdx 指向 '('。 */
function readBalancedArgs(text: string, openIdx: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null; // 未闭合
}

/** 提取文本中全部装饰器（@Name(...)），实参括号配平（可跨行）。 */
function extractDecorators(text: string): Deco[] {
  const result: Deco[] = [];
  const re = /@([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const args = readBalancedArgs(text, m.index + m[0].length - 1);
    result.push({ name: m[1], args: args ?? '' });
    if (args === null) break; // 括号不闭合——后续解析已不可信
  }
  return result;
}

function decoPath(deco: Deco): { path: string; unresolved: boolean } {
  const raw = deco.args.trim();
  if (raw === '') return { path: '', unresolved: false };
  const quoted = raw.match(/^(["'`])([\s\S]*)\1$/);
  const inner = quoted ? quoted[2] : raw;
  const unresolved = !quoted || inner.includes('${') || inner.includes('...');
  return { path: inner, unresolved };
}

function decoRoles(deco: Deco): string[] {
  const raw = deco.args.trim();
  if (raw === '') return [];
  const literals: string[] = [];
  const re = /(["'])((?:(?!\1)[\s\S])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) literals.push(m[2]);
  if (literals.length > 0) return literals;
  // 无字面量但实参非空 → 常量/展开（如 @Roles(...AUTHENTICATED_ROLES)）：
  // 三档无法求值。运行时该写法必有非空角色数组 → 按 covered 处理，roles 记占位符。
  return [`<unresolved:${raw}>`];
}

function keysFromDecorators(decos: Deco[]): Keys {
  const rolesDeco = decos.find((d) => d.name === 'Roles');
  return {
    hasPublic: decos.some((d) => d.name === 'Public'),
    roles: rolesDeco ? decoRoles(rolesDeco) : null,
    hasAnyRole: decos.some((d) => d.name === 'AnyRole'),
  };
}

/**
 * 紧凑单行式成员（catalog 风格）：「@Get('x') @Roles(...) async foo(...) { ... }」
 * 装饰器链 + 签名全在同一行。返回 HTTP 装饰器与成员名；非该风格返回 null。
 */
function parseSameLineMember(line: string): { deco: Deco; name: string } | null {
  const t = line.trim();
  if (!t.startsWith('@')) return null;
  // 装饰器链：@Name(args)（args 允许一层括号嵌套）——逐块吞掉
  const chunk = /^@([A-Za-z_$][\w$]*)\s*(\(([^()]*(?:\([^()]*\))*[^()]*)*\))?\s*/;
  let rest = t;
  let http: Deco | null = null;
  while (rest.startsWith('@')) {
    const m = rest.match(chunk);
    if (!m) return null;
    if (HTTP_DECORATORS.includes(m[1])) http = { name: m[1], args: m[3] ?? '' };
    rest = rest.slice(m[0].length);
  }
  if (!http) return null;
  const sig = rest.match(
    /^(?:(?:public|private|protected|static|readonly|override|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
  );
  if (!sig) return null;
  return { deco: http, name: sig[1] };
}

export function scanStatic(srcDir: string): ScanResult {
  const files = walkFiles(srcDir, (f) => f.endsWith('.controller.ts') && !f.endsWith('.spec.ts')).sort();
  const all: RouteFinding[] = [];
  const warnings: CoverageWarning[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    let current: { name: string; controllerPath: string | undefined; classKeys: Keys } | null = null;

    // 行级游标：i 处若为装饰器行，向后吞掉「装饰块」（@ 行/实参续行；块内夹的空行/
    // 注释行若其后仍是 @ 行则一并吞掉——ai/expert-admin 等文件的类装饰块中间夹注释），
    // 终止于首个非装饰行；该行（或其后跳过空行/注释的首行）为类声明或成员签名。
    const isBlankOrComment = (s: string) => s.trim() === '' || /^\s*(\/\/|\/\*|\*)/.test(s);
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim().startsWith('@')) {
        i++;
        continue;
      }
      const blockStart = i;
      let depth = 0;
      let oneLiner: { deco: Deco; name: string } | null = null;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (isBlankOrComment(t)) {
          // 注释/空行处理：
          // ① 处于装饰器实参续行（depth>0，如 @UseInterceptors(...) 跨行参数中夹注释）→ 无条件吞掉；
          // ② 装饰块顶层：其后仍是装饰器行 → 视为块内间隔吞掉（ai/expert-admin 类装饰块夹注释/空行）；否则块终止
          if (depth > 0) {
            i++;
            continue;
          }
          let j = i;
          while (j < lines.length && isBlankOrComment(lines[j])) j++;
          if (j < lines.length && lines[j].trim().startsWith('@')) {
            i = j;
            continue;
          }
          break;
        }
        const isDecoLine = t.startsWith('@');
        if (!isDecoLine && depth <= 0) break;
        depth += (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
        i++;
        // 单行式成员（装饰器+签名同行）：该行即完整成员，块就此终止——
        // 否则连续的一行式成员会被空行吞并逻辑误并入同一块（catalog 实测）
        if (isDecoLine && depth <= 0) {
          const parsed = parseSameLineMember(t);
          if (parsed) {
            oneLiner = parsed;
            break;
          }
        }
      }
      const blockText = lines.slice(blockStart, i).join('\n');
      // 跳过空行/注释行找声明行
      let sig = i;
      while (sig < lines.length && isBlankOrComment(lines[sig])) sig++;
      const sigLine = lines[sig] ?? '';

      const sigMember = sigLine.match(
        /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
      );
      const memberName = oneLiner ? oneLiner.name : sigMember?.[1];

      const classMatch = sigLine.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (classMatch && !oneLiner) {
        const decos = extractDecorators(blockText);
        const ctrlDeco = decos.find((d) => d.name === 'Controller');
        current = ctrlDeco
          ? { name: classMatch[1], controllerPath: decoPath(ctrlDeco).path || undefined, classKeys: keysFromDecorators(decos) }
          : null; // 同文件后置的 DTO 等非 controller 类——其后成员不再归属路由
        continue;
      }

      if (memberName && current) {
        const decos = extractDecorators(blockText);
        const httpDeco = oneLiner?.deco ?? decos.find((d) => HTTP_DECORATORS.includes(d.name));
        if (httpDeco) {
          const { path: sub, unresolved } = decoPath(httpDeco);
          const handlerKeys = keysFromDecorators(decos);
          const path = fullRoutePath(current.controllerPath, unresolved ? `«${sub}»` : sub);
          if (current.classKeys.hasAnyRole && handlerKeys.roles !== null) {
            warnings.push({ controller: current.name, handler: memberName, method: httpDeco.name.toUpperCase(), path, issue: WARN_ANYROLE_ROLES });
          }
          all.push({
            method: httpDeco.name.toUpperCase(),
            path,
            controller: current.name,
            handler: memberName,
            ...computeCoverage(handlerKeys, current.classKeys),
          });
        }
      }
      // 非 HTTP 装饰块（拦截器/DTO 属性/参数装饰行等）——游标 i 已停在声明行，继续
    }
  }
  return { mode: 'static-regex', all, warnings };
}

// ══════════════ 公共工具 ══════════════

function walkFiles(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p, keep));
    else if (entry.isFile() && keep(entry.name)) out.push(p);
  }
  return out;
}

function loadEnvFn(candidates: string[]): void {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value; // dotenv 语义：不覆盖已有
    }
    return;
  }
}

function uncoveredSorted(all: RouteFinding[]): RouteFinding[] {
  return all
    .filter((r) => r.uncovered)
    .sort(
      (a, b) =>
        a.controller.localeCompare(b.controller) ||
        a.path.localeCompare(b.path) ||
        a.method.localeCompare(b.method) ||
        a.handler.localeCompare(b.handler),
    );
}

function printHuman(result: ScanResult, jsonPath: string | null): void {
  const sorted = uncoveredSorted(result.all);
  console.log(`# 无角色覆盖路由清单（mode: ${result.mode}）`);
  if (sorted.length === 0) {
    console.log('（空——全部路由已具备 @Roles/@Public/@AnyRole 之一）');
  }
  for (const r of sorted) {
    console.log(`[${r.method}] ${r.path} → ${r.controller}.${r.handler}  ${suggestAction(r)}`);
  }
  console.log(`total: ${sorted.length}`);

  console.log('');
  console.log('WARN（类级 @AnyRole + 方法级 @Roles 冲突组合——Task 1 Ruling，不阻塞）:');
  if (result.warnings.length === 0) {
    console.log('  无');
  } else {
    for (const w of result.warnings) {
      console.log(`  [WARN] ${w.method} ${w.path} → ${w.controller}.${w.handler}：${w.issue}`);
    }
  }
  console.log('');
  console.log(
    `（扫描路由总数 ${result.all.length}，已覆盖 ${result.all.length - sorted.length}，模式 ${result.mode}${jsonPath ? `，JSON → ${jsonPath}` : ''}）`,
  );
}

/** 统一出口：留 100ms 让 stdout/stderr（管道下异步）flush 完再退出，避免日志被截断。 */
function exitWith(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 100);
}

// ══════════════ 入口 ══════════════

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const forceStatic = args.includes('--static');
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  if (jsonIdx >= 0 && !jsonPath) {
    console.error('用法: --json <输出文件路径>');
    return 1;
  }
  const unknown = args.filter((a, idx) => a !== '--static' && a !== '--json' && idx !== jsonIdx + 1);
  if (unknown.length > 0) {
    console.error(`未知参数: ${unknown.join(' ')}（支持 --static / --json <path>）`);
    return 1;
  }

  const srcDir = join(__dirname, '..', 'src');
  let result: ScanResult;
  if (forceStatic) {
    result = scanStatic(srcDir);
  } else {
    // 一档：仅当运行器发射 design:paramtypes 时可行（tsx 不发射 → 跳过而非空跑必挂）
    const metaOk = await decoratorMetadataAvailable();
    if (metaOk) {
      try {
        result = await scanAppContext();
      } catch (err) {
        console.error(`[list-uncovered-routes] 一档 runtime-app-context 失败，降级二档 module-metadata：${(err as Error)?.message ?? err}`);
        result = await scanModuleMetadata(srcDir);
      }
    } else {
      console.error('[list-uncovered-routes] 一档 runtime-app-context 跳过：当前运行器（tsx/esbuild）不发射 design:paramtypes，Nest DI 无法解析');
      try {
        result = await scanModuleMetadata(srcDir);
      } catch (err) {
        console.error(`[list-uncovered-routes] 二档 module-metadata 失败，降级三档 static-regex：${(err as Error)?.message ?? err}`);
        result = scanStatic(srcDir);
      }
    }
  }

  if (jsonPath) {
    const uncovered = uncoveredSorted(result.all).map((r) => ({
      method: r.method,
      path: r.path,
      controller: r.controller,
      handler: r.handler,
      hasPublic: r.hasPublic,
      roles: r.roles,
      hasAnyRole: r.hasAnyRole,
    }));
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          mode: result.mode,
          generatedAt: new Date().toISOString(),
          total: uncovered.length,
          scannedTotal: result.all.length,
          routes: uncovered,
          warnings: result.warnings,
        },
        null,
        2,
      ) + '\n',
    );
  }
  printHuman(result, jsonPath);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => exitWith(code))
    .catch((err) => {
      console.error(`[list-uncovered-routes] 致命错误: ${err?.stack ?? err}`);
      exitWith(1);
    });
}
