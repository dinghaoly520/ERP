#!/usr/bin/env python3
# 生成 cmqhero-bid-proj01 招标文件 PDF（供 seed 加密后上传 MinIO）。
# 内容含 ★号实质性条款（一票否决项），呼应专家评审"独立核对招标文件原文"动机——
# 见 docs/superpowers/specs/2026-06-29-expert-tender-document-preview-design.md 验证前置。
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
os.makedirs('/tmp/seed-pdf', exist_ok=True)

OUT = '/tmp/seed-pdf/tender-hero.pdf'
PAGE_W, PAGE_H = A4  # noqa: F841  (保留语义，与 MARGIN 一同表达版心)
MARGIN = 80
LINE_H = 18

c = canvas.Canvas(OUT, pagesize=A4)
y = PAGE_H - MARGIN


def newline(spacing=LINE_H):
    """向下移动一行；空间不足则换页并重置字体。"""
    global y
    y -= spacing
    if y < MARGIN:
        c.showPage()
        c.setFont('STSong-Light', 11)
        y = PAGE_H - MARGIN


def title(text, size=18, spacing=28):
    c.setFont('STSong-Light', size)
    c.drawString(MARGIN, y, text)
    newline(spacing)


def h2(text):
    newline(8)
    c.setFont('STSong-Light', 13)
    c.drawString(MARGIN, y, text)
    newline(22)


def body(text, indent=0, spacing=LINE_H):
    c.setFont('STSong-Light', 11)
    c.drawString(MARGIN + indent, y, text)
    newline(spacing)


# ── 封面 ──
title('2026 年度智慧水利大数据平台建设项目', 18, 30)
title('招  标  文  件', 16, 24)
body('项目编号：BID-2026-HERO1')
body('采 购 人：四川水发集团')
body('采购方式：公开招标')
newline(10)

# ── 第一章 总则 ──
h2('第一章  总则')
body('1.1  本项目为 2026 年度智慧水利大数据平台建设，资金来源为企业自筹，已落实。')
body('1.2  本招标文件是投标人编制投标文件及评标委员会评审的唯一依据。')

# ── 第二章 ★资格要求 ──
h2('第二章  ★投标人资格要求（实质性条款）')
body('★ 2.1  具备水利水电工程施工总承包甲级资质，或电子与智能化工程专业承包一级资质。')
body('★ 2.2  近五年（2021—2026）完成不少于 3 个合同金额 1000 万元以上的水利信息化或大数据平台项目。')
body('★ 2.3  拟任项目经理须为水利水电工程一级注册建造师，且无在建项目。')
body('★ 2.4  投标人依法注册，近三年无重大违法记录。')

# ── 第三章 ★技术要求 ──
h2('第三章  ★技术要求（实质性条款）')
body('★ 3.1  建设工期不超过 540 日历天（自合同签订之日起）。')
body('★ 3.2  质量标准：竣工验收一次性合格，系统稳定运行率不低于 99.5%。')
body('3.3  平台须覆盖数据采集、传输、存储、分析、可视化全链路。')
body('3.4  支持不少于 1000 个监测点位并发接入，具备横向扩展能力。')

# ── 第四章 ★商务要求 ──
h2('第四章  ★商务要求（实质性条款）')
body('★ 4.1  最高投标限价：人民币 2500 万元整。投标报价超过限价的按废标处理。')
body('4.2  报价须为闭口总价，含设备、软件、实施及一年运维。')
body('4.3  付款方式：预付款 20%、里程碑款 60%、验收款 15%、质保金 5%。')

# ── 第五章 评标办法 ──
h2('第五章  评标办法')
body('5.1  采用综合评分法，满分 100 分。')
body('5.2  商务部分 30 分（资质、业绩、财务能力）。')
body('5.3  技术部分 50 分（技术方案、项目团队、实施计划）。')
body('5.4  价格部分 20 分（以最低有效报价为基准）。')

# ── 第六章 投标文件组成 ──
h2('第六章  投标文件组成')
body('6.1  投标人须同时提交：技术方案、商务文件、投标函，三件缺一不可。')
body('6.2  任一实质性条款不响应，评标委员会按废标处理。')

# ── 第七章 ★汇总 ──
h2('第七章  ★实质性条款汇总（一票否决项）')
body('★ 资质等级（2.1）　　★ 类似业绩（2.2）　　★ 项目经理资格（2.3）')
body('★ 工期（3.1）　　　　★ 质量标准（3.2）　　★ 最高限价（4.1）')
body('★ 投标文件完整性（第六章）')

c.save()
print(f'Generated {OUT}')
