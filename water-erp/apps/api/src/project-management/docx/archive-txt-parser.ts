/**
 * 归档 TXT 解析器（纯函数，无 Nest 依赖）。
 *
 * 从 project-management.service.ts 抽离（2026-08 审计 P1：拆上帝服务）。
 * 把归档导出/回传的 TXT 正文解析为结构化数据（basicInfo/extractedInfo/stages/
 * summary/archiveHook），供 serveArchiveFile 预览与回流比对使用。
 */

export function parseArchiveTxt(content: string) {
  const lines = content.split('\n');
  const basicInfo: Record<string, string> = {};
  const extractedInfo: Record<string, string> = {};
  const stages: Array<{
    stageName: string;
    status: string;
    files: Array<{ fileName: string; analysis: string }>;
  }> = [];
  let summary = '';
  let archiveHook = '';

  let currentSection = '';
  let currentStage: typeof stages[0] | null = null;
  let currentExtractedKey: string | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Detect sections
    if (trimmedLine.includes('【项目基本信息】')) {
      currentSection = 'basicInfo';
      continue;
    }
    if (trimmedLine.includes('【提取信息】')) {
      currentSection = 'extractedInfo';
      continue;
    }
    if (trimmedLine.startsWith('【') && trimmedLine.includes('】') && trimmedLine.includes('步骤')) {
      // New stage section
      if (currentStage) {
        stages.push(currentStage);
      }
      const match = trimmedLine.match(/【(.+?)】.*（(.+?)）(.+)/);
      if (match) {
        currentStage = {
          stageName: match[1],
          status: match[3] || '',
          files: [],
        };
      }
      currentSection = 'stage';
      continue;
    }
    if (trimmedLine.includes('【项目简报】')) {
      if (currentStage) {
        stages.push(currentStage);
        currentStage = null;
      }
      currentSection = 'summary';
      continue;
    }

    // Note: Don't reset currentExtractedKey here - it needs to persist for continuation lines

    if (currentSection === 'basicInfo') {
      // Parse "  项目名称：xxx" format
      const match = trimmedLine.match(/^[　\s]*(.+?)[：:]\s*(.*)$/);
      if (match && match[2]) {
        const key = match[1].replace(/\s/g, '');
        const value = match[2].trim();
        // For multi-line fields like 专家信息/投标单位, skip count-only values like "共 5 位专家"
        if (['专家信息', '投标单位'].includes(key)) {
          if (/^共\s*\d+\s*(位专家|家单位)$/.test(value)) {
            // Initialize as empty - actual content will come from continuation lines
            basicInfo[key] = '';
          } else {
            basicInfo[key] = value;
          }
          currentExtractedKey = key;
        } else {
          basicInfo[key] = value;
          currentExtractedKey = null; // Reset for non-multi-line fields
        }
      } else if (currentExtractedKey && trimmedLine && !trimmedLine.startsWith('─') && !trimmedLine.startsWith('═') && !trimmedLine.startsWith('【')) {
        // This is a continuation line for 专家信息 or 投标单位
        // Skip the count line like "共 5 位专家" or "共 3 家单位"
        const isCountLine = /^共\s*\d+\s*(位专家|家单位)$/.test(trimmedLine);
        if (!isCountLine) {
          basicInfo[currentExtractedKey] += `${basicInfo[currentExtractedKey] ? '\n' : ''}${trimmedLine}`;
        }
      }
    }

    if (currentSection === 'extractedInfo') {
      const match = trimmedLine.match(/^[　\s]*(.+?)[：:]\s*(.*)$/);
      if (match) {
        const key = match[1].replace(/\s/g, '');
        const value = match[2].trim();
        // For multi-line fields, skip count-only values
        if (['专家信息', '投标单位'].includes(key)) {
          if (/^共\s*\d+\s*(位专家|家单位)$/.test(value)) {
            extractedInfo[key] = '';
          } else {
            extractedInfo[key] = value;
          }
          currentExtractedKey = key;
        } else {
          extractedInfo[key] = value;
          currentExtractedKey = null;
        }
      } else if (currentExtractedKey && trimmedLine && !trimmedLine.startsWith('─') && !trimmedLine.startsWith('═') && !trimmedLine.startsWith('【')) {
        const isCountLine = /^共\s*\d+\s*(位专家|家单位)$/.test(trimmedLine);
        if (!isCountLine) {
          extractedInfo[currentExtractedKey] += `${extractedInfo[currentExtractedKey] ? '\n' : ''}${trimmedLine}`;
        }
      }
    }

    // Reset currentExtractedKey when leaving basicInfo or extractedInfo sections
    if (currentSection !== 'basicInfo' && currentSection !== 'extractedInfo') {
      currentExtractedKey = null;
    }

    if (currentSection === 'stage' && currentStage) {
      // Parse file info - handle both single file and multi-file formats
      if (trimmedLine === '文件：' || trimmedLine === '文件:') {
        // Multi-file format: files listed on subsequent lines
        continue;
      }

      // Skip "文件分析：" marker line - it's not a file, just a section header
      if (trimmedLine === '文件分析：' || trimmedLine === '文件分析:') {
        continue;
      }

      // Check for file line format: "文件：xxx.pdf" or "文件1：xxx.pdf" or "文件2：xxx.pdf"
      // But NOT "文件分析：" which is a different thing
      if (trimmedLine.startsWith('文件') && (trimmedLine.includes('：') || trimmedLine.includes(':'))) {
        const match = trimmedLine.match(/文件\d*[:：]\s*(.+)/);
        if (match && match[1] && match[1].trim() !== '（无）') {
          currentStage.files.push({
            fileName: match[1].trim(),
            analysis: '',
          });
        }
      } else if (trimmedLine === '文件：（无）') {
        // No files in this stage
        continue;
      } else if (trimmedLine && !trimmedLine.startsWith('─') && !trimmedLine.startsWith('═') && !trimmedLine.startsWith('【')) {
        // This could be a file name (in multi-file format) or analysis content
        // Check if it looks like a file name (contains .pdf, .doc, .xlsx etc)
        const isFileName = /\.(pdf|doc|docx|xlsx|xls|txt|zip|rar)$/i.test(trimmedLine);

        if (isFileName && currentStage) {
          // This is a file name in multi-file format
          currentStage.files.push({
            fileName: trimmedLine,
            analysis: '',
          });
        } else if (currentStage && currentStage.files.length > 0) {
          // This is analysis content - append to the last file
          const lastFile = currentStage.files[currentStage.files.length - 1];

          // For multi-file case, try to split analysis by paragraphs
          if (currentStage.files.length > 1) {
            // Check if this line starts a new analysis paragraph (starts with "该文件为")
            if (trimmedLine.startsWith('该文件为') && lastFile.analysis) {
              // This is a new file's analysis, find which file doesn't have analysis yet
              const fileWithoutAnalysis = currentStage.files.find(f => !f.analysis);
              if (fileWithoutAnalysis) {
                fileWithoutAnalysis.analysis = trimmedLine;
              } else {
                lastFile.analysis += '\n' + trimmedLine;
              }
            } else {
              lastFile.analysis += (lastFile.analysis ? '\n' : '') + trimmedLine;
            }
          } else {
            // Single file - just append
            lastFile.analysis += (lastFile.analysis ? '\n' : '') + trimmedLine;
          }
        }
      }
    }

    if (currentSection === 'summary') {
      if (trimmedLine && !trimmedLine.startsWith('═') && !trimmedLine.startsWith('归档时间')) {
        summary += (summary ? '\n' : '') + trimmedLine;
      }
    }

    // Extract archive hook from line like "归档标识：ARCHIVE-xxx"
    if (trimmedLine.startsWith('归档标识：')) {
      archiveHook = trimmedLine.replace('归档标识：', '').trim();
    }
  }

  // Map extracted info fields from basicInfo for frontend compatibility
  // Frontend expects these fields in extractedInfo
  const extractedInfoFields = ['立项时间', '专家信息', '投标单位', '中标单位', '合同金额'];
  for (const field of extractedInfoFields) {
    if (basicInfo[field]) {
      extractedInfo[field] = basicInfo[field];
    }
  }

  return {
    basicInfo,
    extractedInfo,
    stages,
    summary,
    archiveHook,
  };
  }
