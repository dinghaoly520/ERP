/**
 * 一次性转换（2026-10-09 二期，用户拍板）：docx 模板固定串 → 显式占位符。
 *
 *   四川水发勘测设计研究有限公司纪检监察部 → {{监督部门}}
 *   三种历史地址写法                         → {{监督地址}}
 *   王先生、徐先生 / 王先生                  → {{监督人}}
 *   028-81753276                            → {{监督电话}}
 *   四川水发勘测设计研究有限公司（兜底，最后）→ {{采购人名称}}
 *
 * 跨 run 感知（复用 tenant-tokens.replaceTextAcrossRuns）：实测多个模板的公司名/
 * 「王先生、徐先生」被 Word 拆进多个 <w:t> run，朴素字符串替换会漏。
 * 幂等：已转换的文件不再命中固定串，重跑无副作用。
 * 运行：cd apps/api && npx tsx scripts/convert-templates-to-placeholders.ts
 * 注意：直接采购备案表模板本就使用 {{采购人名称}} 占位符（无固定串），自然跳过。
 */
import * as path from 'path';
import { promises as fs } from 'fs';
import * as JSZip from 'jszip';
import { replaceTextAcrossRuns } from '../src/tender-write/tenant-tokens';

/** 顺序敏感：监督块整串（含公司名）在前，裸公司名兜底在最后 */
const CONVERSIONS: Array<{ token: string; placeholder: string; label: string }> = [
  { token: '四川水发勘测设计研究有限公司纪检监察部', placeholder: '{{监督部门}}', label: '监督部门' },
  { token: '四川省成都市双流区红莲街三段383号四川水发集团B座9楼', placeholder: '{{监督地址}}', label: '监督地址(双流)' },
  { token: '四川省成都市天府新区红莲街三段383号', placeholder: '{{监督地址}}', label: '监督地址(天府)' },
  { token: '成都市天府新区红莲街383号B栋9楼', placeholder: '{{监督地址}}', label: '监督地址(中标)' },
  { token: '王先生、徐先生', placeholder: '{{监督人}}', label: '监督人(双人)' },
  { token: '王先生', placeholder: '{{监督人}}', label: '监督人(单人)' },
  { token: '028-81753276', placeholder: '{{监督电话}}', label: '监督电话' },
  { token: '四川水发勘测设计研究有限公司', placeholder: '{{采购人名称}}', label: '采购人名称' },
];

async function convertFile(filePath: string): Promise<boolean> {
  const originalBuffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(originalBuffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    console.log(`  ✗ 缺少 word/document.xml，跳过`);
    return false;
  }
  let xml = await documentFile.async('string');
  const report: string[] = [];
  for (const { token, placeholder, label } of CONVERSIONS) {
    let count = 0;
    // 逐次替换直至无命中（同串多处全替换），与运行时算法一致
    for (let guard = 0; guard < 50; guard += 1) {
      const next = replaceTextAcrossRuns(xml, token, placeholder);
      if (next === xml) break;
      count += 1;
      xml = next;
    }
    if (count > 0) report.push(`${label}×${count}`);
  }
  if (report.length === 0) {
    console.log(`  · 无固定串（已转换或本无），不动`);
    return false;
  }
  zip.file('word/document.xml', xml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(filePath, buffer);
  console.log(`  ✓ ${report.join('，')}`);
  return true;
}

async function verifyFile(filePath: string): Promise<void> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const xml = await zip.file('word/document.xml')!.async('string');
  const plain = xml.replace(/<[^>]*>/g, '');
  const leftovers = CONVERSIONS.filter(({ token }) => plain.includes(token));
  const placeholderCount = (name: string) =>
    (plain.match(new RegExp(name.replace(/[{}]/g, '\\$&'), 'g')) || []).length;
  const summary = {
    采购人名称: placeholderCount('{{采购人名称}}'),
    监督部门: placeholderCount('{{监督部门}}'),
    监督地址: placeholderCount('{{监督地址}}'),
    监督人: placeholderCount('{{监督人}}'),
    监督电话: placeholderCount('{{监督电话}}'),
  };
  if (leftovers.length > 0) {
    console.log(`  ✗✗ 仍残留固定串：${leftovers.map((l) => l.label).join('，')} —— 请人工检查！`);
  } else {
    console.log(
      `  验证：零残留；占位符 {{采购人名称}}×${summary.采购人名称} {{监督部门}}×${summary.监督部门} {{监督地址}}×${summary.监督地址} {{监督人}}×${summary.监督人} {{监督电话}}×${summary.监督电话}`,
    );
  }
}

async function main() {
  const dir = path.resolve(__dirname, '..', '模板文件');
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith('.docx'))
    .sort();
  console.log(`转换目录：${dir}\n`);
  for (const f of files) {
    console.log(`== ${f}`);
    const filePath = path.join(dir, f);
    await convertFile(filePath);
    await verifyFile(filePath);
  }
  console.log('\n完成。渲染端由 buildTenantPlaceholderReplacements 填充（tender-write.service）。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
