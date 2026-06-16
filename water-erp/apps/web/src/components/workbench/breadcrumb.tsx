import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

interface Crumb { label: string; path?: string; }

export function Breadcrumb({ items }: { items: Crumb[] }) {
  const router = useRouter();
  return (
    <nav className="flex items-center gap-1.5 text-xs text-[#8a99ad] mb-4" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={11} className="text-[#d4d8e0]" />}
          {c.path ? (
            <button onClick={() => router.push(c.path!)} className="font-semibold hover:text-[#064ea2] transition">{c.label}</button>
          ) : (
            <span className="font-extrabold text-[#18243a]">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
