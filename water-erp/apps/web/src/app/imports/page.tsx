import { ModulePlaceholder } from "@/components/module-placeholder";

export default function ImportsPage() {
  return (
    <ModulePlaceholder
      activeKey="imports"
      title="数据导入"
      description="这里将承接 Excel 上传、字段映射、预览校验、导入确认和导入批次日志。"
      hint="第一阶段的核心入口之一。历史月报将从这里进入系统，并在导入前完成空值、异常状态和重复项目的识别。"
    />
  );
}
