export default function ModulePlaceholder({ title, desc, features }: { title: string; desc: string; features: string[] }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">{title}</h1>
      <p className="text-sm text-[#5a6d8a] mb-8">{desc}</p>
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-8 text-center">
        <div className="text-5xl mb-4">🚧</div>
        <h2 className="text-lg font-bold text-[#18243a] mb-2">模块开发中</h2>
        <p className="text-[#5a6d8a] mb-6">该模块正在建设中，敬请期待</p>
        <div className="flex flex-wrap justify-center gap-3">
          {features.map(f => <span key={f} className="px-4 py-2 bg-[#f8fbff] text-sm text-[#064ea2] rounded-lg border border-[#e8f0fa]">{f}</span>)}
        </div>
      </div>
    </div>
  );
}
