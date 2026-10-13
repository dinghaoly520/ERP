"use client";

import { SectionCard } from "@/components/m/section-card";
import { EmptyState } from "@/components/m/empty-state";

export default function Page() {
  return (
    <SectionCard title="台账">
      <EmptyState text="建设中" />
    </SectionCard>
  );
}
