#!/usr/bin/env python3
"""从同批交底主文抽取可筛选功能组；不读业务库、不执行测试。"""
import csv
import re
from pathlib import Path

directory = Path(__file__).resolve().parent
source = directory.parent / '第三方测试交底-技术栈与功能清单-2026-10-08-代码核验版.md'
rows = []
section = ''
for line in source.read_text(encoding='utf-8').splitlines():
    if re.match(r'^### \d+\.\d+ ', line):
        section = line.removeprefix('### ')
    if not re.match(r'^\| (PUB|MALL|SUP|WEB|EXP|BID|AUX|BE)-\d+ ', line):
        continue
    cells = [c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', line)[1:-1]]
    if cells[0].startswith('BE-'):
        identifier, name, details, evidence = cells
        boundary = '授权条件、状态限制及实现范围列于操作说明。'
    else:
        identifier, name, details, boundary, evidence = cells
    rows.append([identifier, section, name, details, boundary, evidence, '未执行', ''])

assert len({row[0] for row in rows}) == len(rows), '功能编号重复'
destination = directory / '07-功能点测试矩阵.csv'
with destination.open('w', encoding='utf-8-sig', newline='') as output:
    writer = csv.writer(output)
    writer.writerow(['功能编号', '功能域', '功能或页面', '操作与内容', '前置与能力边界', '源码依据', '测试状态', '缺陷编号'])
    writer.writerows(rows)
print(f'{destination.name}: {len(rows)} 功能组；测试状态统一未执行。')
