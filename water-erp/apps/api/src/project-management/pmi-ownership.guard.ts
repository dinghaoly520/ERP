import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyScopeService } from '../company/company-scope';

/** 只读分析类 POST 端点后缀：仅产出/刷新缓存的分析内容，不落业务字段。
 *  详情面板挂载即调 /analyze——只读视野（leader/admin）也必须放行，否则页面打不开。
 *  parse-announcement-fields 同性质：读采购文件 + AI 提取公告字段，无任何写库
 *  （2026-10-12 补录——公告向导智能填入对非创建人只读视野误 403）。 */
const READ_ONLY_POST_SUFFIXES = ['/analyze', '/analyze-step', '/refresh-summary', '/parse-announcement-fields'];

/**
 * 项目管理访问守卫（2026-08-20 拍板 1C；2026-10-10 读写分级修订）：
 *  - 读：创建人 + 本公司 leader + admin（全部公司）；
 *  - 写（修改/删除/终止/阶段推进/上传/懒建 bid-project 等）：仅创建人——
 *    leader 与 admin 对他人项目一律只读（用户裁定：leader 看本公司、admin 看全部，均只能看）。
 *
 * 挂在 ProjectManagementController 类级——凡是带 :id 路由参数的端点（约 40 个读/写端点，
 * 含 updateStage/attachments/analyze/reproc/complete/summary/attachment-file 等）统一校验；
 * 无 :id 的端点（list/create/extract-initiation/archive/:procurementRoundId）自动放行。
 * 历史注：A-36/37 曾为 leader 放行 /review 端点，该路由早已不在本控制器，旁路随之删除。
 */
@Injectable()
export class PmiOwnershipGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = req?.params?.id;
    if (!id) return true; // 非单项目路由（列表/创建/提取等）不校验

    const user = req.user;
    const path = typeof req.path === 'string' ? req.path : '';
    // GET :id/bid-project 是「确保存在即创建」的懒建端点（会写库），按写口径管理；只读展示走 bid-project-refs
    // HEAD 与 GET 同语义（无副作用），按读口径归一
    const isWrite =
      (req.method !== 'GET' && req.method !== 'HEAD' && !READ_ONLY_POST_SUFFIXES.some((s) => path.endsWith(s))) ||
      path.endsWith('/bid-project');

    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id },
      select: { createdById: true, companyId: true },
    });
    if (!item) return true; // 不存在 → 交给后续 404 语义

    if (item.createdById && item.createdById === user?.sub) return true; // 创建人：读写全权

    // 可见性（读权限）：admin 全量 + leader 本公司（resolveScope 强制本人公司；跨公司/无归属不可见）
    let visible = false;
    if (user?.role === 'admin') visible = true;
    else if (user?.role === 'leader') {
      const scope = await this.companyScope.resolveScope(user);
      visible = !scope.all && item.companyId === scope.companyId;
    }
    if (!visible) {
      throw new ForbiddenException({
        error: '该项目不属于当前账号，无权访问',
        code: 'PMI_OWNERSHIP_FORBIDDEN',
      });
    }

    // 可见 ≠ 可写：写操作仅创建人（leader/admin 对他人项目只读）
    if (isWrite) {
      throw new ForbiddenException({
        error: '只读视野：仅项目创建人可修改或删除该项目',
        code: 'PMI_READ_ONLY',
      });
    }
    return true;
  }
}
