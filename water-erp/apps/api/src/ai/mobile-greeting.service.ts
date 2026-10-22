import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';

/** 时段标签（驱动 LLM 语境与兜底文案，按上海时区判定） */
function periodOf(hour: number): string {
  if (hour < 5) return '深夜';
  if (hour < 8) return '清晨';
  if (hour < 11) return '上午';
  if (hour < 13) return '午间';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  return '晚上';
}

const WEEKDAY_ZH: Record<string, string> = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

const ROLE_LABEL: Record<string, string> = { admin: '管理员', leader: '负责人', staff: '专员' };

/** LLM 不可用/超时的时段兜底（保证端点恒有返回；前端无静态保底行，2026-10-22 用户裁定） */
const FALLBACK: Record<string, string> = {
  深夜: '夜深了，采购动态已守护妥当，早些休息',
  清晨: '新的一天开始了，愿采购工作顺利启程',
  上午: '上午好，今日采购动态已备好',
  午间: '午间片刻，采购全局一览无余',
  下午: '下午好，愿每一笔采购都从容有序',
  傍晚: '今日工作渐入尾声，辛苦了',
  晚上: '晚上好，采购数据已同步至最新',
};

/**
 * 移动驾驶舱（:3011）顶部欢迎语——LLM 现场生成。
 * 2026-10-22 用户裁定：不做任何缓存（前端 sessionStorage 日缓存与后端 Redis 按日缓存均已撤），
 * 每次进入/刷新页面都生成新句；LLM 故障时退化为时段兜底句，端点恒有返回。
 */
@Injectable()
export class MobileGreetingService {
  private readonly logger = new Logger(MobileGreetingService.name);

  constructor(private readonly llm: LlmService) {}

  async getGreeting(user: { role: string }): Promise<{ text: string; source: 'llm' | 'fallback' }> {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? now.getHours());
    const weekday = WEEKDAY_ZH[parts.find((p) => p.type === 'weekday')?.value ?? ''] ?? '一';
    const period = periodOf(Number.isFinite(hour) ? hour : now.getHours());

    try {
      const raw = await this.llm.chat(
        [
          '你是「蜀水云采」智慧采购平台的欢迎语撰写器。',
          '只输出一句简短的中文欢迎语正文：14~20 个汉字，语气温暖专业、贴合政企采购办公场景。',
          '禁止 emoji、禁止任何引号、禁止称呼或提及用户姓名、禁止以「欢迎回到」开头、不要输出这句欢迎语以外的任何内容。',
        ].join(''),
        `当前时段：${period}，星期${weekday}。用户是采购管理平台的${ROLE_LABEL[user.role] ?? '成员'}。请生成一句与既往不重复的欢迎语。`,
        0.9,
        undefined,
        Math.floor(Math.random() * 1_000_000),
        // 延迟敏感（首屏背景请求）：短超时 + 放弃第二次重试，失败走时段兜底。
        // maxTokens 须给足：deepseek-v4-flash 为推理型模型，思维链与正文共享预算
        // （96 实测思维链常超支 → finish_reason=length + content 空 → 兜底），1024 稳出正文。
        { maxTokens: 1024, timeoutMs: 15_000, retries: 1 },
      );
      const text = this.sanitize(raw);
      if (text) return { text, source: 'llm' };
    } catch (err) {
      this.logger.warn(`欢迎语生成失败，使用时段兜底：${err instanceof Error ? err.message : err}`);
    }
    return { text: FALLBACK[period], source: 'fallback' };
  }

  /** 出口净化：剥首尾引号/空白、折叠换行，超长截断（前端另有 CSS truncate 兜底） */
  private sanitize(raw: string): string {
    const t = raw
      .replace(/^[\s"'「」『』“”‘’]+|[\s"'「」『』“”‘’]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > 40 ? t.slice(0, 40) : t;
  }
}
