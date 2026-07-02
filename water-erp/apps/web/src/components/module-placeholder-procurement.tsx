import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import type { AuthRole } from "@/lib/api/auth";

type ModulePlaceholderProps = {
  activeKey: string;
  title: string;
  description: string;
  hint: string;
  currentUserRole?: AuthRole;
};

export function ModulePlaceholder({
  activeKey,
  title,
  description,
  hint,
  currentUserRole,
}: ModulePlaceholderProps) {
  return (
    <AppShell
      activeKey={activeKey}
      title={title}
      description={description}
      currentUserRole={currentUserRole}
    >
      <div className="panel-soft panel-lens rounded-[30px] p-6 sm:p-7">
        <div className="max-w-2xl">
          <div className="section-kicker">Module Preview</div>
          <div className="mt-4 text-sm leading-7 text-[color:var(--muted-foreground)]">
            {hint}
          </div>
          <div className="mt-6">
            <Link
              href="/procurements"
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.82),rgba(236,242,255,0.72))] px-4 py-2 text-sm font-medium text-[color:var(--accent)] shadow-[0_12px_24px_rgba(57,88,142,0.06)]"
            >
              <ArrowLeft size={16} />
              返回采购台账
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
