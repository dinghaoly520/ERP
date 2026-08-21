"use client";

/** 投标阶段时间线 — 移植自 Vue BidStageTimeline.vue */
const STAGES = [
  { key: "SUBMIT", label: "已提交" },
  { key: "OPENING", label: "开标" },
  { key: "EVALUATING", label: "评标" },
  { key: "ARCHIVED", label: "归档" },
] as const;

export function BidStageTimeline({ stage, aborted }: { stage: string; aborted?: boolean }) {
  const currentIndex = Math.max(0, STAGES.findIndex((s) => s.key === stage));

  function stateFor(i: number): "done" | "current" | "pending" {
    if (aborted) return i <= currentIndex ? "done" : "pending";
    if (i < currentIndex) return "done";
    if (i === currentIndex) return "current";
    return "pending";
  }

  return (
    <div className={`bid-timeline${aborted ? " aborted" : ""}`}>
      {STAGES.map((s, i) => (
        <span key={s.key} className="contents">
          <div className="bt-node">
            <span className={`bt-dot ${stateFor(i)}`} />
            <span className={`bt-label ${stateFor(i)}`}>{s.label}</span>
          </div>
          {i < STAGES.length - 1 && <div className={`bt-line${stateFor(i) === "done" ? " done" : ""}`} />}
        </span>
      ))}
    </div>
  );
}
