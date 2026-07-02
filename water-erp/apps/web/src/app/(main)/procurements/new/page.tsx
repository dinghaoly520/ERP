import { ModulePlaceholder } from "@/components/module-placeholder";

export default function NewProcurementPage() {
  return (
    <ModulePlaceholder
      activeKey="procurements"
      title="新增采购事项"
      description="这里将承接手工补录入口，用于新增项目、追加轮次和修正历史数据。"
      hint="手工录入是导入闭环的补充，不代替 Excel 导入，但必须能支持后续追加轮次、补附件和修订结果。"
    />
  );
}
