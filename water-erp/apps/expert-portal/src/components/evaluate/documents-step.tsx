'use client';

import { Download, FileText, Lock } from 'lucide-react';
import type { ExpertProjectDetail, DecryptedDocuments } from '@/lib/types';
import { DECRYPT_LABEL } from '@water-erp/shared';
import { formatBytes } from '@/lib/utils';

interface DocumentsStepProps {
  project: ExpertProjectDetail;
  documents: Record<string, DecryptedDocuments | null>;
}

export function DocumentsStep({ project, documents }: DocumentsStepProps) {
  return (
    <div className="p-6 pt-4">
      {/* 招标文件（项目级，专家独立核对原文 ★号实质性条款）*/}
      <div className="mb-5 border border-[#064ea2]/30 rounded-xl overflow-hidden bg-gradient-to-br from-blue-50/60 to-white">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#064ea2]/15">
          <div className="w-7 h-7 rounded-lg bg-[#064ea2] flex items-center justify-center text-white shrink-0">
            <FileText size={15} strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]">招标文件</h3>
            <p className="text-[10px] text-[oklch(0.55_0.01_264)]">评标依据原文 · 请独立核对 ★号实质性条款</p>
          </div>
        </div>
        <div className="p-4">
          {project.tenderDocument ? (
            <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#064ea2]/15 hover:shadow-sm transition-all">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white text-[9px] font-bold uppercase shrink-0">
                PDF
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-xs text-[oklch(0.18_0.012_265)] truncate" title={project.tenderDocument.fileName}>{project.tenderDocument.fileName}</h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[oklch(0.55_0.01_264)]">{formatBytes(project.tenderDocument.fileSize)}</span>
                  <span className="text-[10px] text-[#064ea2] font-semibold">可预览</span>
                </div>
              </div>
              <a href={project.tenderDocument.downloadUrl} target="_blank" rel="noopener" className="flex items-center gap-1 px-3 py-1.5 bg-[#064ea2] text-white text-[11px] rounded-lg hover:bg-[#054280] transition shrink-0">
                <Download size={12} strokeWidth={1.5} /> 预览
              </a>
            </div>
          ) : (
            <div className="text-center py-5 text-[oklch(0.55_0.01_264)]">
              <FileText size={26} strokeWidth={1} className="text-[#cbd5e1] mx-auto mb-2" />
              <p className="text-xs">本项目暂无招标文件</p>
            </div>
          )}
        </div>
      </div>

      {Object.keys(documents).length === 0 ? (
        <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">
          <div className="mb-3"><FileText size={40} strokeWidth={1} className="text-[#cbd5e1]" /></div>
          <p>正在加载标书...</p>
        </div>
      ) : (
        <div className="space-y-5">
          {project.suppliers.map(sup => {
            const doc = documents[sup.id];
            if (!doc) return null;
            return (
              <div key={sup.id} className="border border-[oklch(0.91_0.006_264)] rounded-xl overflow-hidden">
                {/* 供应商头部 */}
                <div className="flex items-center justify-between px-4 py-3 bg-[oklch(0.97_0.005_264)] border-b border-[oklch(0.91_0.006_264)]">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full ${
                      sup.decryptStatus === 'SUCCESS' ? 'bg-[#11a874]'
                      : sup.decryptStatus === 'DANGER' ? 'bg-[#e74c3c]' : 'bg-[#f5a623]'
                    }`} />
                    <h3 className="font-bold text-sm text-[oklch(0.18_0.012_265)]">{sup.supplierName}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      sup.decryptStatus === 'SUCCESS' ? 'bg-emerald-100 text-[#11a874]'
                      : sup.decryptStatus === 'DANGER' ? 'bg-red-100 text-[#e74c3c]' : 'bg-amber-100 text-[#f5a623]'
                    }`}>
                      {DECRYPT_LABEL[sup.decryptStatus] || sup.decryptStatus}
                    </span>
                  </div>
                  {!doc.canView && (
                    <span className="text-[11px] text-amber-600 font-medium">标书尚未解密</span>
                  )}
                </div>

                {/* 文件列表 */}
                <div className="p-4">
                  {!doc.canView ? (
                    <p className="text-sm text-[oklch(0.55_0.01_264)]">请等待开标主持端完成解密</p>
                  ) : doc.documents.length === 0 ? (
                    <p className="text-sm text-[oklch(0.55_0.01_264)] text-center py-4">该供应商未提交可查看的投标文件</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {doc.documents.map((d, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100 hover:shadow-sm transition-all">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white text-[9px] font-bold uppercase shrink-0">
                            {d.type.replace('application/', '').replace('image/', '').replace('vnd.', '').slice(0, 4)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-xs text-[oklch(0.18_0.012_265)] truncate" title={d.originalName}>{d.originalName}</h4>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-[oklch(0.55_0.01_264)]">{formatBytes(d.size)}</span>
                              <span className="text-[10px] text-emerald-600 font-semibold">{d.status}</span>
                            </div>
                          </div>
                          {d.downloadUrl ? (
                            <a href={d.downloadUrl} target="_blank" rel="noopener" className="flex items-center gap-1 px-2.5 py-1.5 bg-[#064ea2] text-white text-[11px] rounded-lg hover:bg-[#054280] transition shrink-0">
                              <Download size={12} strokeWidth={1.5} /> 预览
                            </a>
                          ) : (
                            <span className="text-[10px] text-[oklch(0.62_0.008_264)] px-2 py-1 shrink-0">待解密</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
