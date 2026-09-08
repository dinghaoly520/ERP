/**
 * 对外错误码常量——单一来源，杜绝字面量复制漂移。
 * 注意：这些 code 是 API 响应体契约的一部分（e2e/spec 已钉死），改字面量即破坏对外契约。
 */

/** 公钥格式校验失败（以专家侧字面量为基准） */
export const ERR_PUBLIC_KEY_INVALID = 'SM2_PUBLIC_KEY_INVALID';

/** 专家侧（expert.service.ts）别名——与主常量同值 */
export const ERR_PUBLIC_KEY_INVALID_EXPERT = ERR_PUBLIC_KEY_INVALID;

/**
 * 供应商侧（supplier-portal.service.ts）别名——先于专家侧落地的对外字面量，
 * 与专家侧不同值；为不破坏既有对外契约保留原字面量不变，
 * 两码对齐须待统一的对外契约变更窗口。
 */
export const ERR_PUBLIC_KEY_INVALID_SUPPLIER = 'INVALID_PUBLIC_KEY';
