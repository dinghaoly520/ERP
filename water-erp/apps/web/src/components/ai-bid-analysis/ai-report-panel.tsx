'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, RefreshCw, Loader2, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { AiBidAnalysisTask, AiBidReport } from '@/lib/types/ai-bid-analysis';

interface AiReportPanelProps {
  taskId: string;
  task: AiBidAnalysisTask;
}

export default function AiReportPanel({ taskId, task }: AiReportPanelProps) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<AiBidReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiBidAnalysisApi.getReport(taskId);
      setReport(data);
    } catch {
      setError('加载报告失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReport(); }, [taskId]);

  const handleExportDocx = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/ai-bid-analysis/tasks/${taskId}/export/docx`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('导出失败');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `投标文件分析报告_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('导出失败: ' + String(err));
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <RefreshCw className="w-6 h-6 mx-auto animate-spin opacity-50" />
        <p className="mt-2 text-sm opacity-60">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <FileText className="w-10 h-10 mx-auto opacity-30" />
        <p className="mt-2 text-sm opacity-60">{error}</p>
        <button onClick={loadReport} className="mt-2 text-sm underline opacity-70 hover:opacity-100">
          重试
        </button>
      </div>
    );
  }

  if (!report?.summary) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <FileText className="w-10 h-10 mx-auto opacity-30" />
        <p className="mt-2 text-sm opacity-60">暂无报告数据</p>
      </div>
    );
  }
  const bidders = task.bidders || [];
  const completedBidders = bidders.filter(b => b.status === 'COMPLETED');
  const sortedBidders = [...completedBidders].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0));

  const rankBadge = (index: number) => {
    if (index === 0) return 'bg-yellow-100 text-yellow-700';
    if (index === 1) return 'bg-gray-100 text-gray-700';
    if (index === 2) return 'bg-orange-100 text-orange-700';
    return 'bg-gray-50 text-gray-500';
  };

  const riskBadge = (level: string | null) => {
    if (level === 'HIGH') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-100 text-red-700"><AlertCircle className="w-3 h-3" />高</span>;
    if (level === 'MEDIUM') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700"><AlertTriangle className="w-3 h-3" />中</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700"><CheckCircle className="w-3 h-3" />低</span>;
  };

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">分析报告</h3>
        <div className="flex items-center gap-2">
          <button onClick={loadReport} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--muted)' }}>
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={handleExportDocx}
            disabled={exporting}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-white"
            style={{ background: 'var(--accent)', opacity: exporting ? 0.7 : 1 }}
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? '导出中...' : '导出 DOCX'}
          </button>
        </div>
      </div>

      {/* 第一章：分析概述 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">一、分析概述</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-xs opacity-60">任务名称</div>
            <div className="font-medium mt-1">{task.name}</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-xs opacity-60">项目名称</div>
            <div className="font-medium mt-1">{task.projectName || '-'}</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-xs opacity-60">投标单位数</div>
            <div className="font-medium mt-1">{completedBidders.length} 家</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-xs opacity-60">报告生成时间</div>
            <div className="font-medium mt-1">{report.generatedAt ? new Date(report.generatedAt).toLocaleString('zh-CN') : '-'}</div>
          </div>
        </div>

        {/* 评分标准 */}
        {task.requirements?.scoringRules && (
          <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-sm font-medium mb-2">评分标准</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>技术分: {task.requirements.scoringRules.technicalMax}分</div>
              <div>商务分: {task.requirements.scoringRules.commercialMax}分</div>
              <div>报价分: {task.requirements.scoringRules.priceMax}分</div>
            </div>
          </div>
        )}
      </div>

      {/* 第二章：评分排名汇总 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">二、评分排名汇总</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="text-center py-2 px-2 w-12">排名</th>
                <th className="text-left py-2 px-2">投标单位</th>
                <th className="text-right py-2 px-2">技术分</th>
                <th className="text-right py-2 px-2">商务分</th>
                <th className="text-right py-2 px-2">报价分</th>
                <th className="text-right py-2 px-2 font-bold">总分</th>
                <th className="text-center py-2 px-2">风险等级</th>
                <th className="text-center py-2 px-2">资格状态</th>
              </tr>
            </thead>
            <tbody>
              {sortedBidders.map((bidder, i) => (
                <tr key={bidder.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 px-2 text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${rankBadge(i)}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-2 px-2 font-medium">{bidder.name}</td>
                  <td className="py-2 px-2 text-right">{Number(bidder.scores?.technical?.totalScore).toFixed(1) || '-'}</td>
                  <td className="py-2 px-2 text-right">{Number(bidder.scores?.commercial?.totalScore).toFixed(1) || '-'}</td>
                  <td className="py-2 px-2 text-right">{Number(bidder.scores?.price?.totalScore).toFixed(1) || '-'}</td>
                  <td className="py-2 px-2 text-right font-bold" style={{ color: 'var(--accent)' }}>
                    {Number(bidder.totalScore).toFixed(1)}
                  </td>
                  <td className="py-2 px-2 text-center">{riskBadge(bidder.riskLevel)}</td>
                  <td className="py-2 px-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      bidder.qualificationStatus === '通过' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {bidder.qualificationStatus || '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 第三章：关键信息对比 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">三、关键信息对比</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="text-left py-2 px-2 font-medium opacity-60">投标单位</th>
                <th className="text-right py-2 px-2 font-medium opacity-60">报价(万元)</th>
                <th className="text-left py-2 px-2 font-medium opacity-60">资质等级</th>
                <th className="text-center py-2 px-2 font-medium opacity-60">业绩数</th>
                <th className="text-left py-2 px-2 font-medium opacity-60">项目经理</th>
                <th className="text-left py-2 px-2 font-medium opacity-60">工期</th>
              </tr>
            </thead>
            <tbody>
              {completedBidders.filter(b => b.keyInfo).map((bidder) => {
                const ki = bidder.keyInfo!;
                const exceedsMax = task.requirements?.maxPrice && ki.quotePrice > task.requirements.maxPrice;
                return (
                  <tr key={bidder.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 px-2 font-medium">{bidder.name}</td>
                    <td className={`py-2 px-2 text-right font-bold ${exceedsMax ? 'text-red-600' : ''}`}>
                      {Number(ki.quotePrice).toFixed(2) || '-'}
                    </td>
                    <td className="py-2 px-2">{ki.qualificationLevel || '-'}</td>
                    <td className="py-2 px-2 text-center">{ki.performanceCount || 0}</td>
                    <td className="py-2 px-2">{ki.projectManager || '-'}</td>
                    <td className="py-2 px-2">{ki.constructionPeriod || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 第四章：各投标单位详细分析 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">四、各投标单位详细分析</h4>
        <div className="space-y-4">
          {sortedBidders.map((bidder) => (
            <div key={bidder.id} className="p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
              <h5 className="font-semibold mb-3">{bidder.name} (总分: {Number(bidder.totalScore).toFixed(1)})</h5>

              {/* 评分分项 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-sm">
                <div className="p-2 rounded text-center" style={{ background: 'var(--card)' }}>
                  <div className="text-xs opacity-60">技术分</div>
                  <div className="font-bold text-blue-600">{Number(bidder.scores?.technical?.totalScore).toFixed(1) || '-'}/{bidder.scores?.technical?.maxScore || 50}</div>
                </div>
                <div className="p-2 rounded text-center" style={{ background: 'var(--card)' }}>
                  <div className="text-xs opacity-60">商务分</div>
                  <div className="font-bold text-purple-600">{Number(bidder.scores?.commercial?.totalScore).toFixed(1) || '-'}/{bidder.scores?.commercial?.maxScore || 30}</div>
                </div>
                <div className="p-2 rounded text-center" style={{ background: 'var(--card)' }}>
                  <div className="text-xs opacity-60">报价分</div>
                  <div className="font-bold text-green-600">{Number(bidder.scores?.price?.totalScore).toFixed(1) || '-'}/{bidder.scores?.price?.maxScore || 20}</div>
                </div>
              </div>

              {/* 偏差分析 */}
              {bidder.deviationAnalysis && (
                <div className="mb-3 text-sm">
                  <div className="font-medium text-xs opacity-60 mb-1">偏差分析</div>
                  {bidder.deviationAnalysis.technicalDeviations?.length > 0 && (
                    <div className="text-xs space-y-1 mb-1">
                      {bidder.deviationAnalysis.technicalDeviations.map((d, i) => (
                        <div key={i} className="flex items-start gap-1">
                          <span className="text-amber-500 mt-0.5">!</span>
                          <span>技术偏差: {d.deviation} (影响: {d.impact})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {bidder.deviationAnalysis.commercialDeviations?.length > 0 && (
                    <div className="text-xs space-y-1">
                      {bidder.deviationAnalysis.commercialDeviations.map((d, i) => (
                        <div key={i} className="flex items-start gap-1">
                          <span className="text-amber-500 mt-0.5">!</span>
                          <span>商务偏差: {d.deviation}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(!bidder.deviationAnalysis.technicalDeviations?.length && !bidder.deviationAnalysis.commercialDeviations?.length) && (
                    <div className="text-xs text-green-600">完全响应，无偏差</div>
                  )}
                </div>
              )}

              {/* 风险 */}
              {bidder.riskAnalysis && bidder.riskAnalysis.riskFactors?.length > 0 && (
                <div className="text-xs space-y-1">
                  <div className="font-medium opacity-60">风险因素</div>
                  {bidder.riskAnalysis.riskFactors.map((f, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        f.severity === 'high' ? 'bg-red-500' : f.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                      }`} />
                      <span>{f.category}: {f.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 综合评价 */}
              {bidder.overallComment && (
                <div className="mt-2 text-sm opacity-80 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                  {bidder.overallComment}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 第五章：正向依据与需关注事项 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">五、正向依据与需关注事项</h4>
        <div className="space-y-3">
          {sortedBidders.map((bidder) => (
            <div key={bidder.id} className="grid grid-cols-2 gap-3 p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
              <div>
                <h5 className="text-sm font-medium mb-1 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  {bidder.name} - 正向依据
                </h5>
                {bidder.strengths?.length ? (
                  <ul className="text-xs space-y-0.5">
                    {bidder.strengths.map((s, i) => <li key={i} className="flex items-start gap-1"><span className="text-green-500">+</span>{s}</li>)}
                  </ul>
                ) : <span className="text-xs opacity-40">无</span>}
              </div>
              <div>
                <h5 className="text-sm font-medium mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  {bidder.name} - 需关注项
                </h5>
                {bidder.weaknesses?.length ? (
                  <ul className="text-xs space-y-0.5">
                    {bidder.weaknesses.map((w, i) => <li key={i} className="flex items-start gap-1"><span className="text-amber-500">-</span>{w}</li>)}
                  </ul>
                ) : <span className="text-xs opacity-40">无</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 第六章：风险提示与建议 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">六、风险提示与建议</h4>

        {/* 风险统计 */}
        {(() => {
          const riskCounts = { high: 0, medium: 0, low: 0 };
          completedBidders.forEach(b => {
            if (b.riskLevel === 'HIGH') riskCounts.high++;
            else if (b.riskLevel === 'MEDIUM') riskCounts.medium++;
            else riskCounts.low++;
          });
          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
              <div className="p-3 rounded-lg text-center bg-red-50">
                <div className="text-2xl font-bold text-red-600">{riskCounts.high}</div>
                <div className="text-xs opacity-60">高风险</div>
              </div>
              <div className="p-3 rounded-lg text-center bg-yellow-50">
                <div className="text-2xl font-bold text-yellow-600">{riskCounts.medium}</div>
                <div className="text-xs opacity-60">中风险</div>
              </div>
              <div className="p-3 rounded-lg text-center bg-green-50">
                <div className="text-2xl font-bold text-green-600">{riskCounts.low}</div>
                <div className="text-xs opacity-60">低风险</div>
              </div>
            </div>
          );
        })()}

        {/* 高风险投标单位详情 */}
        {completedBidders.filter(b => b.riskLevel === 'HIGH' || b.riskLevel === 'MEDIUM').length > 0 && (
          <div className="space-y-3">
            {completedBidders.filter(b => b.riskLevel === 'HIGH' || b.riskLevel === 'MEDIUM').map(bidder => (
              <div key={bidder.id} className="p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
                <div className="flex items-center gap-2 mb-1">
                  {riskBadge(bidder.riskLevel)}
                  <span className="font-medium">{bidder.name}</span>
                </div>
                {bidder.riskAnalysis?.riskFactors?.map((f, i) => (
                  <div key={i} className="text-xs mt-1">
                    <span className="font-medium">{f.category}:</span> {f.description} (严重度: {f.severity === 'high' ? '高' : f.severity === 'medium' ? '中' : '低'})
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 评审建议 */}
        {report.reviewSuggestions && (
          <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
            <div className="text-sm font-medium mb-1">评审建议</div>
            <p className="text-sm opacity-80">{typeof report.reviewSuggestions === 'string' ? report.reviewSuggestions : JSON.stringify(report.reviewSuggestions)}</p>
          </div>
        )}
      </div>

      {/* 第七章：综合结论 */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <h4 className="text-lg font-semibold mb-4">七、综合结论</h4>

        {/* 评分排序 */}
        {sortedBidders.length > 0 && (
          <div className="mb-4">
            <div className="text-sm font-medium mb-2">评分排序</div>
            <div className="space-y-2">
              {sortedBidders.slice(0, 3).map((bidder, i) => (
                <div key={bidder.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--muted)' }}>
                  <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${rankBadge(i)}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium">{bidder.name}</div>
                    <div className="text-xs opacity-60">
                      总分 {Number(bidder.totalScore).toFixed(1)} | 报价 {Number(bidder.keyInfo?.quotePrice).toFixed(2) || '-'}万元
                    </div>
                  </div>
                  {riskBadge(bidder.riskLevel)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 综合结论文本 */}
        {report.conclusion && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
            <p className="text-sm whitespace-pre-wrap opacity-80">
              {typeof report.conclusion === 'string' ? report.conclusion : JSON.stringify(report.conclusion)}
            </p>
          </div>
        )}
      </div>

      {/* 报告时间 */}
      {report.generatedAt && (
        <div className="text-xs opacity-50 text-center">
          报告生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}
        </div>
      )}
    </div>
  );
}
