import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 阳光采购平台推送服务（2026-10-28 测试环境联调版）
 *
 * 消费公告 metadata.sunshinePublish 快照（发布向导按《天府阳光采购平台招标数据接口文档 V2.0.5》
 * 组织的配置），在公告发布后推送两类报文：
 *   1. SCM0001 招标基础信息 → POST {base}/dataService/import/information（公告数据依赖基础信息先行，status=4 即未先推）
 *   2. 公告侧接口按类目 → SCM0002 /announcement（采购公告）/ SCM0004 /publicity（中标公示）/ SCM0006 /termination（终止招标）
 *
 * env（未配置或未启用 → 跳过，公告照常发布，结果记 skipped）：
 *   SUNSHINE_PUSH_ENABLED（默认 false；true 才外发）
 *   SUNSHINE_API_URL（环境基址，如测试 http://preplatform2.scjzy.net / 生产 https://platform.hxyc.com.cn）
 *   SUNSHINE_IDENTITY（平台方分配的身份识别编码）
 *
 * 结果留痕 metadata.sunshinePushResult（at/baseUrl/ok/results[{iface,path,status,message}]），
 * 发布不因推送失败回滚（联调期观察留痕即可）；重发=同 unique 重复推送（语义联调确认点，代码已记注释）。
 */

/** 接口编码 → 平台路径（文档 V2.0.5「接口地址」列） */
const SCM_PATHS: Record<string, string> = {
  SCM0001: '/dataService/import/information',
  SCM0002: '/dataService/import/announcement',
  SCM0004: '/dataService/import/publicity',
  SCM0006: '/dataService/import/termination',
};

/** 发布向导写入的快照（sunshine-platform-dialog SunshinePublishConfig 镜像——字段以文档为准） */
interface SunshineSnapshot {
  enabled: boolean;
  interfaceCode: 'SCM0002' | 'SCM0004' | 'SCM0006';
  /** 发布时项目 id（unique/planUnique/tenderPackage 溯源键，2026-10-28 补入快照） */
  projectId?: string;
  issueType: 1 | 2;
  isExternal: 0 | 1;
  config: {
    planCode: string;
    planName: string;
    projectCode: string;
    projectName: string;
    proctype: number;
    type: number;
    tenderAmount: number | null;
    centralized: 0 | 1;
    handUserName: string;
    handOrganizationName: string;
    contacts: string;
    phone: string;
    email: string;
    organizationCode: string;
    organizationName: string;
    organizationUnique: string;
    parentOrganization: string;
    standardQuota: number | null;
    publicQuota: number | null;
    procuringentity: string;
    packageName: string;
    publishTime: string;
    deadline: string;
    annrequire: 0 | 1;
    annreason: string;
    startTime: string;
    endTime: string;
    issueUserName: string;
    content: string;
    candidates: Array<{
      packageName: string;
      packageUnique: string;
      supplierName: string;
      ranking: number;
      companyUnique: string;
      bidAmount: number | null;
    }>;
  };
}

/** 当前时刻 → 文档时间格式 yyyy-MM-dd HH:mm:ss（本地时区） */
function localApiNow(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** datetime-local（YYYY-MM-DDTHH:mm）→ 文档时间格式 yyyy-MM-dd HH:mm:ss（与弹窗 toApiTime 同口径） */
function apiTime(v: string | undefined | null): string {
  if (!v) return '';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}:00` : String(v);
}

@Injectable()
export class SunshinePushService {
  private readonly logger = new Logger(SunshinePushService.name);

  constructor(@Optional() private prisma?: PrismaService) {}

  /** 公告发布后触发（fire-and-forget；内部全捕获，永不抛出） */
  async onPublish(announcement: { id: string; content: string; metadata: unknown }): Promise<void> {
    try {
      const meta = (announcement.metadata as Record<string, unknown>) || {};
      const snap = meta.sunshinePublish as SunshineSnapshot | undefined;
      if (!snap?.enabled) return;

      const enabled = process.env.SUNSHINE_PUSH_ENABLED === 'true';
      const base = process.env.SUNSHINE_API_URL?.trim().replace(/\/+$/, '');
      const identity = process.env.SUNSHINE_IDENTITY?.trim();
      if (!enabled || !base || !identity) {
        await this.record(announcement.id, meta, {
          at: new Date().toISOString(), baseUrl: base ?? '', ok: false, skipped: true,
          results: [{ iface: '-', path: '-', status: -1, message: '推送未启用或 env 未配置（SUNSHINE_PUSH_ENABLED/SUNSHINE_API_URL/SUNSHINE_IDENTITY）' }],
        });
        return;
      }

      const c = snap.config;
      const unique = snap.projectId || c.projectCode || c.planCode; // 溯源键：项目 id，缺省回落编号
      const phase = snap.interfaceCode === 'SCM0002' ? 4 : snap.interfaceCode === 'SCM0004' ? 9 : -2;

      const scm0001 = {
        identity, unique, type: c.type, phase,
        proctype: c.proctype, issueType: snap.issueType, isExternal: snap.isExternal,
        planCode: c.planCode, planName: c.planName, projectCode: c.projectCode, projectName: c.projectName,
        organizationCode: c.organizationCode, organizationName: c.organizationName,
        organizationUnique: c.organizationUnique, parentOrganization: c.parentOrganization,
        handUserName: c.handUserName, handOrganizationName: c.handOrganizationName,
        contacts: c.contacts, phone: c.phone, email: c.email,
        tenderAmount: c.tenderAmount,
        createTime: localApiNow(), // 文档必传（联调实录：漏此字段 → status=1 must not be null）
        centralized: c.centralized,
        procuringentity: c.procuringentity,
        standardQuota: c.standardQuota, publicQuota: c.publicQuota,
        tenderPackage: [{ unique, name: c.packageName }],
      };

      let announcementPayload: Record<string, unknown>;
      if (snap.interfaceCode === 'SCM0002') {
        announcementPayload = {
          identity, unique: `${unique}-ann`, planUnique: unique,
          publishTime: apiTime(c.publishTime), deadline: apiTime(c.deadline),
          content: announcement.content || '', // 公告正文 HTML（发布向导已生成）
          annrequire: c.annrequire,
          ...(c.annrequire === 0 && c.annreason ? { annreason: c.annreason } : {}),
        };
      } else if (snap.interfaceCode === 'SCM0004') {
        announcementPayload = {
          identity, unique: `${unique}-publicity`, planUnique: unique,
          publishTime: apiTime(c.publishTime || c.startTime),
          issueUserName: c.issueUserName, content: announcement.content || c.content || '',
          startTime: apiTime(c.startTime), endTime: apiTime(c.endTime),
          isPublicityPublish: snap.isExternal,
          pubequire: c.annrequire,
          ...(c.annrequire === 0 && c.annreason ? { pubreason: c.annreason } : {}),
          candidates: c.candidates.map(x => ({
            packageName: x.packageName, packageUnique: x.packageUnique,
            supplierName: x.supplierName, ranking: x.ranking,
            companyUnique: x.companyUnique, bidAmount: x.bidAmount,
          })),
          // 文档 SCM0004 changes 变更集合标必传——首发无变更传空集合（空数组语义为联调确认点）
          changes: [],
        };
      } else {
        announcementPayload = {
          identity, unique: `${unique}-termination`, planUnique: unique,
          publishTime: apiTime(c.publishTime || c.startTime),
          issueUserName: c.issueUserName, content: announcement.content || c.content || '',
          startTime: apiTime(c.startTime), endTime: apiTime(c.endTime),
        };
      }

      // 基础信息先行（status=4=主体缺失），公告侧随后；任一失败即止并留痕
      const results: Array<{ iface: string; path: string; status: number; message: string }> = [];
      let ok = true;
      for (const [iface, payload] of [['SCM0001', scm0001], [snap.interfaceCode, announcementPayload]] as const) {
        const path = SCM_PATHS[iface];
        if (!path) { results.push({ iface, path: '-', status: -1, message: `未知接口编码 ${iface}` }); ok = false; break; }
        const r = await this.post(`${base}${path}`, payload);
        results.push({ iface, path, ...r });
        if (r.status !== 0) { ok = false; break; }
      }

      await this.record(announcement.id, meta, { at: new Date().toISOString(), baseUrl: base, ok, results });
      if (!ok) this.logger.warn(`阳光采购推送失败 (announcementId=${announcement.id}): ${JSON.stringify(results)}`);
      else this.logger.log(`阳光采购推送完成 (announcementId=${announcement.id}): ${results.map(r => `${r.iface}=${r.status}`).join(', ')}`);
    } catch (e) {
      this.logger.error(`阳光采购推送异常 (announcementId=${announcement.id}): ${(e as Error).message}`);
    }
  }

  /** 单接口 POST；status 取返回体 status 字段（文档 0 成功/1 格式/2 IP/3 身份/4 主体缺失），异常体归一为 -1 */
  private async post(url: string, payload: unknown): Promise<{ status: number; message: string }> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: unknown; message?: unknown; msg?: unknown };
      const status = Number(data.status);
      if (!res.ok && !Number.isFinite(status)) {
        return { status: -1, message: `HTTP ${res.status}` };
      }
      return { status: Number.isFinite(status) ? status : -1, message: String(data.message ?? data.msg ?? '') };
    } catch (e) {
      return { status: -1, message: (e as Error).message };
    }
  }

  /** 结果写回公告 metadata（读改写合并；失败不抛——推送留痕尽力而为） */
  private async record(announcementId: string, meta: Record<string, unknown>, result: unknown): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.announcement.update({
        where: { id: announcementId },
        data: { metadata: { ...meta, sunshinePushResult: result } as object },
      });
    } catch (e) {
      this.logger.warn(`阳光采购推送留痕写入失败 (announcementId=${announcementId}): ${(e as Error).message}`);
    }
  }
}
