#!/usr/bin/env python3
"""
为英雄项目 3 家供应商补充丰富的档案内容：
  - 参与其他进行中项目（BidSupplier + SupplierBidSubmission）
  - 历史业绩评价（SupplierEvaluation）
  - 资质证书（SupplierQualification）
  - 联系人（SupplierContact）
  - 投标邀请通知（Notification）
"""
import json, os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'seed-data')

def load(name):
    with open(os.path.join(DATA_DIR, f"{name}.json"), 'r', encoding='utf-8') as f:
        return json.load(f)

def save(name, data):
    with open(os.path.join(DATA_DIR, f"{name}.json"), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def append(name, records):
    existing = load(name)
    existing.extend(records)
    save(name, existing)
    print(f"  ✓ {name}.json +{len(records)} → {len(existing)} total")

# ─── 3 家供应商 ───
SUPPLIERS = [
    {
        "id": "cmqc8r69z0118koeklajoa05a", "name": "四川水发建设有限公司",
        "userId": "cmqc8r69y0116koekhly4zbd4", "short": "sfjs",
        "domain": "工程施工",
    },
    {
        "id": "cmqc8r60300dpkoek0vhts0uy", "name": "中科院成都信息技术股份有限公司",
        "userId": "cmqc8r60200dnkoeksr6tg079", "short": "zk",
        "domain": "信息技术",
    },
    {
        "id": "cmqc8r60600dwkoekmgndcoiv", "name": "四川省通信产业服务有限公司",
        "userId": "cmqc8r60500dukoekcso0n2e9", "short": "tx",
        "domain": "通信服务",
    },
]

CAIGOU_ID = "cmqbysdbl0002koh10l78cjr3"

# ─── 项目分配：每家 2 DOWNLOAD + 1 SUBMIT ───
# (projectId, projectCode, projectName, stage, budget)
PROJECT_ASSIGN = {
    "sfjs": [
        ("cm19ed36b6605zqe2cv2en1ty", "BID-2026-0706", "渠道清淤及生态修复工程施工", "DOWNLOAD", 3000000),
        ("cm19ed36b660c2yk1fkg51y9t", "BID-2026-0620", "水库大坝安全监测自动化改造项目", "DOWNLOAD", 3000000),
        ("cm19ed36b660404nfsdqsohyg", "BID-2026-0605", "都江堰灌区现代化改造工程设备采购", "SUBMIT", 3000000),
    ],
    "zk": [
        ("cm19ed36b660dp2cj9l2pih3g", "BID-2026-0712", "水利工程档案数字化加工服务", "DOWNLOAD", 3000000),
        ("cm19ed36b66080mcpcdgjop7a", "BID-2026-0610", "岷江流域水质在线监测站建设项目", "DOWNLOAD", 3000000),
        ("cm19ed36b6601vl16837waroy", "BID-2026-0522", "智慧水务信息化系统建设项目", "SUBMIT", 3000000),
    ],
    "tx": [
        ("cm19ed36b66035ulrxdim5v4j", "BID-2026-0625", "泵站节能改造及电气设备采购", "DOWNLOAD", 3000000),
        ("cm19ed36b660bzl0nzdxxq80r", "BID-2026-0718", "重点水源工程生态流量监测设备采购", "DOWNLOAD", 3000000),
        ("cm19ed36b66096dv9uvd0jp54", "BID-2026-0601", "2026年度防汛抗旱物资储备采购", "SUBMIT", 3000000),
    ],
}

# 历史项目（用于 SupplierEvaluation 关联）
HISTORY_PROJECTS = [
    "cmqgebt6q0005vkr4ea3mdorm",  # BID-1781599475329 ARCHIVED
    "cmqhf0kjq0000vk182j1xsjbg",  # BID-2026-0618 EVALUATING
    None,  # 综合评价（无具体项目）
    None,
]

print("═══ 为 3 家供应商丰富档案内容 ═══\n")

# ─── 1. BidSupplier + SupplierBidSubmission + Notification ───
print("▸ 投标记录 / 标书 / 通知")
bid_suppliers = []
submissions = []
notifications = []
notif_idx = 1
bs_idx = 1
sbs_idx = 1

for s in SUPPLIERS:
    for i, (pid, pcode, pname, stage, budget) in enumerate(PROJECT_ASSIGN[s["short"]]):
        is_submit = (stage == "SUBMIT")
        # DOWNLOAD: 已下载待提交；SUBMIT: 已下载已提交
        download_st = "已下载"
        submit_st = "已提交" if is_submit else "待提交"
        encrypt_st = "密文已校验" if is_submit else "待校验"

        bs_id = f"cmqrich-bs-{s['short']}{i+1}"
        bid_suppliers.append({
            "id": bs_id,
            "projectId": pid,
            "supplierId": s["id"],
            "supplierName": s["name"],
            "downloadStatus": download_st,
            "submitStatus": submit_st,
            "encryptStatus": encrypt_st,
            "receiptNo": f"TB-2026062{bs_idx}-0{bs_idx}" if is_submit else None,
            "decryptStatus": "PENDING",
            "confirmStatus": "PENDING",
            "decryptError": None,
            "createdAt": "2026-06-15T08:00:00.000Z",
            "updatedAt": "2026-06-2" + str(bs_idx % 9) + "T06:00:00.000Z",
        })
        bs_idx += 1

        # SUBMIT 阶段才有标书
        if is_submit:
            # 报价在预算 90%-98% 区间
            price = int(budget * (0.90 + 0.02 * i))
            submissions.append({
                "id": f"cmqrich-sbs-{s['short']}{sbs_idx}",
                "supplierId": s["id"],
                "projectId": pid,
                "bidPrice": str(price),
                "deliveryPeriod": ["120天","150天","180天"][i % 3],
                "technicalFile": None, "businessFile": None, "coverLetter": None,
                "technicalFileAssetId": None, "businessFileAssetId": None, "coverLetterAssetId": None,
                "technicalSealedKey": None, "businessSealedKey": None, "coverLetterSealedKey": None,
                "fileHash": None, "signature": None, "signedAt": None,
                "status": "submitted",
                "submittedAt": f"2026-06-2{sbs_idx}T06:00:00.000Z",
                "createdAt": f"2026-06-2{sbs_idx}T06:00:00.000Z",
                "updatedAt": f"2026-06-2{sbs_idx}T06:00:00.000Z",
            })
            sbs_idx += 1

        # 通知
        notifications.append({
            "id": f"cmqrich-notif-{s['short']}-{i+1}",
            "userId": s["userId"],
            "type": "BID_PUBLISHED",
            "title": "新招标项目邀请",
            "content": f"您已被邀请参与「{pname}」（{pcode}）的投标，请登录查看招标文件并按时提交标书。",
            "isRead": is_submit,
            "resolvedAt": None,
            "link": f"/bidding/{pid}",
            "createdAt": "2026-06-15T08:00:00.000Z",
        })
        notif_idx += 1

append("BidSupplier", bid_suppliers)
append("SupplierBidSubmission", submissions)
append("Notification", notifications)

# ─── 2. SupplierEvaluation（历史业绩评价）───
print("\n▸ 历史业绩评价")
evaluations = []
EVAL_TEMPLATES = [
    {"score": "96", "level": "A", "comp": "19", "resp": "19.5", "coop": "19", "compl": "19", "overall": "19", "comment": "技术方案优秀，项目实施规范，按期交付，履约能力强，配合度高。"},
    {"score": "92", "level": "A", "comp": "18.5", "resp": "18.5", "coop": "19", "compl": "18.5", "overall": "18.5", "comment": "整体履约良好，响应及时，质量达标，建议继续保持。"},
    {"score": "88", "level": "B", "comp": "18", "resp": "17.5", "coop": "18", "compl": "18", "overall": "17.5", "comment": "履约情况良好，部分节点略有延期但已整改，总体合格。"},
    {"score": "94", "level": "A", "comp": "19", "resp": "19", "coop": "18.5", "compl": "19", "overall": "18.5", "comment": "专业能力强，交付质量高，沟通顺畅，是优质合作伙伴。"},
]
ev_idx = 1
for s in SUPPLIERS:
    for i in range(4):
        tpl = EVAL_TEMPLATES[i]
        evaluations.append({
            "id": f"cmqrich-ev-{s['short']}{ev_idx:02d}",
            "supplierId": s["id"],
            "projectId": HISTORY_PROJECTS[i],
            "evaluatorId": CAIGOU_ID,
            "score": tpl["score"],
            "level": tpl["level"],
            "completenessScore": tpl["comp"],
            "responsivenessScore": tpl["resp"],
            "cooperationScore": tpl["coop"],
            "complianceScore": tpl["compl"],
            "overallScore": tpl["overall"],
            "comment": tpl["comment"],
            "createdAt": f"2026-0{i+1}-1{i}T08:00:00.000Z",
            "updatedAt": f"2026-0{i+1}-1{i}T08:00:00.000Z",
        })
        ev_idx += 1
append("SupplierEvaluation", evaluations)

# ─── 3. SupplierQualification（资质证书）───
print("\n▸ 资质证书")
QUAL_TEMPLATES = {
    "sfjs": [  # 四川水发建设 - 工程施工类
        ("安全生产许可证", "安全生产许可证（川）JZ安许证字〔2021〕000123", "2026-01-15", "2029-01-14"),
        ("资质证书", "水利水电工程施工总承包二级", "2024-06-01", "2029-05-31"),
        ("体系认证", "ISO9001质量管理体系认证", "2025-03-01", "2028-02-29"),
        ("信用评级", "AAA级信用企业证书", "2025-08-01", "2028-07-31"),
    ],
    "zk": [  # 中科院成都信息 - IT 类
        ("资质证书", "CMMI3级软件能力成熟度认证", "2024-09-01", "2027-08-31"),
        ("体系认证", "ISO27001信息安全管理体系认证", "2025-01-01", "2027-12-31"),
        ("资质证书", "高新技术企业证书", "2024-12-01", "2027-11-30"),
        ("资质证书", "计算机信息系统集成三级资质", "2025-05-01", "2028-04-30"),
    ],
    "tx": [  # 四川省通信产业服务 - 通信/IT 类
        ("资质证书", "通信工程施工总承包三级", "2024-04-01", "2029-03-31"),
        ("体系认证", "ISO9001质量管理体系认证", "2025-06-01", "2028-05-31"),
        ("资质证书", "高新技术企业证书", "2024-11-01", "2027-10-31"),
        ("许可证书", "增值电信业务经营许可证", "2025-02-01", "2030-01-31"),
    ],
}
qualifications = []
q_idx = 1
for s in SUPPLIERS:
    for qtype, qname, vfrom, vto in QUAL_TEMPLATES[s["short"]]:
        qualifications.append({
            "id": f"cmqrich-qu-{s['short']}{q_idx:02d}",
            "supplierId": s["id"],
            "type": qtype,
            "name": qname,
            "fileUrl": f"/uploads/{s['short']}-qual-{q_idx}.pdf",
            "validFrom": f"{vfrom}T00:00:00.000Z",
            "validTo": f"{vto}T00:00:00.000Z",
            "status": "有效",
            "createdAt": "2026-06-13T06:18:29.742Z",
            "updatedAt": "2026-06-13T06:18:29.742Z",
        })
        q_idx += 1
append("SupplierQualification", qualifications)

# ─── 4. SupplierContact（联系人）───
print("\n▸ 联系人")
CONTACT_TEMPLATES = {
    "sfjs": [("王建国", "13902810001", "wangjg@sfjs.com", False), ("李慧敏", "13902810002", "lihm@sfjs.com", False)],
    "zk": [("罗良元", "13902820001", "luoly@zkcdit.com", False), ("张文博", "13902820002", "zhangwb@zkcdit.com", False)],
    "tx": [("张坤森", "13902830001", "zhangks@scct.com", False), ("陈思远", "13902830002", "chensy@scct.com", False)],
}
contacts = []
c_idx = 1
for s in SUPPLIERS:
    for cname, cphone, cemail, is_primary in CONTACT_TEMPLATES[s["short"]]:
        contacts.append({
            "id": f"cmqrich-ct-{s['short']}{c_idx:02d}",
            "supplierId": s["id"],
            "name": cname,
            "phone": cphone,
            "email": cemail,
            "isPrimary": is_primary,
            "createdAt": "2026-06-13T06:18:29.742Z",
            "updatedAt": "2026-06-13T06:18:29.742Z",
        })
        c_idx += 1
append("SupplierContact", contacts)

print("\n═══ 完成 ═══")
print(f"  共新增 {len(bid_suppliers)+len(submissions)+len(notifications)+len(evaluations)+len(qualifications)+len(contacts)} 条记录")
print(f"  BidSupplier +{len(bid_suppliers)} | Submissions +{len(submissions)} | Notifications +{len(notifications)}")
print(f"  Evaluations +{len(evaluations)} | Qualifications +{len(qualifications)} | Contacts +{len(contacts)}")
