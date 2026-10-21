#!/usr/bin/env python3
"""Generate the direct-dependency inventory from repository manifests and locks.

Run with Python 3 and PyYAML installed. No network, node_modules, or .env reads.
By default the repository is inferred from this script's attachment directory.
This inventories declarations and lock resolutions, not runtime usage or installs.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

import yaml


WORKSPACES = [
    ".",
    "apps/api",
    "apps/public-portal",
    "apps/mall",
    "apps/supplier-portal-next",
    "apps/web",
    "apps/expert-portal",
    "apps/bid-portal",
    "apps/assistant",
    "apps/bigscreen",
    "packages/config",
    "packages/shared",
    "packages/client",
    "packages/ukey",
]
CATEGORIES = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
]
HEADERS = [
    "组件/应用",
    "依赖分类",
    "依赖名",
    "package声明版本",
    "lock解析版本",
    "lock解析完整值",
    "版本来源",
    "说明",
]
DECLARATION_NOTE = "直接依赖声明不等于实际运行时使用；锁文件解析值不等于本机已安装版本。"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def short_version(full: str) -> str:
    # Peer suffixes identify a resolution context, not this dependency's version.
    return full.split("(", 1)[0]


def workspace_rows(repo: Path, lock: dict) -> list[dict[str, str]]:
    rows = []
    for workspace in WORKSPACES:
        manifest_path = Path(workspace) / "package.json"
        manifest = read_json(repo / manifest_path)
        importer = lock["importers"][workspace]
        for category in CATEGORIES:
            for name, declaration in sorted(manifest.get(category, {}).items()):
                entry = importer.get(category, {}).get(name)
                if entry is None:
                    raise ValueError(f"Missing lock entry: {workspace}/{category}/{name}")
                if str(entry["specifier"]) != str(declaration):
                    raise ValueError(f"Manifest/lock specifier mismatch: {workspace}/{name}")
                full = str(entry["version"])
                note = DECLARATION_NOTE
                if full.startswith("link:"):
                    note += " workspace本地链接；没有独立npm解析版本，链接值原样保留。"
                if category == "devDependencies":
                    note += " 开发、类型、构建或测试依赖，不自动视为生产运行服务。"
                if name.startswith("@types/"):
                    note += " 类型声明包版本，不是对应Node/React/Express等运行时版本。"
                rows.append({
                    "组件/应用": f"{workspace} ({manifest['name']})",
                    "依赖分类": category,
                    "依赖名": name,
                    "package声明版本": str(declaration),
                    "lock解析版本": short_version(full),
                    "lock解析完整值": full,
                    "版本来源": f"{manifest_path.as_posix()}; pnpm-lock.yaml:importers[{workspace}].{category}[{name}]",
                    "说明": note,
                })
    return rows


def middleware_rows(repo: Path) -> list[dict[str, str]]:
    directory = "services/ukey-middleware"
    manifest = read_json(repo / directory / "package.json")
    lock = read_json(repo / directory / "package-lock.json")
    rows = []
    for category in CATEGORIES:
        for name, declaration in sorted(manifest.get(category, {}).items()):
            locked_declaration = lock["packages"][""].get(category, {}).get(name)
            if locked_declaration != declaration:
                raise ValueError(f"Middleware manifest/lock mismatch: {name}")
            full = str(lock["packages"][f"node_modules/{name}"]["version"])
            rows.append({
                "组件/应用": f"{directory} ({manifest['name']})",
                "依赖分类": category,
                "依赖名": name,
                "package声明版本": declaration,
                "lock解析版本": full,
                "lock解析完整值": full,
                "版本来源": f"{directory}/package.json; {directory}/package-lock.json:packages[node_modules/{name}]",
                "说明": DECLARATION_NOTE + " 独立npm锁文件，不在根pnpm workspace内；不含其传递依赖。",
            })
    return rows


def ocr_rows(repo: Path) -> list[dict[str, str]]:
    rows = []
    paths = ["services/ocr/requirements.txt", "services/ocr/requirements-easyocr.txt"]
    for relative in paths:
        for number, raw in enumerate((repo / relative).read_text(encoding="utf-8").splitlines(), 1):
            requirement = raw.split("#", 1)[0].strip()
            if not requirement:
                continue
            match = re.fullmatch(r"([A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?)(.*)", requirement)
            if not match:
                raise ValueError(f"Unsupported requirement: {relative}:{number}")
            name, declaration = match.groups()
            declaration = declaration.strip()
            optional = relative.endswith("requirements-easyocr.txt")
            note = "requirements声明，不等于已安装或运行中使用；仓库未提供Python解析锁文件。"
            if declaration.startswith("=="):
                note += " 声明精确钉版，但不作为实际安装版或独立lock解析结果。"
            elif declaration:
                note += " 范围约束，无法由仓库确定最终安装版本。"
            else:
                note += " 未指定版本，无法由仓库确定最终安装版本。"
            if optional:
                note += " 可选EasyOCR替代引擎，默认start.sh只安装requirements.txt。"
            rows.append({
                "组件/应用": "services/ocr (Python OCR)",
                "依赖分类": "Python optional requirements" if optional else "Python requirements",
                "依赖名": name,
                "package声明版本": declaration or "未指定版本",
                "lock解析版本": "未提供解析锁文件",
                "lock解析完整值": "",
                "版本来源": f"{relative}:{number}",
                "说明": note,
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("06-依赖版本清单.csv"))
    args = parser.parse_args()
    repo = args.repo.resolve()
    lock = yaml.safe_load((repo / "pnpm-lock.yaml").read_text(encoding="utf-8"))
    rows = workspace_rows(repo, lock) + middleware_rows(repo) + ocr_rows(repo)
    keys = [(row["组件/应用"], row["依赖分类"], row["依赖名"]) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate direct dependency row")
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} direct dependency declarations to {args.output.resolve()}")
    print(json.dumps(dict(Counter(row["组件/应用"].split(" (")[0] for row in rows)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
