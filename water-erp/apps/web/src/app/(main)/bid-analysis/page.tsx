"use client";

import { useState } from "react";
import AiTaskList from "@/components/ai-bid-analysis/ai-task-list";
import AiTaskWorkspace from "@/components/ai-bid-analysis/ai-task-workspace";

export default function BidAnalysisPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  return (
    <main className="min-h-0">
      {selectedTaskId ? (
        <AiTaskWorkspace taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} />
      ) : (
        <AiTaskList onSelectTask={setSelectedTaskId} />
      )}
    </main>
  );
}
