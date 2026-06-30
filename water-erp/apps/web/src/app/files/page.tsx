import { ModulePlaceholder } from "@/components/module-placeholder";

export default function FilesPage() {
  return (
    <ModulePlaceholder
      activeKey="files"
      title="文件中心"
      description="这里将承接招标文件、审查意见、投标分析、结果附件和合同的统一归档。"
      hint="你已经明确要求从第一阶段就支持附件，所以文件中心会和采购台账同步建设，而不是后补。"
    />
  );
}
