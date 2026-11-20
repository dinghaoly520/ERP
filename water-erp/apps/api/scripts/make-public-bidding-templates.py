#!/usr/bin/env python3
"""生成公开招标两份 docx 模板（2026-11-20，spec docs/superpowers/specs/2026-11-20-public-bidding-method-design.md）。

克隆法：以邀请招标两模板为底，XML 级跨 run 文本替换（Word 常把整句拆进多个 <w:t> run，
单节点替换必漏——先例见 apps/api/src/tender-write/tenant-tokens.ts 注释）。
占位符 token（{{采购人名称}} 等）全部保持不变，替换计划引擎零改动复用。

用法：python3 apps/api/scripts/make-public-bidding-templates.py [--dry-run]
（默认写 apps/api/模板文件/ 下两个新文件；--dry-run 只打印替换计数不落盘）
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TPL_DIR = ROOT / "模板文件"

# (正则, 替换) —— 顺序敏感：长串在前，防短串先替换破坏长串匹配
DOC_REPLACEMENTS = [
    # 第一章 招标口吻（邀请→公开欢迎）
    (
        r"采用邀请招标方式进行招标，兹邀请符合本次招标要求的投标人参加投标",
        "采用公开招标方式进行招标，欢迎符合本次招标要求的投标人参加投标",
    ),
    # 第 22 条内部制度免责声明（集团采购基本非依法必招——保留免责口径）
    (
        r"本邀请招标仅为招标人基于内部制度而设置的采购方式，并非《招标投标法》层面的邀请招标",
        "本公开招标仅为招标人基于内部制度而设置的采购方式，并非《招标投标法》层面的公开招标",
    ),
    # 19.1.1 终止情形
    (r"不再符合规定的邀请招标方式适用情形", "不再符合规定的公开招标方式适用情形"),
    # 联合体条款去「被邀请」
    (r"被邀请的投标人以联合体形式参加投标", "投标人以联合体形式参加投标"),
    # 招标文件获取方式口吻
    (r"在公示期间下载采购文件", "在招标公告公示期间下载招标文件"),
    # 投标保证金保函段（长串先行）
    (r"不按照邀请招标文件要求提交履约保证金", "不按照招标文件要求提交履约保证金"),
    (r"发生邀请招标文件明确规定", "发生招标文件明确规定"),
    (r"（项目名称）邀请招标，", "（项目名称）公开招标，"),
    # 投标函/身份证明段的「谈判」残留（底稿复制痕迹，公开招标版修正）
    (r"按照谈判文件要求提交履约保证金", "按照招标文件要求提交履约保证金"),
    (r"现场参加谈判的情况", "现场参加开标的情况"),
    # 封面「邀请招标文件」（保函段长串已先行处理，此处余封面等）
    (r"邀请招标文件", "招标文件"),
    # 第一章标题（正文两处 + 目录行）
    (r"招标邀请", "招标公告"),
    # 联系人段「采 购 人」→「招 标 人」（空格版式随映射保留；{{采购人名称}} 由负向前瞻保护）
    (r"采(\s*)购(\s*)人(?!\s*名称)", r"招\1标\2人"),
]

ANN_REPLACEMENTS = [
    (r"邀请招标公告", "招标公告"),
    (r"采用邀请招标方式对", "采用公开招标方式对"),
    (r"进行采购，现公示如下", "进行招标，现公告如下"),
    (r"二、采购的货物或者服务的要求", "二、招标内容及要求"),
    (r"采购内容包括", "招标内容包括"),
    # 「采 购 人 / 采购人」→「招 标 人 / 招标人」；{{采购人名称}} 由负向前瞻保护
    (r"采(\s*)购(\s*)人(?!\s*名称)", r"招\1标\2人"),
]

W_T = re.compile(r"<w:t((?:\s[^>]*)?)>(.*?)</w:t>", re.S)


def build_index(xml: str):
    entries = []  # (attrs_start, attrs_end, content_start, content_end)
    for m in W_T.finditer(xml):
        entries.append((m.start(1), m.end(1), m.start(2), m.end(2)))
    parts, index = [], []
    for i, (_, _, s, e) in enumerate(entries):
        seg = xml[s:e]
        parts.append(seg)
        index.extend((i, off) for off in range(len(seg)))
    return entries, "".join(parts), index


def write_node(xml: str, entry, new_text: str) -> str:
    """重写单个 <w:t> 内容；新文本带首尾空格且原标签无 xml:space 时补属性（否则 Word 吞空格）。"""
    a_s, a_e, c_s, c_e = entry
    if new_text != new_text.strip() and "xml:space" not in xml[a_s:a_e]:
        xml = xml[:a_e] + ' xml:space="preserve"' + xml[a_e:]
        c_s += len(' xml:space="preserve"')
        c_e += len(' xml:space="preserve"')
    return xml[:c_s] + new_text + xml[c_e:]


def apply_replacements(xml: str, replacements, label: str) -> str:
    counts = {}
    for pattern, repl in replacements:
        while True:
            entries, text, index = build_index(xml)
            m = re.search(pattern, text)
            if not m:
                break
            counts[pattern] = counts.get(pattern, 0) + 1
            s, e = m.span()
            first_i, first_off = index[s]
            last_i, last_off = index[e - 1]
            if first_i == last_i:
                a = entries[first_i]
                node = xml[a[2]:a[3]]
                xml = write_node(xml, a, node[:first_off] + m.expand(repl) + node[last_off + 1:])
            else:
                a = entries[first_i]
                xml = write_node(xml, a, xml[a[2]:a[3]][:first_off] + m.expand(repl))
                entries = build_index(xml)[0]
                for i in range(first_i + 1, last_i):
                    a = entries[i]
                    xml = write_node(xml, a, "")
                    # 逐次重建：清空改变长度，旧坐标会写偏（实测啃掉 '<' 致坏档）
                    entries = build_index(xml)[0]
                a = entries[last_i]
                xml = write_node(xml, a, xml[a[2]:a[3]][last_off + 1:])
    for old, n in counts.items():
        print(f"  [{label}] {n}× /{old[:36]}{'…' if len(old) > 36 else ''}/")
    missed = [p for p, _ in replacements if p not in counts]
    if missed:
        print(f"  [{label}] ⚠ 未命中：{missed}——底稿是否已变更？")
    return xml


def clone(src: Path, dst: Path, replacements, label: str, dry: bool):
    zin = zipfile.ZipFile(src)
    out = {}
    for name in zin.namelist():
        data = zin.read(name)
        if re.fullmatch(r"word/(document|header\d*|footer\d*)\.xml", name):
            data = apply_replacements(data.decode("utf-8"), replacements, f"{label}:{name}").encode("utf-8")
        out[name] = data
    if dry:
        return
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in out.items():
            zout.writestr(name, data)
    print(f"  写出 {dst.name}")


def main():
    dry = "--dry-run" in sys.argv
    print("公开招标文件模板 ← 邀请招标文件模板")
    clone(TPL_DIR / "邀请招标文件模板.docx", TPL_DIR / "公开招标文件模板.docx", DOC_REPLACEMENTS, "文件", dry)
    print("公开招标公告模板 ← 邀请招标公告模板")
    clone(TPL_DIR / "邀请招标公告模板.docx", TPL_DIR / "公开招标公告模板.docx", ANN_REPLACEMENTS, "公告", dry)


if __name__ == "__main__":
    main()
