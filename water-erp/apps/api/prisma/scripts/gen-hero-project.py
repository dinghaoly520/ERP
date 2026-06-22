#!/usr/bin/env python3
"""
Generate hero project seed data and append to existing JSON files.

Usage: python3 prisma/scripts/gen-hero-project.py
Run from: water-erp/apps/api/
"""
import json, os, sys
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'seed-data')

# ─── Reference IDs (all from existing seed data) ───
SUPPLIERS = [
    {"id": "cmqc8r69z0118koeklajoa05a", "name": "四川水发建设有限公司", "userId": "cmqc8r69y0116koekhly4zbd4"},
    {"id": "cmqc8r60300dpkoek0vhts0uy", "name": "中科院成都信息技术股份有限公司", "userId": "cmqc8r60200dnkoeksr6tg079"},
    {"id": "cmqc8r60600dwkoekmgndcoiv", "name": "四川省通信产业服务有限公司", "userId": "cmqc8r60500dukoekcso0n2e9"},
]

EXPERTS = [
    {"id": "cmqhero-be01", "userId": "c1bf8a97b47aed2477b465b", "name": "周祥志", "major": "工程设计", "progress": 100},
    {"id": "cmqhero-be02", "userId": "c60c2ae52a1f898f1341b2d", "name": "黃凯",   "major": "造价",     "progress": 100},
    {"id": "cmqhero-be03", "userId": "c9d82b114b7a2d6712e8923", "name": "陈英",   "major": "设备",     "progress": 60},
    {"id": "cmqhero-be04", "userId": "c690d74d6d535b32d80f736", "name": "范鸿烨", "major": "财资",     "progress": 40},
    {"id": "cmqhero-be05", "userId": "cb8f6677487b1eac17f047d", "name": "覃克非", "major": "综合-水工", "progress": 0},
]

PROJECT_ID = "cmqhero-bid-proj01"
CAIGOU_ID = "cmqbysdbl0002koh10l78cjr3"

# ─── Helper ───
def load(name):
    path = os.path.join(DATA_DIR, f"{name}.json")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save(name, data):
    path = os.path.join(DATA_DIR, f"{name}.json")
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  ✓ {name}.json — {len(data)} records")

def append(name, records):
    existing = load(name)
    existing.extend(records)
    save(name, existing)
    return len(existing)

# ─────────────────────────────────────────────
# LEVEL 0 — No FK dependencies
# ─────────────────────────────────────────────

print("\n═══ Level 0 ═══")

# 1. BidProject
bid_projects = [{
    "id": PROJECT_ID,
    "projectCode": "BID-2026-HERO1",
    "name": "2026年度智慧水利大数据平台建设项目",
    "procurementMethod": "公开招标",
    "openTime": "2026-07-01T02:00:00.000Z",
    "deadline": "2026-06-30T01:00:00.000Z",
    "stage": "EVALUATING",
    "riskNote": "种子数据-英雄项目（全流程演示）",
    "budget": "12000000",
    "scope": "智慧水利大数据平台建设，含数据中台（500TB）、AI调度引擎、数字孪生可视化大屏、统一身份认证平台、移动端APP及12套业务系统对接集成",
    "qualification": (
        "1.独立法人资格\n"
        "2.电子与智能化工程专业承包一级\n"
        "3.近三年水利信息化项目业绩不少于3个（合同额≥500万元）\n"
        "4.项目经理须具备信息系统项目管理师（高级）证书\n"
        "5.具备CMMI3级及以上认证"
    ),
    "contact": "联系人：信息技术部 陈工\n电话：028-88888101\n邮箱：chengong@scsdjt.com",
    "encryptionKeyId": None,
    "createdAt": "2026-06-10T00:00:00.000Z",
    "updatedAt": "2026-06-20T08:00:00.000Z",
}]
n = append("BidProject", bid_projects)
print(f"    → {n} total BidProjects")

# 2. Announcement
announcements = [{
    "id": "cmqhero-announce01",
    "title": "2026年度智慧水利大数据平台建设项目招标公告",
    "content": (
        "一、招标条件\n"
        "本招标项目2026年度智慧水利大数据平台建设项目已由四川水发集团批准建设，项目业主为四川水发集团，"
        "建设资金来自企业自筹，招标人为四川水发集团。项目已具备招标条件，现对该项目进行公开招标。\n\n"
        "二、项目概况与招标范围\n"
        "2.1 项目名称：2026年度智慧水利大数据平台建设项目\n"
        "2.2 建设地点：四川省成都市\n"
        "2.3 建设规模：数据中台500TB、AI调度引擎、数字孪生可视化大屏、统一身份认证平台、移动端APP及12套业务系统对接集成\n"
        "2.4 预算金额：1200万元\n"
        "2.5 计划工期：365日历天\n"
        "2.6 招标范围：本项目所涉及的软件开发、硬件采购、系统集成、安装调试、技术培训、售后保障等全部工作\n\n"
        "三、投标人资格要求\n"
        "3.1 独立法人资格\n"
        "3.2 电子与智能化工程专业承包一级资质\n"
        "3.3 近三年水利信息化项目业绩不少于3个（合同额≥500万元）\n"
        "3.4 项目经理须具备信息系统项目管理师（高级）证书\n"
        "3.5 具备CMMI3级及以上认证\n"
        "3.6 本项目不接受联合体投标\n\n"
        "四、招标文件的获取\n"
        "凡有意参加投标者，请于2026年6月10日至2026年6月30日，登录蜀水云采平台下载招标文件。\n\n"
        "五、投标文件的递交\n"
        "投标文件递交的截止时间为2026年6月30日09:00，投标人应在截止时间前通过平台上传加密投标文件。\n\n"
        "六、发布公告的媒介\n本次招标公告在蜀水云采平台发布。\n\n"
        "七、联系方式\n招标人：四川水发集团\n联系人：信息技术部 陈工\n电话：028-88888101"
    ),
    "aiSummary": "四川水发集团启动智慧水利大数据平台建设（预算1200万元），采购数据中台（500TB）、AI调度引擎、数字孪生大屏等核心模块，采用公开招标方式。要求投标人具备电子与智能化工程专业承包一级资质、CMMI3级及以上认证，近三年有类似水利信息化项目业绩且合同额不低于500万元。投标截止6月30日。",
    "type": "BID_NOTICE",
    "status": "PUBLISHED",
    "summary": "四川水发集团2026年度智慧水利大数据平台建设项目公开招标公告",
    "publishDate": "2026-06-10T00:00:00.000Z",
    "isTop": False,
    "viewCount": 1523,
    "relatedProjectCode": "BID-2026-HERO1",
    "authorId": CAIGOU_ID,
    "metadata": {"budget": "12000000", "scope": "智慧水利大数据平台建设", "method": "公开招标"},
    "createdAt": "2026-06-10T00:00:00.000Z",
    "updatedAt": "2026-06-10T00:00:00.000Z",
}]
n = append("Announcement", announcements)
print(f"    → {n} total Announcements")

# 3. ProcurementProject
proc_projects = [{
    "id": "cmqhero-proc-proj01",
    "title": "2026年度智慧水利大数据平台建设项目",
    "projectCode": "PROC-2026-0001",
    "description": "智慧水利大数据平台建设采购项目，含数据中台、AI调度引擎、数字孪生大屏及12套业务系统对接集成",
    "budget": "12000000",
    "procurementType": "工程",
    "procurementMethod": "公开招标",
    "status": "BIDDING",
    "rejectReason": None,
    "departmentId": "seeddept001",
    "creatorId": CAIGOU_ID,
    "bidProjectId": PROJECT_ID,
    "createdAt": "2026-06-09T00:00:00.000Z",
    "updatedAt": "2026-06-20T08:00:00.000Z",
}]
n = append("ProcurementProject", proc_projects)
print(f"    → {n} total ProcurementProjects")

# 4. FileAsset — 1 bid document + 9 submission files (3 tech + 3 biz + 3 cv)
file_assets = [
    # Bid document file
    {
        "id": "cmqhero-file-bd01",
        "key": "seed/hero/bid-doc-2026-hero1.pdf",
        "originalName": "2026年度智慧水利大数据平台建设项目招标文件.pdf",
        "mimeType": "application/pdf",
        "size": 4096000,
        "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        "category": "bid_document",
        "uploaderId": CAIGOU_ID,
        "encrypted": False,
        "encryptionKeyId": None,
        "iv": None,
        "authTag": None,
        "sealedPath": None,
        "createdAt": "2026-06-10T00:00:00.000Z",
        "updatedAt": "2026-06-10T00:00:00.000Z",
    },
]
# Supplier 1 submission files
for i, suffix in enumerate(["tech01", "biz01", "cv01"], 1):
    file_assets.append({
        "id": f"cmqhero-file-{suffix}",
        "key": f"seed/hero/submission-s1-{suffix}.enc",
        "originalName": {0: "技术标书", 1: "商务标书", 2: "投标函"}[i-1] + "-四川水发建设.pdf",
        "mimeType": "application/pdf",
        "size": 5242880,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8" + str(i).zfill(2),
        "category": "bid_document",
        "uploaderId": SUPPLIERS[0]["userId"],
        "encrypted": True,
        "encryptionKeyId": None,
        "iv": None,
        "authTag": None,
        "sealedPath": f"seed/hero/submission-s1-{suffix}-sealed.bin",
        "createdAt": "2026-06-28T06:00:00.000Z",
        "updatedAt": "2026-06-28T06:00:00.000Z",
    })
# Supplier 2 submission files
for i, suffix in enumerate(["tech02", "biz02", "cv02"], 1):
    file_assets.append({
        "id": f"cmqhero-file-{suffix}",
        "key": f"seed/hero/submission-s2-{suffix}.enc",
        "originalName": {0: "技术标书", 1: "商务标书", 2: "投标函"}[i-1] + "-中科院成都信息.pdf",
        "mimeType": "application/pdf",
        "size": 6291456,
        "sha256": "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2" + str(i).zfill(2),
        "category": "bid_document",
        "uploaderId": SUPPLIERS[1]["userId"],
        "encrypted": True,
        "encryptionKeyId": None,
        "iv": None,
        "authTag": None,
        "sealedPath": f"seed/hero/submission-s2-{suffix}-sealed.bin",
        "createdAt": "2026-06-29T02:00:00.000Z",
        "updatedAt": "2026-06-29T02:00:00.000Z",
    })
# Supplier 3 submission files
for i, suffix in enumerate(["tech03", "biz03", "cv03"], 1):
    file_assets.append({
        "id": f"cmqhero-file-{suffix}",
        "key": f"seed/hero/submission-s3-{suffix}.enc",
        "originalName": {0: "技术标书", 1: "商务标书", 2: "投标函"}[i-1] + "-四川通信产业.pdf",
        "mimeType": "application/pdf",
        "size": 4718592,
        "sha256": "f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6" + str(i).zfill(2),
        "category": "bid_document",
        "uploaderId": SUPPLIERS[2]["userId"],
        "encrypted": True,
        "encryptionKeyId": None,
        "iv": None,
        "authTag": None,
        "sealedPath": f"seed/hero/submission-s3-{suffix}-sealed.bin",
        "createdAt": "2026-06-30T01:00:00.000Z",
        "updatedAt": "2026-06-30T01:00:00.000Z",
    })
n = append("FileAsset", file_assets)
print(f"    → {n} total FileAssets")

# ─────────────────────────────────────────────
# LEVEL 1 — Depend on Level 0
# ─────────────────────────────────────────────

print("\n═══ Level 1 ═══")

# 5. BidSupplier
bid_suppliers = [
    {
        "id": "cmqhero-bs01",
        "projectId": PROJECT_ID,
        "supplierId": SUPPLIERS[0]["id"],
        "supplierName": SUPPLIERS[0]["name"],
        "downloadStatus": "已下载",
        "submitStatus": "已提交",
        "encryptStatus": "密文已校验",
        "receiptNo": "TB-20260701-001",
        "decryptStatus": "SUCCESS",
        "confirmStatus": "CONFIRMED",
        "decryptError": None,
        "createdAt": "2026-06-10T08:00:00.000Z",
        "updatedAt": "2026-07-01T03:00:00.000Z",
    },
    {
        "id": "cmqhero-bs02",
        "projectId": PROJECT_ID,
        "supplierId": SUPPLIERS[1]["id"],
        "supplierName": SUPPLIERS[1]["name"],
        "downloadStatus": "已下载",
        "submitStatus": "已提交",
        "encryptStatus": "密文已校验",
        "receiptNo": "TB-20260701-002",
        "decryptStatus": "SUCCESS",
        "confirmStatus": "CONFIRMED",
        "decryptError": None,
        "createdAt": "2026-06-12T02:00:00.000Z",
        "updatedAt": "2026-07-01T03:05:00.000Z",
    },
    {
        "id": "cmqhero-bs03",
        "projectId": PROJECT_ID,
        "supplierId": SUPPLIERS[2]["id"],
        "supplierName": SUPPLIERS[2]["name"],
        "downloadStatus": "已下载",
        "submitStatus": "已提交",
        "encryptStatus": "密文已校验",
        "receiptNo": "TB-20260701-003",
        "decryptStatus": "DANGER",
        "confirmStatus": "PENDING",
        "decryptError": "解密校验失败：文件完整性校验不通过，可能存在篡改风险",
        "createdAt": "2026-06-14T06:00:00.000Z",
        "updatedAt": "2026-07-01T03:10:00.000Z",
    },
]
n = append("BidSupplier", bid_suppliers)
print(f"    → {n} total BidSuppliers")

# 6. BidExpert
bid_experts = []
for i, e in enumerate(EXPERTS, 1):
    bid_experts.append({
        "id": e["id"],
        "projectId": PROJECT_ID,
        "userId": e["userId"],
        "expertName": e["name"],
        "major": e["major"],
        "signedIn": True,
        "phoneVerified": True,
        "avoidanceConfirmed": True,
        "conflictedSupplierIds": [],
        "progress": e["progress"],
        "totalScore": 0,
        "reportConfirmed": False,
        "reportConfirmedAt": None,
        "createdAt": "2026-07-02T01:00:00.000Z",
        "updatedAt": f"2026-07-03T0{i}:00:00.000Z",
    })
n = append("BidExpert", bid_experts)
print(f"    → {n} total BidExperts")

# 7. BidScoreItem — 5 categories
score_items = [
    {"id": "cmqhero-si01", "projectId": PROJECT_ID, "category": "QUALIFICATION", "name": "资格性审查", "maxScore": "0"},
    {"id": "cmqhero-si02", "projectId": PROJECT_ID, "category": "RESPONSIVE", "name": "符合性审查", "maxScore": "0"},
    {"id": "cmqhero-si03", "projectId": PROJECT_ID, "category": "BUSINESS", "name": "商务评分", "maxScore": "20"},
    {"id": "cmqhero-si04", "projectId": PROJECT_ID, "category": "TECHNICAL", "name": "技术评分", "maxScore": "50"},
    {"id": "cmqhero-si05", "projectId": PROJECT_ID, "category": "PRICE", "name": "价格评分", "maxScore": "30"},
]
for item in score_items:
    item["createdAt"] = "2026-06-10T08:30:00.000Z"
n = append("BidScoreItem", score_items)
print(f"    → {n} total BidScoreItems")

# 8. BidOpeningSession
opening_sessions = [{
    "id": "cmqhero-os01",
    "projectId": PROJECT_ID,
    "host": "李主任",
    "supervisor": "周老师",
    "status": "已开标",
    "decryptWindowStart": "2026-07-01T02:00:00.000Z",
    "decryptWindowEnd": "2026-07-01T03:30:00.000Z",
    "remainingSeconds": 0,
    "createdAt": "2026-07-01T01:00:00.000Z",
    "updatedAt": "2026-07-01T03:30:00.000Z",
}]
n = append("BidOpeningSession", opening_sessions)
print(f"    → {n} total BidOpeningSessions")

# 9. BidArchiveItem — 7 items, all NOT_STARTED
archive_items = [
    {"id": "cmqhero-ai01", "projectId": PROJECT_ID, "name": "招标项目基础信息", "ownerRole": "系统", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai02", "projectId": PROJECT_ID, "name": "投标供应商名单", "ownerRole": "开标主持人", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai03", "projectId": PROJECT_ID, "name": "开标记录表", "ownerRole": "开标主持人", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai04", "projectId": PROJECT_ID, "name": "供应商确认/异议记录", "ownerRole": "供应商", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai05", "projectId": PROJECT_ID, "name": "专家评分明细", "ownerRole": "评审专家", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai06", "projectId": PROJECT_ID, "name": "评标结果汇总", "ownerRole": "评审委员会", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-ai07", "projectId": PROJECT_ID, "name": "监督日志", "ownerRole": "监督人", "status": "NOT_STARTED", "hashDigest": None, "archivedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z", "updatedAt": "2026-07-02T01:00:00.000Z"},
]
n = append("BidArchiveItem", archive_items)
print(f"    → {n} total BidArchiveItems")

# 10. BidDocument
bid_documents = [{
    "id": "cmqhero-bd01",
    "announcementId": "cmqhero-announce01",
    "fileAssetId": "cmqhero-file-bd01",
    "title": "2026年度智慧水利大数据平台建设项目招标文件",
    "accessScope": "OPEN",
    "requirePayment": False,
    "price": None,
    "decryptKey": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2:c3d4e5f6a7b8c9d0e1f2a3b4:a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
    "bidProjectId": PROJECT_ID,
    "downloadCount": 3,
    "createdAt": "2026-06-10T00:00:00.000Z",
    "updatedAt": "2026-06-28T08:00:00.000Z",
}]
n = append("BidDocument", bid_documents)
print(f"    → {n} total BidDocuments")

# 11. BidDocumentAccess — 3 suppliers, different download counts
doc_accesses = [
    {"id": "cmqhero-bda01", "documentId": "cmqhero-bd01", "supplierId": SUPPLIERS[0]["id"],
     "eligible": True, "paid": False, "paidAt": None, "paymentRef": None,
     "downloadCount": 2, "lastDownloadAt": "2026-06-28T06:00:00.000Z",
     "createdAt": "2026-06-10T08:00:00.000Z", "updatedAt": "2026-06-28T06:00:00.000Z"},
    {"id": "cmqhero-bda02", "documentId": "cmqhero-bd01", "supplierId": SUPPLIERS[1]["id"],
     "eligible": True, "paid": False, "paidAt": None, "paymentRef": None,
     "downloadCount": 1, "lastDownloadAt": "2026-06-12T02:00:00.000Z",
     "createdAt": "2026-06-12T02:00:00.000Z", "updatedAt": "2026-06-12T02:00:00.000Z"},
    {"id": "cmqhero-bda03", "documentId": "cmqhero-bd01", "supplierId": SUPPLIERS[2]["id"],
     "eligible": True, "paid": False, "paidAt": None, "paymentRef": None,
     "downloadCount": 3, "lastDownloadAt": "2026-06-29T10:00:00.000Z",
     "createdAt": "2026-06-14T06:00:00.000Z", "updatedAt": "2026-06-29T10:00:00.000Z"},
]
n = append("BidDocumentAccess", doc_accesses)
print(f"    → {n} total BidDocumentAccesses")

# 12. Notification — milestone notifications
notifications = [
    # To each supplier: invited to bid
    {"id": "cmqhero-notif01", "userId": SUPPLIERS[0]["userId"], "type": "BID_PUBLISHED",
     "title": "新招标项目邀请", "content": f"您已被邀请参与「{bid_projects[0]['name']}」的投标，请登录查看详情并下载招标文件。",
     "isRead": False, "resolvedAt": None, "link": f"/bid/{PROJECT_ID}",
     "createdAt": "2026-06-10T00:00:00.000Z"},
    {"id": "cmqhero-notif02", "userId": SUPPLIERS[1]["userId"], "type": "BID_PUBLISHED",
     "title": "新招标项目邀请", "content": f"您已被邀请参与「{bid_projects[0]['name']}」的投标，请登录查看详情并下载招标文件。",
     "isRead": True, "resolvedAt": None, "link": f"/bid/{PROJECT_ID}",
     "createdAt": "2026-06-10T00:00:00.000Z"},
    {"id": "cmqhero-notif03", "userId": SUPPLIERS[2]["userId"], "type": "BID_PUBLISHED",
     "title": "新招标项目邀请", "content": f"您已被邀请参与「{bid_projects[0]['name']}」的投标，请登录查看详情并下载招标文件。",
     "isRead": True, "resolvedAt": None, "link": f"/bid/{PROJECT_ID}",
     "createdAt": "2026-06-10T00:00:00.000Z"},
    # Submission confirmations for each supplier
    {"id": "cmqhero-notif04", "userId": SUPPLIERS[0]["userId"], "type": "BID_PUBLISHED",
     "title": "标书提交成功", "content": f"您对「{bid_projects[0]['name']}」的投标文件已成功提交，回执编号：TB-20260701-001。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-06-28T06:00:00.000Z"},
    {"id": "cmqhero-notif05", "userId": SUPPLIERS[1]["userId"], "type": "BID_PUBLISHED",
     "title": "标书提交成功", "content": f"您对「{bid_projects[0]['name']}」的投标文件已成功提交，回执编号：TB-20260701-002。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-06-29T02:00:00.000Z"},
    {"id": "cmqhero-notif06", "userId": SUPPLIERS[2]["userId"], "type": "BID_PUBLISHED",
     "title": "标书提交成功", "content": f"您对「{bid_projects[0]['name']}」的投标文件已成功提交，回执编号：TB-20260701-003。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-06-30T01:00:00.000Z"},
    # Decrypt results
    {"id": "cmqhero-notif07", "userId": SUPPLIERS[0]["userId"], "type": "BID_PUBLISHED",
     "title": "开标解密成功", "content": f"您在「{bid_projects[0]['name']}」中的投标文件解密成功，报价1080万元已确认。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-07-01T03:00:00.000Z"},
    {"id": "cmqhero-notif08", "userId": SUPPLIERS[2]["userId"], "type": "BID_PUBLISHED",
     "title": "开标解密异常", "content": f"您在「{bid_projects[0]['name']}」中的投标文件解密失败，请登录查看详情并提交异议。",
     "isRead": False, "resolvedAt": None,
     "createdAt": "2026-07-01T03:10:00.000Z"},
    # Expert notifications
    {"id": "cmqhero-notif09", "userId": EXPERTS[0]["userId"], "type": "SYSTEM",
     "title": "评标任务通知", "content": f"您被抽取为「{bid_projects[0]['name']}」的评审专家，请登录专家门户完成签到和评分。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z"},
    {"id": "cmqhero-notif10", "userId": EXPERTS[1]["userId"], "type": "SYSTEM",
     "title": "评标任务通知", "content": f"您被抽取为「{bid_projects[0]['name']}」的评审专家，请登录专家门户完成签到和评分。",
     "isRead": True, "resolvedAt": None,
     "createdAt": "2026-07-02T01:00:00.000Z"},
]
n = append("Notification", notifications)
print(f"    → {n} total Notifications")

# ─────────────────────────────────────────────
# LEVEL 2 — Depend on Level 1
# ─────────────────────────────────────────────

print("\n═══ Level 2 ═══")

# 13. SupplierBidSubmission
submissions = [
    {"id": "cmqhero-sbs01", "supplierId": SUPPLIERS[0]["id"], "projectId": PROJECT_ID,
     "bidPrice": "10800000", "deliveryPeriod": "365天",
     "technicalFile": None, "businessFile": None, "coverLetter": None,
     "technicalFileAssetId": "cmqhero-file-tech01", "businessFileAssetId": "cmqhero-file-biz01", "coverLetterAssetId": "cmqhero-file-cv01",
     "technicalSealedKey": None, "businessSealedKey": None, "coverLetterSealedKey": None,
     "fileHash": None, "signature": None, "signedAt": None,
     "status": "submitted", "submittedAt": "2026-06-28T06:00:00.000Z",
     "createdAt": "2026-06-28T06:00:00.000Z", "updatedAt": "2026-06-28T06:00:00.000Z"},
    {"id": "cmqhero-sbs02", "supplierId": SUPPLIERS[1]["id"], "projectId": PROJECT_ID,
     "bidPrice": "11500000", "deliveryPeriod": "330天",
     "technicalFile": None, "businessFile": None, "coverLetter": None,
     "technicalFileAssetId": "cmqhero-file-tech02", "businessFileAssetId": "cmqhero-file-biz02", "coverLetterAssetId": "cmqhero-file-cv02",
     "technicalSealedKey": None, "businessSealedKey": None, "coverLetterSealedKey": None,
     "fileHash": None, "signature": None, "signedAt": None,
     "status": "submitted", "submittedAt": "2026-06-29T02:00:00.000Z",
     "createdAt": "2026-06-29T02:00:00.000Z", "updatedAt": "2026-06-29T02:00:00.000Z"},
    {"id": "cmqhero-sbs03", "supplierId": SUPPLIERS[2]["id"], "projectId": PROJECT_ID,
     "bidPrice": "11980000", "deliveryPeriod": "300天",
     "technicalFile": None, "businessFile": None, "coverLetter": None,
     "technicalFileAssetId": "cmqhero-file-tech03", "businessFileAssetId": "cmqhero-file-biz03", "coverLetterAssetId": "cmqhero-file-cv03",
     "technicalSealedKey": None, "businessSealedKey": None, "coverLetterSealedKey": None,
     "fileHash": None, "signature": None, "signedAt": None,
     "status": "submitted", "submittedAt": "2026-06-30T01:00:00.000Z",
     "createdAt": "2026-06-30T01:00:00.000Z", "updatedAt": "2026-06-30T01:00:00.000Z"},
]
n = append("SupplierBidSubmission", submissions)
print(f"    → {n} total SupplierBidSubmissions")

# 14. BidOpeningRecord — mixed results
opening_records = [
    {"id": "cmqhero-or01", "projectId": PROJECT_ID, "supplierName": SUPPLIERS[0]["name"],
     "amount": "1080万元", "period": "365天", "qualityTarget": "合格", "bondStatus": "已缴纳",
     "decryptResult": "解密成功", "confirmStatus": "供应商已确认",
     "bidSupplierId": "cmqhero-bs01",
     "objectionReason": None, "confirmedAt": "2026-07-01T03:00:00.000Z",
     "handledAt": None, "handledBy": None, "handleResult": None,
     "createdAt": "2026-07-01T03:00:00.000Z"},
    {"id": "cmqhero-or02", "projectId": PROJECT_ID, "supplierName": SUPPLIERS[1]["name"],
     "amount": "1150万元", "period": "330天", "qualityTarget": "优良", "bondStatus": "已缴纳",
     "decryptResult": "解密成功", "confirmStatus": "供应商已确认",
     "bidSupplierId": "cmqhero-bs02",
     "objectionReason": None, "confirmedAt": "2026-07-01T03:05:00.000Z",
     "handledAt": None, "handledBy": None, "handleResult": None,
     "createdAt": "2026-07-01T03:05:00.000Z"},
    {"id": "cmqhero-or03", "projectId": PROJECT_ID, "supplierName": SUPPLIERS[2]["name"],
     "amount": "1198万元", "period": "300天", "qualityTarget": "合格", "bondStatus": "待确认",
     "decryptResult": "解密失败", "confirmStatus": "待供应商确认",
     "bidSupplierId": "cmqhero-bs03",
     "objectionReason": "解密校验不通过，文件完整性异常，供应商提出异议：加密过程符合规范，请求重新解密核验",
     "confirmedAt": None, "handledAt": None, "handledBy": None, "handleResult": None,
     "createdAt": "2026-07-01T03:10:00.000Z"},
]
n = append("BidOpeningRecord", opening_records)
print(f"    → {n} total BidOpeningRecords")

# 15. BidScoreRecord — ~24 records
# Scoring per expert per supplier per category (BUSINESS/TECHNICAL/PRICE only)
score_item_map = {
    "BUSINESS": "cmqhero-si03",
    "TECHNICAL": "cmqhero-si04",
    "PRICE": "cmqhero-si05",
}
bs_ids_map = {
    "s1": "cmqhero-bs01",  # 四川水发建设
    "s2": "cmqhero-bs02",  # 中科院成都信息
    "s3": "cmqhero-bs03",  # 四川通信产业
}

# Scoring data: expert_id -> { supplier_key -> { BUSINESS, TECHNICAL, PRICE } }
scoring = {
    "cmqhero-be01": {  # 周祥志 — 100% done
        "s1": {"BUSINESS": "82", "TECHNICAL": "88", "PRICE": "85"},
        "s2": {"BUSINESS": "90", "TECHNICAL": "92", "PRICE": "78"},
        "s3": {"BUSINESS": "85", "TECHNICAL": "80", "PRICE": "90"},
    },
    "cmqhero-be02": {  # 黃凯 — 100% done
        "s1": {"BUSINESS": "85", "TECHNICAL": "85", "PRICE": "82"},
        "s2": {"BUSINESS": "88", "TECHNICAL": "90", "PRICE": "80"},
        "s3": {"BUSINESS": "82", "TECHNICAL": "78", "PRICE": "88"},
    },
    "cmqhero-be03": {  # 陈英 — partial (s1, s2 only)
        "s1": {"BUSINESS": "80", "TECHNICAL": "86", "PRICE": "88"},
        "s2": {"BUSINESS": "92", "TECHNICAL": "88", "PRICE": "75"},
    },
}

score_records = []
sr_idx = 1
for expert_id, supplier_scores in scoring.items():
    for skey, scores in supplier_scores.items():
        for cat, score_val in scores.items():
            score_records.append({
                "id": f"cmqhero-sr{sr_idx:02d}",
                "expertId": expert_id,
                "scoreItemId": score_item_map[cat],
                "supplierId": bs_ids_map[skey],
                "score": score_val,
                "reason": None,
                "createdAt": "2026-07-03T06:00:00.000Z",
            })
            sr_idx += 1

n = append("BidScoreRecord", score_records)
print(f"    → {n} total BidScoreRecords")

# 16. BidSupervisionLog — full lifecycle timeline
supervision_logs = [
    {"id": "cmqhero-sl01", "projectId": PROJECT_ID,
     "time": "2026-06-10T00:00:00.000Z", "role": "系统", "target": bid_projects[0]['name'],
     "action": "公告发布，自动创建招标项目", "result": "阶段初始化为DOWNLOAD", "riskFlag": "无",
     "createdAt": "2026-06-10T00:00:00.000Z"},
    {"id": "cmqhero-sl02", "projectId": PROJECT_ID,
     "time": "2026-06-10T08:00:00.000Z", "role": "系统", "target": bid_projects[0]['name'],
     "action": "开放投递 (DOWNLOAD→SUBMIT)", "result": "阶段变更成功", "riskFlag": "无",
     "createdAt": "2026-06-10T08:00:00.000Z"},
    {"id": "cmqhero-sl03", "projectId": PROJECT_ID,
     "time": "2026-06-10T08:00:00.000Z", "role": "系统", "target": bid_projects[0]['name'],
     "action": "邀请3家供应商参与投标", "result": f"已邀请：{SUPPLIERS[0]['name']}、{SUPPLIERS[1]['name']}、{SUPPLIERS[2]['name']}", "riskFlag": "无",
     "createdAt": "2026-06-10T08:00:00.000Z"},
    {"id": "cmqhero-sl04", "projectId": PROJECT_ID,
     "time": "2026-06-28T06:00:00.000Z", "role": "供应商", "target": SUPPLIERS[0]['name'],
     "action": "提交标书", "result": "报价1080万元 / 工期365天", "riskFlag": "无",
     "createdAt": "2026-06-28T06:00:00.000Z"},
    {"id": "cmqhero-sl05", "projectId": PROJECT_ID,
     "time": "2026-06-29T02:00:00.000Z", "role": "供应商", "target": SUPPLIERS[1]['name'],
     "action": "提交标书", "result": "报价1150万元 / 工期330天", "riskFlag": "无",
     "createdAt": "2026-06-29T02:00:00.000Z"},
    {"id": "cmqhero-sl06", "projectId": PROJECT_ID,
     "time": "2026-06-30T01:00:00.000Z", "role": "供应商", "target": SUPPLIERS[2]['name'],
     "action": "提交标书", "result": "报价1198万元 / 工期300天", "riskFlag": "无",
     "createdAt": "2026-06-30T01:00:00.000Z"},
    {"id": "cmqhero-sl07", "projectId": PROJECT_ID,
     "time": "2026-07-01T01:00:00.000Z", "role": "李主任", "target": bid_projects[0]['name'],
     "action": "启动开标 (SUBMIT→OPENING)", "result": "阶段变更成功，解密窗口：7月1日10:00-11:30", "riskFlag": "无",
     "createdAt": "2026-07-01T01:00:00.000Z"},
    {"id": "cmqhero-sl08", "projectId": PROJECT_ID,
     "time": "2026-07-01T02:30:00.000Z", "role": "系统", "target": SUPPLIERS[0]['name'],
     "action": "标书解密", "result": "解密成功，等待供应商确认唱标信息", "riskFlag": "无",
     "createdAt": "2026-07-01T02:30:00.000Z"},
    {"id": "cmqhero-sl09", "projectId": PROJECT_ID,
     "time": "2026-07-01T02:35:00.000Z", "role": "系统", "target": SUPPLIERS[1]['name'],
     "action": "标书解密", "result": "解密成功，等待供应商确认唱标信息", "riskFlag": "无",
     "createdAt": "2026-07-01T02:35:00.000Z"},
    {"id": "cmqhero-sl10", "projectId": PROJECT_ID,
     "time": "2026-07-01T02:40:00.000Z", "role": "系统", "target": SUPPLIERS[2]['name'],
     "action": "标书解密", "result": "解密异常：文件完整性校验不通过，可能存在篡改风险", "riskFlag": "高风险",
     "createdAt": "2026-07-01T02:40:00.000Z"},
    {"id": "cmqhero-sl11", "projectId": PROJECT_ID,
     "time": "2026-07-01T03:20:00.000Z", "role": "系统", "target": bid_projects[0]['name'],
     "action": "启动评标 (OPENING→EVALUATING)", "result": "阶段变更成功，进入专家评审阶段", "riskFlag": "无",
     "createdAt": "2026-07-01T03:20:00.000Z"},
    {"id": "cmqhero-sl12", "projectId": PROJECT_ID,
     "time": "2026-07-02T01:00:00.000Z", "role": "系统", "target": bid_projects[0]['name'],
     "action": "专家抽取完成", "result": f"成功抽取5位专家：{', '.join(e['name'] for e in EXPERTS)}，均确认参与评标", "riskFlag": "无",
     "createdAt": "2026-07-02T01:00:00.000Z"},
]
n = append("BidSupervisionLog", supervision_logs)
print(f"    → {n} total BidSupervisionLogs")

# 17. BidClarification — 2 Q&A records
clarifications = [
    {"id": "cmqhero-cl01", "projectId": PROJECT_ID,
     "type": "澄清", "question": "请澄清贵司标书解密失败的具体技术原因，并说明是否愿意配合重新提交加密标书进行二次解密核验。",
     "issuer": "评审委员会", "supplierName": SUPPLIERS[2]['name'], "supplierId": None,
     "status": "待回复", "reply": None,
     "createdAt": "2026-07-02T03:00:00.000Z", "updatedAt": "2026-07-02T03:00:00.000Z"},
    {"id": "cmqhero-cl02", "projectId": PROJECT_ID,
     "type": "答疑", "question": "AI调度引擎的算法框架是否允许采用国产化替代方案（如华为昇思MindSpore替代TensorFlow）？若允许，需满足哪些兼容性要求？",
     "issuer": SUPPLIERS[1]['name'], "supplierName": SUPPLIERS[1]['name'], "supplierId": None,
     "status": "已回复",
     "reply": "本平台鼓励国产化替代方案，允许采用华为昇思MindSpore等国产AI框架。需满足以下要求：(1)提供完整API兼容性测试报告；(2)支持与现有TensorFlow Serving推理服务协议互通；(3)提供迁移技术方案和性能对比数据；(4)提供至少1个类似规模的国产框架生产案例。",
     "createdAt": "2026-07-02T06:00:00.000Z", "updatedAt": "2026-07-02T08:00:00.000Z"},
]
n = append("BidClarification", clarifications)
print(f"    → {n} total BidClarifications")

# 18. BidEvaluationResult — preliminary results from 2 full-scored experts
# Average across 周祥志 + 黃凯 for each supplier
# s1: (255+252)/2 = 253.5 → averageScore = 253.5/3 = 84.5
# s2: (260+258)/2 = 259 → averageScore = 259/3 = 86.33
eval_results = [
    {"id": "cmqhero-er01", "projectId": PROJECT_ID,
     "supplierId": "cmqhero-bs02", "supplierName": SUPPLIERS[1]['name'],
     "totalScore": "259", "averageScore": "86.33", "rank": 1, "recommended": True,
     "generatedAt": "2026-07-03T08:00:00.000Z"},
    {"id": "cmqhero-er02", "projectId": PROJECT_ID,
     "supplierId": "cmqhero-bs01", "supplierName": SUPPLIERS[0]['name'],
     "totalScore": "253.5", "averageScore": "84.5", "rank": 2, "recommended": False,
     "generatedAt": "2026-07-03T08:00:00.000Z"},
]
n = append("BidEvaluationResult", eval_results)
print(f"    → {n} total BidEvaluationResults")

# ─── Summary ───
print("\n" + "="*60)
print("  🎉 Hero project seed data generation complete!")
print("="*60)
print(f"\n  Run: cd water-erp && pnpm db:seed")
print(f"  Then: pnpm dev  (to start all portals)")
