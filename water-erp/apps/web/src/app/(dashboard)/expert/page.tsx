import ModulePlaceholder from '@/components/module-placeholder';

export default function ExpertPage() {
  return (
    <ModulePlaceholder
      title="专家管理"
      desc="专家库管理、随机抽取、回避设置、专家评价与评审任务分配"
      features={['专家库', '专家抽取', '评审任务', '回避设置', '专家评价']}
    />
  );
}
