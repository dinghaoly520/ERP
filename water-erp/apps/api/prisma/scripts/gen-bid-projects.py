#!/usr/bin/env python3
"""Generate BidProject seed entries from BID_NOTICE announcements."""
import json, re, os
from datetime import datetime, timedelta, timezone

SEED_DIR = os.path.dirname(os.path.abspath(__file__)) + '/../seed-data'

with open(f'{SEED_DIR}/Announcement.json') as f:
    announcements = json.load(f)

with open(f'{SEED_DIR}/BidProject.json') as f:
    existing = json.load(f)

existing_pcs = {p['projectCode'] for p in existing}
UTC = timezone.utc

bid_notices = [a for a in announcements
    if a.get('type') == 'BID_NOTICE' and a.get('relatedProjectCode')
    and a['relatedProjectCode'] not in existing_pcs]

print(f'Found {len(bid_notices)} announcements to convert to BidProjects')

def extract_budget(content):
    """Try to extract budget amount from content."""
    m = re.search(r'预算[金金额][：:]*\s*(\d+)\s*万元?', content)
    if m: return str(int(m.group(1)) * 10000)
    m = re.search(r'预算[金金额][：:]*\s*(\d[\d,]*)\s*元', content)
    if m: return m.group(1).replace(',', '')
    return '3000000'  # default 300万

def extract_procurement(content):
    if '谈判采购' in content: return '谈判采购'
    if '邀请招标' in content: return '邀请招标'
    if '询价' in content: return '询比采购'
    if '单一来源' in content: return '单一来源采购'
    return '公开招标'

def extract_deadline_days(content):
    m = re.search(r'(\d+)\s*日[历]*天', content)
    if m: return int(m.group(1))
    m = re.search(r'交付.*?周期.*?(\d+)', content)
    if m: return int(m.group(1))
    return 120  # default 4 months

def extract_scope(content):
    m = re.search(r'采购范围[包括含][：:]*\s*(.+?)(?:[。；;]|交付|投标)', content)
    if m: return m.group(1).strip()[:200]
    return None

def generate_project_id(idx):
    """Generate a cuid-like ID."""
    import random, string
    ts = int(datetime.now(UTC).timestamp() * 1000) + idx
    rand = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    return f'cm{ts:x}{rand}'

now = datetime.now(UTC)
new_projects = []

for i, ann in enumerate(bid_notices):
    pc = ann['relatedProjectCode']
    # Parse project code for a date hint: BID-2026-0522 → May 22 2026
    title = ann['title']
    if title.endswith('招标公告'):
        name = title[:-4]
    elif title.endswith('采购公告'):
        name = title[:-4]
    else:
        name = title

    content = ann.get('content', '') or ''
    publish_date = datetime.fromisoformat(ann['publishDate'].replace('Z', '+00:00'))
    deadline_days = extract_deadline_days(content)

    # Assign stage based on publish date
    days_since = (now - publish_date).days
    if days_since > 180:
        stage = 'ARCHIVED'
    elif days_since > 90:
        stage = 'EVALUATING'
    elif days_since > 45:
        stage = 'OPENING'
    elif days_since > 7:
        stage = 'SUBMIT'
    else:
        stage = 'DOWNLOAD'

    open_time = publish_date + timedelta(days=30)
    open_time = open_time.replace(hour=10, minute=0, second=0, microsecond=0)
    deadline = open_time - timedelta(hours=1)  # 1 hour before opening

    if stage == 'ARCHIVED':
        # Ensure deadline is in the past for archived projects
        if deadline > now:
            deadline = publish_date + timedelta(days=min(deadline_days, 120))
            open_time = deadline + timedelta(hours=1)

    project = {
        'id': generate_project_id(i),
        'projectCode': pc,
        'name': name,
        'procurementMethod': extract_procurement(content),
        'openTime': open_time.isoformat(),
        'deadline': deadline.isoformat(),
        'stage': stage,
        'riskNote': '（来自公告自动生成）',
        'budget': extract_budget(content),
        'scope': extract_scope(content) or ann.get('aiSummary', ''),
        'qualification': '详见招标公告原文',
        'contact': '详见平台项目页面',
        'encryptionKeyId': None,
        'createdAt': publish_date.isoformat(),
        'updatedAt': ann.get('updatedAt', publish_date.isoformat()),
    }
    new_projects.append(project)
    print(f'  [{stage}] {pc}: {name}')

# Merge with existing
all_projects = existing + new_projects
with open(f'{SEED_DIR}/BidProject.json', 'w') as f:
    json.dump(all_projects, f, ensure_ascii=False, indent=2)

print(f'Wrote {len(all_projects)} BidProjects (added {len(new_projects)})')
