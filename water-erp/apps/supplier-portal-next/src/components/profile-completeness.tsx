"use client";

import { CheckCircle2, ArrowRight } from "lucide-react";

/** 资料完整度卡片（环形进度）— 移植自 Vue ProfileCompleteness.vue */
export function ProfileCompleteness({ score, missing }: { score: number; missing: string[] }) {
  const color = score >= 80 ? "#059669" : score >= 50 ? "#d97706" : "#dc2626";
  const label = score >= 90 ? "优秀" : score >= 70 ? "良好" : score >= 50 ? "待完善" : "不完整";

  return (
    <div className="completeness-card">
      <div className="completeness-header">
        <span className="completeness-title">资料完整度</span>
        <span className="completeness-label" style={{ color }}>{label}</span>
      </div>

      <div className="completeness-ring">
        <svg viewBox="0 0 120 120" className="ring-svg">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="8" />
          <circle
            cx="60" cy="60" r="52" fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${score * 3.27} 327`}
            transform="rotate(-90 60 60)"
            className="ring-progress"
          />
        </svg>
        <div className="ring-text">
          <span className="ring-value" style={{ color }}>{score}</span>
          <span className="ring-unit">%</span>
        </div>
      </div>

      {missing.length > 0 && score < 100 ? (
        <div className="completeness-missing">
          <div className="missing-title">待完善项目：</div>
          <div className="missing-tags">
            {missing.map((m) => <span key={m} className="missing-tag">{m}</span>)}
          </div>
          <a href="/profile" className="completeness-go">去完善 <ArrowRight size={12} /></a>
        </div>
      ) : score >= 100 ? (
        <div className="completeness-done">
          <CheckCircle2 size={16} color="#059669" />
          <span>资料已完善</span>
        </div>
      ) : null}
    </div>
  );
}

/** 资料完整度横幅（Dashboard 顶部）— 移植自 Vue ProfileCompletenessBanner.vue */
const DIMENSIONS = [
  { key: "basic", label: "企业资质", weight: 45, gradient: ["#1a56db", "#2563EB"], items: ["企业名称", "统一社会信用代码", "企业类型", "法定代表人", "注册地址", "经营范围"] },
  { key: "contacts", label: "履约能力", weight: 20, gradient: ["#0e7490", "#0891b2"], items: ["联系人", "主要联系人"] },
  { key: "qualifications", label: "专业资质", weight: 35, gradient: ["#047857", "#059669"], items: ["资质材料", "营业执照"] },
] as const;

export function ProfileCompletenessBanner({ score, missing }: { score: number; missing: string[] }) {
  const dimensions = DIMENSIONS.map((dim) => {
    const totalItems = dim.items.length;
    const missingInDim = dim.items.filter((item) => missing.includes(item)).length;
    const completed = totalItems - missingInDim;
    const pct = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
    return { ...dim, pct };
  });

  const scoreColor = score >= 80 ? "#059669" : score >= 50 ? "#d97706" : "#dc2626";
  const scoreLabel = score >= 90 ? "优质" : score >= 70 ? "良好" : score >= 50 ? "一般" : "待提升";

  return (
    <div className="banner">
      {/* Left: Score ring */}
      <div className="banner-score-area">
        <div className="banner-ring">
          <svg viewBox="0 0 100 100" className="banner-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#edf2f7" strokeWidth="6" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke={scoreColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${score * 2.513} 251.3`}
              transform="rotate(-90 50 50)"
              className="banner-ring-progress"
            />
          </svg>
          <div className="banner-ring-text">
            <span className="banner-ring-num" style={{ color: scoreColor }}>{score}</span>
            <span className="banner-ring-unit">%</span>
          </div>
        </div>
        <div className="banner-score-label" style={{ color: scoreColor }}>{scoreLabel}</div>
      </div>

      {/* Center: Multi-color gradient bar */}
      <div className="banner-bar-wrap">
        <div className="banner-bar">
          {dimensions.map((dim) => (
            <div
              key={dim.key}
              className="banner-bar-seg"
              style={{
                width: `${dim.weight}%`,
                background: `linear-gradient(135deg, ${dim.gradient[0]}, ${dim.gradient[1]})`,
                opacity: dim.pct > 0 ? 0.9 : 0.15,
                filter: dim.pct > 0 ? "saturate(1)" : "saturate(0.3)",
              }}
            >
              {dim.pct >= 50 && <span className="banner-bar-seg-label">{dim.label}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Action */}
      <div className="banner-action-area">
        {score < 100 ? (
          <a href="/profile" className="neu-btn-primary sp-banner-btn">
            完善资料 <ArrowRight size={13} />
          </a>
        ) : (
          <span className="banner-all-done">
            <CheckCircle2 size={15} color="#059669" />
            资料齐全
          </span>
        )}
      </div>
    </div>
  );
}
