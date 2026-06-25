#!/usr/bin/env python3
# 生成 4 个 hero 投标 PDF（2 家解密成功供应商 × tech/biz），供 seed 上传 MinIO
# 内容含投标关键信息（公司/报价/工期/资质/法人/项目经理），供 OCR + LLM extract
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
os.makedirs('/tmp/seed-pdf', exist_ok=True)

FILES = {
    'tech01': {'bidder': '四川水发建设有限公司', 'type': '技术标',
               'price': '2350万元', 'period': '540日历天', 'legal': '张明',
               'qual': '水利水电工程施工总承包甲级', 'pm': '李强（一级注册建造师）',
               'perf': '近5年完成类似水利信息化项目5个'},
    'biz01': {'bidder': '四川水发建设有限公司', 'type': '商务标',
              'price': '2350万元', 'period': '540日历天', 'legal': '张明',
              'qual': '水利水电工程施工总承包甲级', 'credit': '91510000MA0001XX01',
              'capital': '人民币5000万元整'},
    'tech02': {'bidder': '中科院成都信息技术股份有限公司', 'type': '技术标',
               'price': '2280万元', 'period': '520日历天', 'legal': '王伟',
               'qual': '电子与智能化工程专业承包一级', 'pm': '赵敏（高级工程师）',
               'perf': '近5年完成信息化项目8个'},
    'biz02': {'bidder': '中科院成都信息技术股份有限公司', 'type': '商务标',
              'price': '2280万元', 'period': '520日历天', 'legal': '王伟',
              'qual': '电子与智能化工程专业承包一级', 'credit': '91510000MA0002XX02',
              'capital': '人民币3000万元整'},
}

for fname, info in FILES.items():
    c = canvas.Canvas(f'/tmp/seed-pdf/submission-{fname}.pdf', pagesize=A4)
    c.setFont('STSong-Light', 18)
    c.drawString(100, 800, info['bidder'])
    c.setFont('STSong-Light', 14)
    c.drawString(100, 770, f"{info['type']}文件")
    c.setFont('STSong-Light', 11)
    y = 720
    rows = [
        f"法定代表人：{info['legal']}",
        f"投标报价：{info['price']}",
        f"工期：{info['period']}",
        f"资质等级：{info['qual']}",
    ]
    if 'pm' in info:
        rows.append(f"拟任项目经理：{info['pm']}")
    if 'perf' in info:
        rows.append(f"业绩：{info['perf']}")
    if 'credit' in info:
        rows.append(f"统一社会信用代码：{info['credit']}")
    if 'capital' in info:
        rows.append(f"注册资本：{info['capital']}")
    rows += ['联系方式：028-88888001', '电子邮箱：contact@bidder.com', '注册地址：成都市高新区天府大道']
    for r in rows:
        c.drawString(100, y, r)
        y -= 22
    y -= 15
    c.drawString(100, y, '技术方案：本项目采用先进的智慧水利大数据平台架构，')
    y -= 18
    c.drawString(100, y, '覆盖数据采集、传输、存储、分析、可视化全链路，')
    y -= 18
    c.drawString(100, y, '系统稳定、安全、可扩展，满足招标文件全部技术要求。')
    y -= 18
    c.drawString(100, y, '质量保证：通过ISO9001质量管理体系认证，承诺竣工验收合格率100%。')
    c.save()
    print(f'Generated submission-{fname}.pdf')

print('Done: 4 PDFs in /tmp/seed-pdf/')
