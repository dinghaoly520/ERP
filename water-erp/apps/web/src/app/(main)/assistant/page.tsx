"use client";

import { ChatPanel } from "@/components/assistant/chat-panel";

export default function AssistantPage() {
  return (
    <div className="flex flex-1 flex-col min-h-0 h-full">
      <ChatPanel variant="page" />
    </div>
  );
}
